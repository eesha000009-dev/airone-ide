# Termux Node.js Binary Research for Android ARM64

## Executive Summary

The Termux package repository provides pre-built Node.js binaries for Android ARM64, but they have **significant dependencies on Termux-specific paths and shared libraries** that make them unsuitable for direct use in a non-Termux Android app. The recommended approach is **nodejs-mobile** which provides a self-contained `libnode.so` with minimal system dependencies.

---

## 1. Termux Package Repository URL Pattern

### Repository Structure
- **Base URL**: `https://packages.termux.dev/apt/termux-main/`
- **Package Index**: `https://packages.termux.dev/apt/termux-main/dists/stable/main/binary-aarch64/Packages`
- **Pool URL Pattern**: `https://packages.termux.dev/apt/termux-main/pool/main/{first-letter}/{package-name}/`

### Available Node.js Packages (aarch64)

| Package | Version | Filename | Size |
|---------|---------|----------|------|
| `nodejs` (current) | 26.2.0 | `nodejs_26.2.0_aarch64.deb` | ~10 MB |
| `nodejs-lts` | 24.15.0 | `nodejs-lts_24.15.0_aarch64.deb` | ~9.7 MB |

**No Node.js 20.x or 22.x available** - Termux only maintains the current and LTS tracks. The archive repo (`termux-main-21`) only has Node.js 13.0.0 and 12.13.0.

### Exact Download URLs

```bash
# Node.js LTS (v24.15.0) - aarch64
https://packages.termux.dev/apt/termux-main/pool/main/n/nodejs-lts/nodejs-lts_24.15.0_aarch64.deb

# Node.js Current (v26.2.0) - aarch64
https://packages.termux.dev/apt/termux-main/pool/main/n/nodejs/nodejs_26.2.0_aarch64.deb
```

---

## 2. How to Download and Extract Node.js from Termux .deb

```bash
# Download the .deb package
curl -L -o nodejs-lts.deb \
  "https://packages.termux.dev/apt/termux-main/pool/main/n/nodejs-lts/nodejs-lts_24.15.0_aarch64.deb"

# Extract the .deb (ar archive)
ar x nodejs-lts.deb
# Produces: control.tar.xz, data.tar.xz, debian-binary

# Extract the data (contains the actual files)
tar xf data.tar.xz

# The node binary is at:
# ./data/data/com.termux/files/usr/bin/node
```

### File Structure Inside the .deb
```
data/data/com.termux/files/usr/
├── bin/node                          (43 MB - the main binary)
├── lib/node_modules/corepack/        (corepack modules)
├── include/node/                     (C++ headers for native addons)
└── share/doc/nodejs-lts/             (documentation)
```

---

## 3. CRITICAL: Termux Node.js Dependencies on Termux-Specific Libraries

### Dynamic Library Dependencies (NEEDED entries)

The Termux Node.js binary requires these shared libraries:

| Library | Version | Source .deb | Size |
|---------|---------|-------------|------|
| `libc++_shared.so` | NDK r29 | `libc++_29_aarch64.deb` | 1.3 MB |
| `libcrypto.so.3` | OpenSSL 3.6.2 | `openssl_1:3.6.2_aarch64.deb` | 5.0 MB |
| `libssl.so.3` | OpenSSL 3.6.2 | `openssl_1:3.6.2_aarch64.deb` | 854 KB |
| `libicui18n.so.78` | ICU 78.3 | `libicu_78.3_aarch64.deb` | 3.3 MB |
| `libicuuc.so.78` | ICU 78.3 | `libicu_78.3_aarch64.deb` | 2.0 MB |
| `libicudata.so.78` | ICU 78.3 | `libicu_78.3_aarch64.deb` | 32 MB |
| `libcares.so` | c-ares 1.34.6 | `c-ares_1.34.6_aarch64.deb` | 246 KB |
| `libsqlite3.so` | SQLite 3.53.1 | `libsqlite_3.53.1_aarch64.deb` | 1.2 MB |
| `libz.so.1` | zlib 1.3.2 | `zlib_1.3.2_aarch64.deb` | 71 KB |
| `libc.so` | System | Android OS | - |
| `libm.so` | System | Android OS | - |
| `libdl.so` | System | Android OS | - |

**Total size: Node binary (43 MB) + shared libs (45 MB) = ~87 MB**

### Download URLs for All Dependencies

```bash
# libc++ (C++ standard library)
https://packages.termux.dev/apt/termux-main/pool/main/libc/libc++/libc++_29_aarch64.deb

# OpenSSL
https://packages.termux.dev/apt/termux-main/pool/main/o/openssl/openssl_1:3.6.2_aarch64.deb

# c-ares
https://packages.termux.dev/apt/termux-main/pool/main/c/c-ares/c-ares_1.34.6_aarch64.deb

# ICU
https://packages.termux.dev/apt/termux-main/pool/main/libi/libicu/libicu_78.3_aarch64.deb

# SQLite
https://packages.termux.dev/apt/termux-main/pool/main/libs/libsqlite/libsqlite_3.53.1_aarch64.deb

# zlib
https://packages.termux.dev/apt/termux-main/pool/main/z/zlib/zlib_1.3.2_aarch64.deb
```

### Hardcoded Termux Paths (CRITICAL ISSUE)

The binary contains **20 hardcoded references** to Termux-specific paths:

```
/data/data/com.termux/files/usr/lib          (RUNPATH - library search path)
/data/data/com.termux/files/usr/tmp          (temp directory)
/data/data/com.termux/files/home             (HOME directory)
/data/data/com.termux/files/usr/bin/bash     (shell path)
/data/data/com.termux/files/usr/bin/login    (login path)
/data/data/com.termux/files/usr/tmp/__v8_gc__ (V8 GC temp)
node_prefix: /data/data/com.termux/files/usr (Node.js prefix)
```

### RUNPATH Issue

```
RUNPATH: /data/data/com.termux/files/usr/lib
```

The binary will ONLY search for shared libraries in the Termux directory. To use outside Termux, you would need to either:
1. Set `LD_LIBRARY_PATH` environment variable to point to your bundled libs
2. Use `patchelf` to modify the RUNPATH to `$ORIGIN/lib` or your app's lib directory
3. Create symlinks in `/data/data/com.termux/files/usr/lib/` (requires root or Termux installed)

### ELF Binary Details

```
Type: ELF 64-bit LSB shared object, ARM aarch64
Interpreter: /system/bin/linker64 (Android linker - GOOD)
Built for: Android 24
Built by: NDK r29 (14206865)
Stripped: yes
```

The binary uses the Android linker (not glibc), so it IS compatible with Android at the ABI level.

---

## 4. Can Termux Node.js Work Outside Termux?

### Verdict: POSSIBLE with significant work, NOT recommended

**What works:**
- The binary uses `/system/bin/linker64` (Android's native linker)
- Built with NDK r29, targets Android API 24+
- Standard Android system libs (libc.so, libm.so, libdl.so) are available

**What doesn't work out of the box:**
1. **RUNPATH** points to Termux's private directory - libs won't be found
2. **Hardcoded paths** for prefix, tmp, home, shell - some functionality breaks
3. **9 shared libraries** must be bundled alongside the binary
4. **32 MB of ICU data** (libicudata.so) is required for internationalization
5. **No standalone `node` binary** - it's built as a shared object (PIE) that expects to find libs via RUNPATH

**To make it work in a custom app, you would need to:**

```bash
# 1. Patch the RUNPATH using patchelf
patchelf --set-rpath '$ORIGIN/../lib' node

# Or use LD_LIBRARY_PATH in ProcessBuilder:
pb.environment().put("LD_LIBRARY_PATH", appLibDir.getAbsolutePath());

# 2. Override hardcoded paths via environment variables:
pb.environment().put("HOME", context.getFilesDir().getAbsolutePath());
pb.environment().put("TMPDIR", new File(context.getCacheDir(), "tmp").getAbsolutePath());
pb.environment().put("NODE_PATH", nodeModulesDir.getAbsolutePath());

# 3. Bundle all shared libraries in your app's native lib directory
# Copy all .so files to: app/src/main/jniLibs/arm64-v8a/
# Or extract to: /data/data/com.yourapp/files/lib/
```

---

## 5. Alternative: nodejs-mobile (RECOMMENDED)

### Overview

[nodejs-mobile](https://github.com/nodejs-mobile/nodejs-mobile) is a community-maintained fork of the original JaneaSystems project that provides Node.js binaries specifically designed for mobile apps.

### Available Versions

| Version | Android Binary | iOS Binary | Date |
|---------|---------------|------------|------|
| **v18.20.4** (latest) | ✅ | ✅ | Oct 2024 |
| v18.17.2 | ✅ | ✅ | Earlier |
| v16.17.0 | ✅ | ✅ | Earlier |

### Download URL

```bash
# Latest Android binary (includes arm64-v8a, armeabi-v7a, x86_64)
https://github.com/nodejs-mobile/nodejs-mobile/releases/download/v18.20.4/nodejs-mobile-v18.20.4-android.zip
# Size: ~55 MB (includes all architectures)

# Specific architecture sizes inside the zip:
# arm64-v8a/libnode.so  - 60 MB (uncompressed)
# armeabi-v7a/libnode.so - 57 MB (uncompressed) 
# x86_64/libnode.so     - 63 MB (uncompressed)
```

### Key Advantages of nodejs-mobile

1. **Minimal dependencies** - Only needs Android system libraries:
   - `libc.so` (system)
   - `libm.so` (system)
   - `libdl.so` (system)
   - `liblog.so` (system - Android logging)
   - `libc++_shared.so` (NDK C++ runtime - must bundle)

2. **No Termux-specific paths** - Uses generic `/usr/local` prefix
3. **Statically linked** - OpenSSL, ICU, zlib, c-ares all built-in
4. **Android-first design** - Built with NDK r24, targets Android API 24+
5. **Shared library form** (`libnode.so`) - designed for embedding in mobile apps

### Key Difference: libnode.so vs. node binary

**IMPORTANT**: nodejs-mobile provides `libnode.so`, NOT a standalone `node` executable. This is a shared library that must be loaded via JNI and initialized from native C/C++ code. It cannot be launched directly via `ProcessBuilder`.

### Integration Approach

There are two approaches for using nodejs-mobile:

#### Approach A: Use the React Native / Cordova plugins (easiest)
- `npm install nodejs-mobile-react-native` or `cordova plugin add nodejs-mobile-cordova`
- These handle the JNI bridge, native library loading, and communication

#### Approach B: Direct integration with custom JNI bridge (for Capacitor/custom apps)
1. Bundle `libnode.so` in `app/src/main/jniLibs/arm64-v8a/`
2. Write a JNI bridge that calls `node::Start()` from `libnode.so`
3. Load the library from Java: `System.loadLibrary("node")`
4. Implement stdin/stdout communication between Java and Node.js

---

## 6. Comparison: Termux vs. nodejs-mobile

| Factor | Termux Node.js | nodejs-mobile |
|--------|---------------|---------------|
| **Node Version** | 24.15.0 (LTS) / 26.2.0 | 18.20.4 |
| **Form Factor** | Standalone `node` binary | `libnode.so` shared library |
| **Size (arm64 only)** | 43 MB + 45 MB deps = **87 MB** | **60 MB** (all-inclusive) |
| **System Lib Dependencies** | 9 Termux-specific .so files | Only `libc++_shared.so` |
| **Hardcoded Paths** | 20 references to `/data/data/com.termux/` | Generic `/usr/local` |
| **RUNPATH** | `/data/data/com.termux/files/usr/lib` | Not set (loadable via System.loadLibrary) |
| **Launch Method** | ProcessBuilder (subprocess) | JNI / System.loadLibrary |
| **SSL/TLS** | Shared OpenSSL (must bundle) | Static OpenSSL (built-in) |
| **ICU** | Shared (32 MB .so) | Static (built-in) |
| **npm** | Separate package | Not included |
| **Maintenance** | Active (Termux team) | Community fork, less frequent |
| **Android API Level** | 24+ (NDK r29) | 24+ (NDK r24) |

---

## 7. Recommendation for Airone IDE

### Best Approach: Use Termux Node.js with LD_LIBRARY_PATH workaround

For the current architecture (which uses `ProcessBuilder` to launch `node` as a subprocess), the **Termux approach is more compatible** because:

1. The `NodeJsBackendService.java` already uses `ProcessBuilder` to run `node main.js`
2. Switching to nodejs-mobile would require rewriting the entire backend launch mechanism to use JNI
3. The Termux binary can be made to work with proper environment setup

### Implementation Steps for Termux Binary

```java
// In NodeJsBackendService.java - modify startNodeProcess():

// 1. Extract node binary + all shared libraries from assets
String libDir = new File(getFilesDir(), "nodejs/lib").getAbsolutePath();

// 2. Set LD_LIBRARY_PATH to find the bundled .so files
pb.environment().put("LD_LIBRARY_PATH", libDir);

// 3. Override hardcoded paths
pb.environment().put("HOME", getFilesDir().getAbsolutePath());
pb.environment().put("TMPDIR", new File(getCacheDir(), "tmp").getAbsolutePath());
pb.environment().put("NODE_PATH", new File(backendDir, "node_modules").getAbsolutePath());

// 4. Create temp directory
new File(getCacheDir(), "tmp").mkdirs();
```

### Alternative: Compile Node.js from Source with NDK

If you need Node.js 20.x or 22.x specifically (neither available from Termux), compile from source:

```bash
# Cross-compile Node.js for Android ARM64
export NDK_HOME=/path/to/android-ndk
export TOOLCHAIN=$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64

./configure \
  --dest-cpu=arm64 \
  --dest-os=android \
  --cross-compiling \
  --prefix=/usr/local \
  --without-npm \
  --shared-openssl \
  --shared-zlib \
  --with-intl=system-icu

# Build with ninja (faster than make)
ninja -C out/Release -j$(nproc)
```

This is the approach already outlined in the project's `scripts/build-nodejs-android.sh`.

---

## 8. Quick Reference: All Download URLs

```bash
# === TERMUX PACKAGES (aarch64) ===

# Node.js LTS 24.15.0
https://packages.termux.dev/apt/termux-main/pool/main/n/nodejs-lts/nodejs-lts_24.15.0_aarch64.deb

# Node.js Current 26.2.0
https://packages.termux.dev/apt/termux-main/pool/main/n/nodejs/nodejs_26.2.0_aarch64.deb

# Dependencies:
https://packages.termux.dev/apt/termux-main/pool/main/libc/libc++/libc++_29_aarch64.deb
https://packages.termux.dev/apt/termux-main/pool/main/o/openssl/openssl_1:3.6.2_aarch64.deb
https://packages.termux.dev/apt/termux-main/pool/main/c/c-ares/c-ares_1.34.6_aarch64.deb
https://packages.termux.dev/apt/termux-main/pool/main/libi/libicu/libicu_78.3_aarch64.deb
https://packages.termux.dev/apt/termux-main/pool/main/libs/libsqlite/libsqlite_3.53.1_aarch64.deb
https://packages.termux.dev/apt/termux-main/pool/main/z/zlib/zlib_1.3.2_aarch64.deb

# === NODEJS-MOBILE ===

# Node.js 18.20.4 (Android - includes arm64, armv7, x86_64)
https://github.com/nodejs-mobile/nodejs-mobile/releases/download/v18.20.4/nodejs-mobile-v18.20.4-android.zip

# === OFFICIAL NODE.JS (NOT for Android) ===
# Linux ARM64 builds use glibc - WILL NOT work on Android
# https://nodejs.org/dist/latest-v22.x/node-v22.22.3-linux-arm64.tar.xz
```

---

## 9. Key Technical Findings Summary

1. **No Node.js 20.x or 22.x for Android** exists in pre-built form from any source
2. **Termux provides Node.js 24.15.0 (LTS) and 26.2.0 (current)** for aarch64 Android
3. **Termux binaries have RUNPATH = `/data/data/com.termux/files/usr/lib`** - must use `LD_LIBRARY_PATH` to redirect
4. **Termux binaries have 20 hardcoded Termux paths** - most can be overridden with environment variables
5. **9 shared libraries (~45 MB)** must be bundled alongside the Termux node binary
6. **The Android linker (`/system/bin/linker64`) is used** - so the binary IS Android-compatible at the ABI level
7. **nodejs-mobile provides a cleaner alternative** (only needs `libc++_shared.so`) but requires JNI integration
8. **nodejs-mobile is based on Node.js 18.20.4** - may be too old for some use cases
9. **Official Node.js linux-arm64 builds use glibc** - completely incompatible with Android (uses `/lib/ld-linux-aarch64.so.1` interpreter)
10. **Building from source with NDK** remains the most flexible option but takes 2+ hours per architecture
