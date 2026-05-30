#!/bin/bash
# ─── Setup GitHub Secrets for Android Signing ──────────────────────────────
# Run this script to generate a keystore and set up GitHub Secrets
# for CI/CD Android builds with signed APKs.

set -e

REPO="eesha000009-dev/airone-ide"
KEYSTORE_FILE="/tmp/airone-release.keystore"
KEY_ALIAS="airone"
KEY_PASSWORD="airone2025"
STORE_PASSWORD="airone2025"

echo "=== Airone IDE — Android Signing Setup ==="
echo ""

# ─── 1. Generate Keystore ──────────────────────────────────────────────────

echo "Generating release keystore..."
keytool -genkeypair \
  -v \
  -keystore "${KEYSTORE_FILE}" \
  -alias "${KEY_ALIAS}" \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepass "${STORE_PASSWORD}" \
  -keypass "${KEY_PASSWORD}" \
  -dname "CN=Airone, OU=Development, O=Airone, L=Lagos, ST=Lagos, C=NG"

echo "✓ Keystore generated"

# ─── 2. Encode as Base64 ───────────────────────────────────────────────────

KEYSTORE_BASE64=$(base64 -w 0 "${KEYSTORE_FILE}")

echo "✓ Keystore encoded as base64"

# ─── 3. Set GitHub Secrets ─────────────────────────────────────────────────

echo ""
echo "Setting GitHub Secrets..."
echo ""

# Use GitHub API to set secrets
# First, get the repo's public key for encrypting secrets

set_secret() {
  local name="$1"
  local value="$2"

  # Get public key
  PKG_RESPONSE=$(curl -s -H "Authorization: token ${GITHUB_TOKEN}" \
    "https://api.github.com/repos/${REPO}/actions/secrets/public-key")
  
  PKG_KEY=$(echo "$PKG_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['key'])")
  PKG_ID=$(echo "$PKG_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['key_id'])")

  if [ -z "$PKG_KEY" ] || [ -z "$PKG_ID" ]; then
    echo "Error: Could not get public key for repo"
    exit 1
  fi

  # Encrypt the secret value
  ENCRYPTED=$(python3 -c "
import base64
from nacl.public import PublicKey, SealedBox
pk = PublicKey(base64.b64decode('${PKG_KEY}'))
sealed = SealedBox(pk)
encrypted = sealed.encrypt(b'${value}')
print(base64.b64encode(encrypted).decode())
" 2>/dev/null)

  if [ -z "$ENCRYPTED" ]; then
    echo "⚠️  Could not encrypt secret ${name}. Please set it manually."
    echo "  Value: ${value:0:10}..."
    return
  fi

  # Set the secret
  curl -s -X PUT \
    -H "Authorization: token ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${REPO}/actions/secrets/${name}" \
    -d "{\"encrypted_value\":\"${ENCRYPTED}\",\"key_id\":\"${PKG_ID}\"}" > /dev/null

  echo "✓ Secret ${name} set"
}

if [ -n "$GITHUB_TOKEN" ]; then
  set_secret "ANDROID_KEYSTORE_BASE64" "${KEYSTORE_BASE64}"
  set_secret "ANDROID_KEY_ALIAS" "${KEY_ALIAS}"
  set_secret "ANDROID_KEY_PASSWORD" "${KEY_PASSWORD}"
  set_secret "ANDROID_STORE_PASSWORD" "${STORE_PASSWORD}"
  echo ""
  echo "✓ All GitHub Secrets configured!"
else
  echo "⚠️  GITHUB_TOKEN not set. Please set these secrets manually:"
  echo ""
  echo "  ANDROID_KEYSTORE_BASE64 = (base64 encoded keystore file)"
  echo "  ANDROID_KEY_ALIAS = ${KEY_ALIAS}"
  echo "  ANDROID_KEY_PASSWORD = ${KEY_PASSWORD}"
  echo "  ANDROID_STORE_PASSWORD = ${STORE_PASSWORD}"
  echo ""
  echo "To get the base64 keystore:"
  echo "  base64 -w 0 ${KEYSTORE_FILE}"
fi

# Cleanup
rm -f "${KEYSTORE_FILE}"
echo ""
echo "Done! Local keystore file has been removed for security."
