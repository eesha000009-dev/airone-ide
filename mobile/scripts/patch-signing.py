#!/usr/bin/env python3
"""Patch Capacitor's Android build.gradle with signing configuration."""
import re
import sys
import os

gradle_file = "android/app/build.gradle"
with open(gradle_file, "r") as f:
    content = f.read()

# Add signing config before buildTypes
signing_config = """    signingConfigs {
        release {
            storeFile file('keystores/release.keystore')
            storePassword System.getenv("ANDROID_STORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }
    }
"""

if "signingConfigs" not in content:
    content = content.replace("    buildTypes {", signing_config + "\n    buildTypes {")

# Add signingConfig only inside buildTypes.release block
# NOT inside signingConfigs.release block
if "signingConfig signingConfigs.release" not in content:
    # Find the release block inside buildTypes and add signingConfig
    content = re.sub(
        r'(buildTypes\s*\{[^}]*release\s*\{)',
        r'\1\n            signingConfig signingConfigs.release',
        content,
        flags=re.DOTALL
    )

with open(gradle_file, "w") as f:
    f.write(content)

print("build.gradle patched with signing config")
