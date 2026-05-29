#!/bin/bash
# ─── Prepare Android Project for Build ──────────────────────────────────────
# This script customizes the Capacitor-generated Android project:
# - Configures signing
# - Sets app icons
# - Customizes app name and theme

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ANDROID_DIR="${PROJECT_DIR}/android"

if [ ! -d "${ANDROID_DIR}" ]; then
  echo "Error: Android project not found at ${ANDROID_DIR}"
  echo "Run 'npx cap add android' first."
  exit 1
fi

echo "Customizing Android project..."

# ─── 1. Configure Signing ──────────────────────────────────────────────────

APP_BUILD_GRADLE="${ANDROID_DIR}/app/build.gradle"

if [ -n "${ANDROID_KEYSTORE_BASE64}" ]; then
  echo "Configuring signed build..."

  # Decode keystore from base64
  KEYSTORE_DIR="${ANDROID_DIR}/app/keystores"
  mkdir -p "${KEYSTORE_DIR}"
  echo "${ANDROID_KEYSTORE_BASE64}" | base64 -d > "${KEYSTORE_DIR}/release.keystore"

  # Add signing config to app/build.gradle
  # We need to inject the signingConfigs and buildTypes sections
  SIGNING_BLOCK="
    signingConfigs {
        release {
            storeFile file('keystores/release.keystore')
            storePassword '${ANDROID_STORE_PASSWORD:-airone2025}'
            keyAlias '${ANDROID_KEY_ALIAS:-airone}'
            keyPassword '${ANDROID_KEY_PASSWORD:-airone2025}'
        }
    }
"

  # Check if signingConfigs already exists
  if ! grep -q "signingConfigs" "${APP_BUILD_GRADLE}" 2>/dev/null; then
    # Insert signing config before buildTypes
    sed -i "/android {/a\\${SIGNING_BLOCK}" "${APP_BUILD_GRADLE}"

    # Make release build type use signing config
    if grep -q "buildTypes" "${APP_BUILD_GRADLE}"; then
      if ! grep -q "signingConfig signingConfigs.release" "${APP_BUILD_GRADLE}"; then
        sed -i '/release {/a\            signingConfig signingConfigs.release' "${APP_BUILD_GRADLE}"
      fi
    fi
  fi

  echo "✓ Signing configured"
else
  echo "⚠️  No ANDROID_KEYSTORE_BASE64 set — APK will be unsigned (debug only)"
fi

# ─── 2. Update App Name ────────────────────────────────────────────────────

STRINGS_XML="${ANDROID_DIR}/app/src/main/res/values/strings.xml"
if [ -f "${STRINGS_XML}" ]; then
  sed -i 's/<string name="app_name">[^<]*<\/string>/<string name="app_name">Airone IDE<\/string>/' "${STRINGS_XML}"
  sed -i 's/<string name="title_activity_main">[^<]*<\/string>/<string name="title_activity_main">Airone IDE<\/string>/' "${STRINGS_XML}"
  echo "✓ App name updated"
fi

# ─── 3. Update AndroidManifest.xml ─────────────────────────────────────────

MANIFEST_XML="${ANDROID_DIR}/app/src/main/AndroidManifest.xml"
if [ -f "${MANIFEST_XML}" ]; then
  # Add USB permissions for serial communication
  if ! grep -q "android.hardware.usb.host" "${MANIFEST_XML}"; then
    # Add uses-feature for USB host
    sed -i '/<application/i\    <uses-feature android:name="android.hardware.usb.host" android:required="false" />' "${MANIFEST_XML}"
  fi
  if ! grep -q "USB_PERMISSION" "${MANIFEST_XML}"; then
    sed -i '/<application/i\    <uses-permission android:name="android.permission.USB_PERMISSION" />' "${MANIFEST_XML}"
  fi
  echo "✓ AndroidManifest updated with USB permissions"
fi

# ─── 4. Update Colors ──────────────────────────────────────────────────────

COLORS_XML="${ANDROID_DIR}/app/src/main/res/values/colors.xml"
if [ -f "${COLORS_XML}" ]; then
  cat > "${COLORS_XML}" << 'EOF'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">#0ea5e9</color>
    <color name="colorPrimaryDark">#0c4a6e</color>
    <color name="colorAccent">#38bdf8</color>
    <color name="backgroundColor">#1e1e2e</color>
</resources>
EOF
  echo "✓ Colors updated"
fi

# ─── 5. Update Styles ──────────────────────────────────────────────────────

STYLES_XML="${ANDROID_DIR}/app/src/main/res/values/styles.xml"
if [ -f "${STYLES_XML}" ]; then
  # Make sure we have a proper theme
  if ! grep -q "AironeTheme" "${STYLES_XML}"; then
    cat > "${STYLES_XML}" << 'EOF'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.NoActionBar">
        <item name="colorPrimary">@color/colorPrimary</item>
        <item name="colorPrimaryDark">@color/colorPrimaryDark</item>
        <item name="colorAccent">@color/colorAccent</item>
        <item name="android:windowBackground">@color/backgroundColor</item>
        <item name="android:statusBarColor">@color/colorPrimaryDark</item>
    </style>
</resources>
EOF
  fi
  echo "✓ Styles updated"
fi

echo ""
echo "✓ Android project customization complete"
