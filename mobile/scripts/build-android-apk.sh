#!/bin/bash
# ─── Build Signed Android APK ──────────────────────────────────────────────
# Used in CI/CD pipeline to build the Android APK from the mobile/ directory

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Building Airone IDE Mobile (Android) ==="
echo "Project dir: ${PROJECT_DIR}"

cd "${PROJECT_DIR}"

# ─── 1. Install Dependencies ───────────────────────────────────────────────

echo "Installing mobile dependencies..."
npm install --legacy-peer-deps 2>&1 | tail -5

# ─── 2. Build Web App ──────────────────────────────────────────────────────

echo "Building web app..."
npm run build 2>&1 | tail -10

# ─── 3. Add Capacitor Android Platform ─────────────────────────────────────

echo "Adding Android platform..."
npx cap add android 2>&1 | tail -5 || echo "Android platform may already exist"

# ─── 4. Sync Web Assets ────────────────────────────────────────────────────

echo "Syncing web assets..."
npx cap sync android 2>&1 | tail -5

# ─── 5. Prepare Android Project ────────────────────────────────────────────

echo "Preparing Android project..."
bash scripts/prepare-android.sh

# ─── 6. Build APK ──────────────────────────────────────────────────────────

echo "Building Android APK..."
cd android

if [ -n "${ANDROID_KEYSTORE_BASE64}" ]; then
  echo "Building RELEASE APK (signed)..."
  ./gradlew assembleRelease 2>&1 | tail -20
  APK_PATH="app/build/outputs/apk/release/app-release.apk"
else
  echo "Building DEBUG apk (unsigned)..."
  ./gradlew assembleDebug 2>&1 | tail -20
  APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
fi

cd "${PROJECT_DIR}"

# ─── 7. Copy APK to Dist ───────────────────────────────────────────────────

mkdir -p dist
if [ -f "android/${APK_PATH}" ]; then
  cp "android/${APK_PATH}" "dist/AironeIDE.apk"
  echo ""
  echo "✓ APK built successfully: dist/AironeIDE.apk"
  ls -lh dist/AironeIDE.apk
else
  echo "ERROR: APK not found at android/${APK_PATH}"
  find android -name "*.apk" -type f 2>/dev/null || echo "No APK files found"
  exit 1
fi
