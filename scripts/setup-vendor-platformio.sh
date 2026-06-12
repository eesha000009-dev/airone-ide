#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Setup vendor/ directory with PlatformIO ESP32 toolchain for local dev
#
# This script downloads the ESP32 compiler toolchain and Arduino framework
# into vendor/platformio_cache/ so the IDE can compile offline.
#
# For production builds, the CI workflow does this automatically.
# This script is for LOCAL DEVELOPMENT only.
#
# Prerequisites: Python 3.8+ and pip
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENDOR_DIR="$PROJECT_ROOT/vendor/platformio_cache"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Airone IDE — Local PlatformIO Toolchain Setup              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Project root: $PROJECT_ROOT"
echo "Vendor dir:   $VENDOR_DIR"
echo ""

# Step 1: Check Python
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

# Step 2: Install PlatformIO
echo "Step 2: Installing PlatformIO Core..."
if $PYTHON_CMD -m platformio --version &>/dev/null; then
    PIO_VERSION=$($PYTHON_CMD -m platformio --version 2>&1)
    echo "  ✓ Already installed: $PIO_VERSION"
else
    echo "  Installing via pip..."
    $PYTHON_CMD -m pip install -U platformio
    echo "  ✓ PlatformIO installed"
fi
echo ""

# Step 3: Download ESP32 toolchain
echo "Step 3: Downloading ESP32 toolchain (this may take a few minutes)..."
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

# Step 4: Copy toolchain to vendor/
echo "Step 4: Copying toolchain to vendor/..."

# Determine PlatformIO home
PIO_HOME="${HOME}/.platformio"
if [ -n "${USERPROFILE:-}" ]; then
    # Windows (Git Bash / MSYS2)
    PIO_HOME="${USERPROFILE}/.platformio"
fi

mkdir -p "$VENDOR_DIR/packages"

for pkg in toolchain-xtensa-esp32 framework-arduinoespressif32 tool-esptoolpy tool-mkspiffs tool-mklittlefs; do
    if [ -d "$PIO_HOME/packages/$pkg" ]; then
        cp -r "$PIO_HOME/packages/$pkg" "$VENDOR_DIR/packages/"
        echo "  ✓ Copied $pkg"
    else
        echo "  ⚠ $pkg not found at $PIO_HOME/packages/$pkg"
    fi
done

# Copy platforms directory
if [ -d "$PIO_HOME/platforms" ]; then
    cp -r "$PIO_HOME/platforms" "$VENDOR_DIR/"
    echo "  ✓ Copied PlatformIO platforms"
fi

echo ""

# Step 5: Verify
echo "Step 5: Verifying vendor/ contents..."
FOUND=0
for pkg in toolchain-xtensa-esp32 framework-arduinoespressif32; do
    if [ -d "$VENDOR_DIR/packages/$pkg" ]; then
        SIZE=$(du -sh "$VENDOR_DIR/packages/$pkg" 2>/dev/null | cut -f1 || echo "?")
        echo "  ✓ $pkg ($SIZE)"
        FOUND=$((FOUND + 1))
    else
        echo "  ✗ $pkg MISSING"
    fi
done

echo ""
if [ $FOUND -ge 2 ]; then
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  ✓ Setup complete! ESP32 toolchain is ready for offline     ║"
    echo "║    compilation.                                             ║"
    echo "║                                                             ║"
    echo "║  Total vendor size:" 
    du -sh "$VENDOR_DIR" | awk '{print "║    " $1}'
    echo "╚══════════════════════════════════════════════════════════════╝"
else
    echo "⚠ Toolchain setup incomplete. Some packages are missing."
    echo "  The IDE will still work but may need to download packages on first compile."
fi
