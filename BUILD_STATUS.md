# Airone IDE Build Status

## Build Status: ✅ SUCCESS

**Latest Release**: `v0.1.0-build.202606040211`

### Build Artifacts

| Platform | Artifact | Size | Status |
|----------|----------|------|--------|
| Windows | `AironeIDESetup.exe` | 137MB | ✅ |
| Linux | `AironeIDE.AppImage` | 167MB | ✅ |
| Linux | `AironeIDE.deb` | 98MB | ✅ |
| Android | `AironeIDE.apk` | 123MB | ✅ |

### Build Fixes Applied This Session

1. **Root package.json overwritten** — The Theia IDE root `package.json` had been overwritten with the ai-backbone's package.json, causing `yarn build:extensions` command not found error. Restored from `airo-package.json` backup.

2. **bun.lock causing CI failure** — The `bun.lock` file at the repo root caused lerna to detect `bun` as the package manager. Since `bun` is not installed on GitHub Actions runners, the build failed with `/bin/sh: 1: bun: not found`. Removed `bun.lock` from the repo.

3. **DOM.Iterable missing from tsconfig** — Re-added `"DOM.Iterable"` to the `lib` array in `theia-extensions/airo/tsconfig.json` to fix NodeListOf iteration errors.

4. **Arduino CLI download URL** — Windows now uses `.zip` instead of `.tar.gz` (was causing 404 errors). The URL `https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_Windows_64bit.zip` works correctly (302 redirect to the actual version).

5. **IDE crash after splash screen** — Added error handling to all MutationObservers, debounced observers to prevent infinite loops, delayed UI modifications until after Theia initialization, made CSS menu hiding resilient (only activates after JS signals readiness via `data-airone-ui-ready` attribute).

### All 4 Airone Components Status

| Component | Status | Location |
|-----------|--------|----------|
| Airo Compiler | ✅ Built | /home/z/my-project/airo-compiler/ |
| Brain Server | ✅ Built | /home/z/my-project/brain-server/ |
| AI Backbone | ✅ Built | /home/z/my-project/ai-backbone/ |
| Airone IDE | ✅ Built & Released | /home/z/my-project/ |

### Remaining Known Issues

- **"New File" still visible** in File dropdown — CSS/DOM hiding may not work in all cases
- **Port selection** — Requires `serialport` npm to be properly built as a native module in the packaged app
- **Upload** — Needs `esptool.py` bundled in the packaged app
