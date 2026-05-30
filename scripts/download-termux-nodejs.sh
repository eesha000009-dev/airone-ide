#!/bin/bash
# ==============================================================================
# Download pre-built Node.js for Android ARM64 from Termux package repository
# ==============================================================================
#
# This script downloads Node.js and its shared library dependencies from the
# Termux package repository, extracts them, and places them in the Android
# assets directory for bundling in the APK.
#
# WHY TERMUX?
# - Official Node.js doesn't provide Android binaries
# - Termux provides well-tested, regularly updated Node.js for Android ARM64
# - The binary uses Android's native linker (/system/bin/linker64)
# - Works with ProcessBuilder (our existing architecture)
#
# RUNTIME REQUIREMENTS (handled by NodeJsBackendService):
# - LD_LIBRARY_PATH must point to the directory with shared libraries
# - HOME, TMPDIR environment variables must be set
# - The binary has some hardcoded Termux paths but they're overridden by env vars
#
# SIZE: ~87 MB total (43 MB binary + 45 MB shared libs)
# - This is acceptable for an IDE application
#
# USAGE:
#   ./scripts/download-termux-nodejs.sh
#
# The script automatically determines the latest available version.
#
# ==============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step()  { echo -e "${BLUE}[STEP]${NC} $1"; }

# ==============================================================================
# Configuration
# ==============================================================================

TERMUX_REPO="https://packages.termux.dev/apt/termux-main"
ARCH="aarch64"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ASSETS_DIR="${PROJECT_DIR}/applications/browser/android/app/src/main/assets"
NODEJS_ASSETS_DIR="${ASSETS_DIR}/nodejs"
NODEJS_BIN_DIR="${NODEJS_ASSETS_DIR}/bin"
NODEJS_LIB_DIR="${NODEJS_ASSETS_DIR}/lib"
TMP_DIR="/tmp/termux-nodejs-download"

# Packages to download (Node.js LTS + all shared library dependencies)
# These are the minimum required for Node.js to run on Android
# Package names must match exactly what's in the Termux repository
PACKAGES=(
    "nodejs-lts"   # Node.js LTS (v24.x)
    "libc++"       # C++ standard library (NDK runtime)
    "openssl"      # OpenSSL (for HTTPS/TLS)
    "libicu"       # Internationalization (required by Node.js)
    "c-ares"       # DNS resolution library
    "libsqlite"    # SQLite (used by Node.js)
    "zlib"         # Compression library
)

# ==============================================================================
# Step 1: Fetch the Termux package index
# ==============================================================================

log_step "Fetching Termux package index..."

mkdir -p "$TMP_DIR"

PACKAGES_FILE="${TMP_DIR}/Packages"
if [ ! -f "$PACKAGES_FILE" ] || [ "$(find "$PACKAGES_FILE" -mmin +60 2>/dev/null)" ]; then
    log_info "Downloading package index from Termux..."
    curl -sL "${TERMUX_REPO}/dists/stable/main/binary-${ARCH}/Packages" -o "$PACKAGES_FILE"
fi

log_info "Package index ready ($(wc -l < "$PACKAGES_FILE") lines)"

# ==============================================================================
# Step 2: Find package versions and download URLs
# ==============================================================================

log_step "Finding package versions..."

declare -A PKG_VERSIONS
declare -A PKG_URLS
declare -A PKG_FILES

for pkg in "${PACKAGES[@]}"; do
    # Find the package in the index
    # Escape special regex characters in package name (e.g., libc++ has ++)
    PKG_ESCAPED=$(echo "$pkg" | sed 's/[+]/\\+/g')
    PKG_BLOCK=$(awk "/^Package: ${PKG_ESCAPED}$/,/^[[:space:]]*$/" "$PACKAGES_FILE")

    if [ -z "$PKG_BLOCK" ]; then
        log_error "Package '${pkg}' not found in Termux repository!"
        exit 1
    fi

    VERSION=$(echo "$PKG_BLOCK" | grep "^Version:" | head -1 | awk '{print $2}')
    FILENAME=$(echo "$PKG_BLOCK" | grep "^Filename:" | head -1 | awk '{print $2}')
    SIZE=$(echo "$PKG_BLOCK" | grep "^Size:" | head -1 | awk '{print $2}')

    if [ -z "$VERSION" ] || [ -z "$FILENAME" ]; then
        log_error "Could not parse version/filename for '${pkg}'"
        exit 1
    fi

    URL="${TERMUX_REPO}/${FILENAME}"

    PKG_VERSIONS[$pkg]="$VERSION"
    PKG_URLS[$pkg]="$URL"
    PKG_FILES[$pkg]="$(basename "$FILENAME")"

    log_info "  ${pkg}: v${VERSION} ($(numfmt --to=iec $SIZE))"
done

# ==============================================================================
# Step 3: Download all packages
# ==============================================================================

log_step "Downloading packages..."

for pkg in "${PACKAGES[@]}"; do
    URL="${PKG_URLS[$pkg]}"
    FILE="${PKG_FILES[$pkg]}"
    DEST="${TMP_DIR}/${FILE}"

    if [ -f "$DEST" ]; then
        log_info "  ${pkg}: already downloaded (${FILE})"
    else
        log_info "  ${pkg}: downloading ${FILE}..."
        curl -L --retry 3 -o "$DEST" "$URL"
    fi
done

# ==============================================================================
# Step 4: Extract packages
# ==============================================================================

log_step "Extracting packages..."

EXTRACT_DIR="${TMP_DIR}/extracted"
rm -rf "$EXTRACT_DIR"
mkdir -p "$EXTRACT_DIR"

for pkg in "${PACKAGES[@]}"; do
    FILE="${PKG_FILES[$pkg]}"
    DEB="${TMP_DIR}/${FILE}"

    log_info "  Extracting ${pkg}..."

    # Extract .deb (ar archive)
    cd "$EXTRACT_DIR"
    ar x "$DEB" 2>/dev/null || {
        log_error "Failed to extract ${DEB}"
        exit 1
    }

    # Extract data.tar.xz or data.tar.gz
    if [ -f "data.tar.xz" ]; then
        tar xf data.tar.xz 2>/dev/null || tar xJf data.tar.xz 2>/dev/null
    elif [ -f "data.tar.gz" ]; then
        tar xzf data.tar.gz
    else
        log_warn "  No data.tar found in ${pkg}, skipping"
    fi

    # Clean up deb extraction artifacts
    rm -f control.tar.xz control.tar.gz data.tar.xz data.tar.gz debian-binary
done

# ==============================================================================
# Step 5: Copy Node.js binary
# ==============================================================================

log_step "Installing Node.js binary..."

mkdir -p "$NODEJS_BIN_DIR"

NODE_BIN=$(find "$EXTRACT_DIR" -path "*/bin/node" -type f | head -1)
if [ -z "$NODE_BIN" ]; then
    log_error "Node.js binary not found in extracted packages!"
    exit 1
fi

cp "$NODE_BIN" "${NODEJS_BIN_DIR}/node"
chmod +x "${NODEJS_BIN_DIR}/node"

log_info "  Node binary: $(du -h "${NODEJS_BIN_DIR}/node" | cut -f1)"

# Verify it's an ARM64 ELF binary
BINARY_INFO=$(file "${NODEJS_BIN_DIR}/node")
if echo "$BINARY_INFO" | grep -q "ELF 64-bit"; then
    log_info "  ✓ Valid ARM64 ELF binary"
else
    log_warn "  Binary may not be ARM64 ELF: $BINARY_INFO"
fi

# ==============================================================================
# Step 6: Copy shared libraries
# ==============================================================================

log_step "Installing shared libraries..."

mkdir -p "$NODEJS_LIB_DIR"

TERMUX_LIB_DIR="data/data/com.termux/files/usr/lib"
LIB_COUNT=0
TOTAL_LIB_SIZE=0

# Find and copy all .so files from the extracted packages
# Exclude OpenSSL engine modules (capi.so, legacy.so, loader_attic.so) - not needed
for so_file in $(find "$EXTRACT_DIR" -path "*/${TERMUX_LIB_DIR}/*.so*" -type f 2>/dev/null | grep -v -E '(capi\.so|legacy\.so|loader_attic\.so)'); do
    lib_name=$(basename "$so_file")
    cp "$so_file" "${NODEJS_LIB_DIR}/"
    lib_size=$(stat -c%s "$so_file" 2>/dev/null || echo 0)
    TOTAL_LIB_SIZE=$((TOTAL_LIB_SIZE + lib_size))
    LIB_COUNT=$((LIB_COUNT + 1))
    log_info "  ${lib_name} ($(numfmt --to=iec $lib_size))"
done

# Also copy symlinks (e.g., libssl.so -> libssl.so.3)
for so_link in $(find "$EXTRACT_DIR" -path "*/${TERMUX_LIB_DIR}/*.so*" -type l 2>/dev/null); do
    lib_name=$(basename "$so_link")
    target=$(readlink "$so_link")
    if [ ! -f "${NODEJS_LIB_DIR}/${lib_name}" ]; then
        # Create the symlink
        ln -sf "$target" "${NODEJS_LIB_DIR}/${lib_name}"
        log_info "  ${lib_name} -> ${target} (symlink)"
    fi
done

if [ "$LIB_COUNT" -eq 0 ]; then
    log_error "No shared libraries found! Node.js will not work without them."
    log_error "Expected to find .so files in ${EXTRACT_DIR}/${TERMUX_LIB_DIR}/"
    exit 1
fi

log_info "  Total: ${LIB_COUNT} libraries ($(numfmt --to=iec $TOTAL_LIB_SIZE))"

# ==============================================================================
# Step 7: Verify all required libraries are present
# ==============================================================================

log_step "Verifying required libraries..."

# These are the libraries that the Node.js binary is linked against
REQUIRED_LIBS=(
    "libc++_shared.so"
    "libcrypto.so"
    "libssl.so"
    "libicui18n.so"
    "libicuuc.so"
    "libicudata.so"
    "libcares.so"
    "libsqlite3.so"
    "libz.so"
)

MISSING=0
for lib in "${REQUIRED_LIBS[@]}"; do
    # Check for the library (with any version suffix)
    if ls "${NODEJS_LIB_DIR}"/${lib}* 1>/dev/null 2>&1; then
        log_info "  ✓ ${lib}"
    else
        log_warn "  ✗ ${lib} (MISSING - Node.js may not work correctly)"
        MISSING=$((MISSING + 1))
    fi
done

if [ "$MISSING" -gt 0 ]; then
    log_warn "${MISSING} required libraries are missing!"
    log_warn "Node.js may crash or have limited functionality"
fi

# ==============================================================================
# Step 8: Summary
# ==============================================================================

echo ""
log_info "=========================================="
log_info "  Node.js for Android ARM64 Ready!"
log_info "=========================================="
echo ""
log_info "Node.js version: ${PKG_VERSIONS[nodejs-lts]}"
log_info "Binary: ${NODEJS_BIN_DIR}/node"
log_info "Libraries: ${NODEJS_LIB_DIR}/ (${LIB_COUNT} files)"
log_info "Total size: $(du -sh "$NODEJS_ASSETS_DIR" | cut -f1)"
echo ""
log_info "The files are in the Android assets directory and will be"
log_info "bundled automatically when you build the APK."
echo ""
log_info "Next step: Build the APK"
log_info "  yarn --cwd applications/browser android:build"
echo ""
log_info "The NodeJsBackendService will:"
log_info "  1. Extract the node binary to internal storage"
log_info "  2. Extract shared libraries to internal storage"
log_info "  3. Set LD_LIBRARY_PATH to find the libraries"
log_info "  4. Start node main.js --port 3000 --hostname 0.0.0.0"
log_info "  5. Theia IDE loads from http://localhost:3000"

# Clean up
rm -rf "$TMP_DIR"
