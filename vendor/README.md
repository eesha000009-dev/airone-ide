# Vendor Directory

This directory contains bundled PlatformIO Core and ESP32 toolchain for offline compilation.

## Structure

```
vendor/
└── platformio_cache/
    └── packages/
        ├── toolchain-xtensa-esp32/    # ESP32 GCC toolchain
        └── framework-arduinoespressif32/  # Arduino ESP32 core
```

## How It Works

When the Airone IDE detects a bundled vendor directory, it sets these environment
variables before running `pio run`:

- `PLATFORMIO_CORE_DIR` → Points to `vendor/platformio_cache`
- `PLATFORMIO_SETTING_FORCE_OFFLINE` → `true`

This forces PlatformIO to use the bundled toolchain instead of downloading
anything from the internet.

## CI Bundling

The GitHub Actions workflow downloads and caches the ESP32 toolchain into this
directory before building the Electron app. The `electron-builder.yml`
`extraResources` config bundles this directory into the packaged app at
`resources/vendor/`.

## Prerequisites

The ONLY external prerequisite is **Python 3.8+**. PlatformIO Core and the
ESP32 toolchain are bundled — no pip install needed.

## Development

During development, this directory may be empty. The IDE will fall back to
using PlatformIO from the system PATH if the vendor directory is empty.

