#!/bin/bash
# ─── Generate Android Keystore for Signing ──────────────────────────────────
# This script generates a release keystore for signing the Android APK.
# The keystore and passwords should be stored securely (GitHub Secrets).

set -e

KEYSTORE_DIR="android/keystores"
KEYSTORE_FILE="${KEYSTORE_DIR}/release.keystore"
KEY_ALIAS="airone"
KEY_PASSWORD="${KEY_PASSWORD:-airone2025}"
STORE_PASSWORD="${STORE_PASSWORD:-airone2025}"
VALIDITY=10000

# Create directory
mkdir -p "${KEYSTORE_DIR}"

# Generate keystore
echo "Generating Android release keystore..."
keytool -genkeypair \
  -v \
  -keystore "${KEYSTORE_FILE}" \
  -alias "${KEY_ALIAS}" \
  -keyalg RSA \
  -keysize 2048 \
  -validity ${VALIDITY} \
  -storepass "${STORE_PASSWORD}" \
  -keypass "${KEY_PASSWORD}" \
  -dname "CN=Airone, OU=Development, O=Airone, L=Lagos, ST=Lagos, C=NG"

echo ""
echo "✓ Keystore generated: ${KEYSTORE_FILE}"
echo "  Key Alias: ${KEY_ALIAS}"
echo "  Validity: ${VALIDITY} days"
echo ""
echo "⚠️  IMPORTANT: Store these securely as GitHub Secrets:"
echo "  ANDROID_KEYSTORE_BASE64 - base64 encoded keystore file"
echo "  ANDROID_KEY_ALIAS - ${KEY_ALIAS}"
echo "  ANDROID_KEY_PASSWORD - (the key password)"
echo "  ANDROID_STORE_PASSWORD - (the store password)"
echo ""
echo "To encode keystore as base64:"
echo "  base64 -w 0 ${KEYSTORE_FILE} > keystore.b64"
