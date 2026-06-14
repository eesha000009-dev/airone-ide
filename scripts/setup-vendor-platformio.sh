#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Setup vendor/ directory with PlatformIO Core + ESP32 toolchain for local dev
#
# This script:
#   1. Installs PlatformIO Core Python packages into vendor/platformio_packages/
#      (using pip install --target, so NO pip install is needed at runtime)
#   2. Downloads the ESP32 compiler toolchain into vendor/platformio_cache/
#
# For production builds, the CI workflow does this automatically.
# This script is for LOCAL DEVELOPMENT only.
#
# Prerequisites: Python 3.8+ and pip
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENDOR_CACHE_DIR="$PROJECT_ROOT/vendor/platformio_cache"
VENDOR_PACKAGES_DIR="$PROJECT_ROOT/vendor/platformio_packages"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Airone IDE — Full PlatformIO Bundling Setup                ║"
echo "║  (Core Python packages + ESP32 toolchain)                   ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Project root: $PROJECT_ROOT"
echo "Toolchain:    $VENDOR_CACHE_DIR"
echo "Core packages: $VENDOR_PACKAGES_DIR"
echo ""

# ─── Step 1: Check Python ────────────────────────────────────────────────
echo "Step 1: Checking Python..."
PYTHON_CMD=""
for cmd in python3 python py; do
    if command -v "$cmd" &>/dev/null; then
        PYTHON_CMD="$cmd"
        break
    fi
done

if [ -z "$PYTHON_CMD" ]; then
    echo "✗ Python not found. Install Python 3.8+ from python.org"
    exit 1
fi

PYTHON_VERSION=$($PYTHON_CMD --version 2>&1)
echo "  ✓ Found: $PYTHON_VERSION ($PYTHON_CMD)"
echo ""

# ─── Step 2: Bundle PlatformIO Core Python packages ─────────────────────
# This is the KEY step: install PlatformIO and ALL its Python dependencies
# into vendor/platformio_packages/ so the IDE can use them without pip.
# At runtime, PYTHONPATH will point here so `python -m platformio` works.
echo "Step 2: Bundling PlatformIO Core Python packages..."
mkdir -p "$VENDOR_PACKAGES_DIR"

if [ -d "$VENDOR_PACKAGES_DIR/platformio" ]; then
    echo "  ✓ PlatformIO Core packages already exist in vendor/platformio_packages/"
    echo "    (Delete vendor/platformio_packages/platformio to re-install)"
else
    echo "  Installing PlatformIO Core + dependencies via pip --target..."
    $PYTHON_CMD -m pip install --target "$VENDOR_PACKAGES_DIR" platformio
    # Remove .dist-info to save space (not needed at runtime)
    find "$VENDOR_PACKAGES_DIR" -name "*.dist-info" -type d -exec rm -rf {} + 2>/dev/null || true
    echo "  ✓ PlatformIO Core packages installed"
fi

# Verify the bundle works
echo "  Verifying bundled PlatformIO..."
BUNDLED_PIO_VERSION=$($PYTHON_CMD -c "import sys; sys.path.insert(0, '$VENDOR_PACKAGES_DIR'); import platformio; print(platformio.__version__)" 2>&1 || echo "FAILED")
if [[ "$BUNDLED_PIO_VERSION" != "FAILED" ]]; then
    echo "  ✓ Bundled PlatformIO Core version: $BUNDLED_PIO_VERSION"
else
    echo "  ⚠ Bundled PlatformIO Core could not be verified"
fi
echo ""

# ─── Step 3: Install PlatformIO system-wide (for toolchain download) ────
echo "Step 3: Ensuring PlatformIO is available for toolchain download..."
if $PYTHON_CMD -m platformio --version &>/dev/null; then
    PIO_VERSION=$($PYTHON_CMD -m platformio --version 2>&1)
    echo "  ✓ Already installed: $PIO_VERSION"
else
    echo "  Installing via pip (system-wide, for toolchain download)..."
    $PYTHON_CMD -m pip install -U platformio
    echo "  ✓ PlatformIO installed"
fi
echo ""

# ─── Step 4: Download ESP32 toolchain ────────────────────────────────────
echo "Step 4: Downloading ESP32 toolchain (this may take a few minutes)..."
TMPDIR=$(mktemp -d)
cat > "$TMPDIR/platformio.ini" << 'EOF'
[env:esp32dev]
platform = espressif32
board = esp32dev
framework = arduino
EOF
mkdir -p "$TMPDIR/src"
echo "void setup() {} void loop() {}" > "$TMPDIR/src/main.cpp"

# Run PlatformIO build to download toolchain
$PYTHON_CMD -m platformio run -d "$TMPDIR" -e esp32dev || echo "  (Build may have warnings, toolchain should still be downloaded)"
echo ""

# ─── Step 5: Copy toolchain to vendor/ ───────────────────────────────────
echo "Step 5: Copying toolchain to vendor/..."

# Determine PlatformIO home
PIO_HOME="${HOME}/.platformio"
if [ -n "${USERPROFILE:-}" ]; then
    # Windows (Git Bash / MSYS2)
    PIO_HOME="${USERPROFILE}/.platformio"
fi

mkdir -p "$VENDOR_CACHE_DIR/packages"

for pkg in toolchain-xtensa-esp32 framework-arduinoespressif32 tool-esptoolpy tool-mkspiffs tool-mklittlefs; do
    if [ -d "$PIO_HOME/packages/$pkg" ]; then
        cp -r "$PIO_HOME/packages/$pkg" "$VENDOR_CACHE_DIR/packages/"
        echo "  ✓ Copied $pkg"
    else
        echo "  ⚠ $pkg not found at $PIO_HOME/packages/$pkg"
    fi
done

# Copy platforms directory
if [ -d "$PIO_HOME/platforms" ]; then
    cp -r "$PIO_HOME/platforms" "$VENDOR_CACHE_DIR/"
    echo "  ✓ Copied PlatformIO platforms"
fi

echo ""

# ─── Step 5b: Download and bundle Arduino libraries ────────────────────
echo "Step 5b: Downloading Arduino libraries..."
mkdir -p "$VENDOR_CACHE_DIR/lib"

# List of all libraries used by .airo transpiler
LIBRARIES="WebSockets ArduinoJson ESP32Servo esp32-camera"

for lib in $LIBRARIES; do
    echo "  Downloading library: $lib"
    $PYTHON_CMD -m platformio pkg install -g -l "$lib" 2>&1 || echo "  ⚠ Failed to download $lib (non-critical)"
done

# Copy libraries from PlatformIO's global lib dir to vendor
if [ -d "$PIO_HOME/lib" ]; then
    for lib_dir in "$PIO_HOME/lib"/*/; do
        lib_name=$(basename "$lib_dir")
        if [ "$lib_name" != ".pio" ] && [ "$lib_name" != "__pycache__" ]; then
            cp -r "$lib_dir" "$VENDOR_CACHE_DIR/lib/"
            echo "  ✓ Copied library: $lib_name"
        fi
    done
else
    echo "  ⚠ PlatformIO global lib dir not found at $PIO_HOME/lib"
fi

echo ""

# ─── Step 6: Verify ─────────────────────────────────────────────────────
echo "Step 6: Verifying vendor/ contents..."
FOUND_TOOLCHAIN=0
for pkg in toolchain-xtensa-esp32 framework-arduinoespressif32; do
    if [ -d "$VENDOR_CACHE_DIR/packages/$pkg" ]; then
        SIZE=$(du -sh "$VENDOR_CACHE_DIR/packages/$pkg" 2>/dev/null | cut -f1 || echo "?")
        echo "  ✓ $pkg ($SIZE)"
        FOUND_TOOLCHAIN=$((FOUND_TOOLCHAIN + 1))
    else
        echo "  ✗ $pkg MISSING"
    fi
done

FOUND_CORE=0
if [ -d "$VENDOR_PACKAGES_DIR/platformio" ]; then
    SIZE=$(du -sh "$VENDOR_PACKAGES_DIR" 2>/dev/null | cut -f1 || echo "?")
    echo "  ✓ PlatformIO Core Python packages ($SIZE)"
    FOUND_CORE=1
else
    echo "  ✗ PlatformIO Core Python packages MISSING"
fi

FOUND_LIBS=0
if [ -d "$VENDOR_CACHE_DIR/lib" ] && [ "$(ls $VENDOR_CACHE_DIR/lib/ 2>/dev/null)" ]; then
    echo "  ✓ Arduino libraries:"
    ls "$VENDOR_CACHE_DIR/lib/" | while read lib; do
        echo "    - $lib"
    done
    FOUND_LIBS=1
else
    echo "  ✗ Arduino libraries MISSING"
fi

echo ""
if [ $FOUND_TOOLCHAIN -ge 2 ] && [ $FOUND_CORE -eq 1 ] && [ $FOUND_LIBS -eq 1 ]; then
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  ✓ Setup complete! Full offline compilation is ready.       ║"
    echo "║                                                             ║"
    echo "║  Bundled:"
    echo "║    - PlatformIO Core Python packages (no pip install needed)"
    echo "║    - ESP32 toolchain (compiler + framework)"
    echo "║    - Arduino libraries (WebSockets, ArduinoJson, etc.)"
    du -sh "$VENDOR_CACHE_DIR" "$VENDOR_PACKAGES_DIR" | awk '{print "║    " $2 ": " $1}'
    echo "║                                                             ║"
    echo "║  Users only need Python 3.8+ — nothing else.               ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
else
    echo "⚠ Setup incomplete. Some components are missing."
    echo "  The IDE will still work but may need to download packages on first compile."
fi
