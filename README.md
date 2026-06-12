<div id="airone-logo" align="center">
    <br />
    <h2>Airone IDE</h2>
    <p><strong>Professional ESP32 Development Environment</strong></p>
</div>

---

## What is Airone IDE?

Airone IDE is a professional desktop IDE for ESP32 development, built on the Eclipse Theia platform. It provides a complete, integrated workflow for writing, compiling, and flashing firmware to ESP32 boards — all from a single application.

### Key Features

- **Custom `.airo` Language** — A high-level, beginner-friendly language that transpiles to C++ for ESP32. Define pins, read sensors, control actuators, and connect to AI brain servers — all with simple, readable syntax.

- **Fully Offline Compilation** — PlatformIO Core and the ESP32 toolchain (Xtensa compiler, Arduino framework, esptool) are **bundled inside the installer**. No internet connection is needed after installation. **The only prerequisite is Python 3.8+** — users do NOT need to install PlatformIO separately.

- **One-Click Flash** — Flash compiled firmware directly to your ESP32 board via USB. Uses esptool-js (pure JavaScript, no Python needed for flashing) with esptool.py as a fallback. Supports full 3-file flash (bootloader + partitions + firmware).

- **Serial Monitor** — Built-in serial monitor with real-time data display, ESP32 auto-detection, and configurable baud rates.

- **AI Brain Integration** — Connect your ESP32 robot to an AI brain server via WebSocket. The `.airo` language has native support for `senddatato` and `brain_url` directives.

---

## Supported Boards

| Board | Chip | PlatformIO ID |
|-------|------|---------------|
| ESP32 DevKit | ESP32 | `esp32dev` |
| ESP32-S2 Saola | ESP32-S2 | `esp32-s2-saola-1` |
| ESP32-S3 DevKit | ESP32-S3 | `esp32-s3-devkitc-1` |
| ESP32-C3 DevKit | ESP32-C3 | `esp32-c3-devkitm-1` |
| ESP8266 | ESP8266 | `esp01_1m` |

---

## Getting Started

### Prerequisites

- **Python 3.8+** — The only external prerequisite. Everything else (PlatformIO, ESP32 toolchain, esptool) is bundled inside the app.

### Installation

Download the latest installer from the [Releases](https://github.com/eesha000009-dev/airone-ide/releases) page.

### Quick Start

1. **Create a new `.airo` file** — File → New File, choose `.airo` extension
2. **Write your code** — Use the `.airo` language to define pins and behavior
3. **Compile** — Click the compile button. The IDE uses the bundled PlatformIO and ESP32 toolchain — no internet required.
4. **Connect your board** — Plug in your ESP32 via USB
5. **Upload** — Click the upload button to flash firmware

### Example `.airo` Code

```
#library#
# call body/actuation/servo.airo

Pin defi {
    led = 2; output.
    button = 0; input.
    servo_pin = 13; output.
}

#variables#
wifi_ssid = "MyNetwork".
wifi_password = "MyPassword".
brain_url = "wss://airone-brain.onrender.com/?robot=mybot".

loop {
    read_for(100) {
        button.
    }

    ask button > 2000 {
        actfor(500) {
            led.
        }
    } else {
        read_for(0) {
            servo_pin = 90.
        }
    }
}
```

---

## Architecture

```
.airo file
    ↓ (transpiler)
C++ Arduino/ESP32 code
    ↓ (PlatformIO — bundled, offline)
firmware.bin + bootloader.bin + partitions.bin
    ↓ (esptool-js / esptool.py)
ESP32 board
```

### Compilation Pipeline

1. **Built-in syntax check** — Fast TypeScript-based syntax validation
2. **Transpiler** — Converts `.airo` to C++ Arduino/ESP32 code
3. **PlatformIO build** — Compiles C++ into firmware binaries using the **bundled** ESP32 toolchain. No installation required — PlatformIO Core and the Xtensa compiler are embedded inside the app.

### Offline Bundling

The installer includes:

| Component | Purpose | Approx. Size |
|-----------|---------|-------------|
| PlatformIO Core | Python-based build system | ~50 MB |
| toolchain-xtensa-esp32 | Xtensa C/C++ compiler | ~300 MB |
| framework-arduinoespressif32 | Arduino ESP32 core & libraries | ~200 MB |
| tool-esptoolpy | ESP32 flash tool (fallback) | ~5 MB |

When the user clicks **Compile**, the IDE sets `PLATFORMIO_CORE_DIR` and `PLATFORMIO_SETTING_FORCE_OFFLINE=true` to ensure PlatformIO reads exclusively from the bundled toolchain — no network requests are made.

### Flash Methods

1. **esptool-js** (preferred) — Pure JavaScript flashing via Node serialport. No Python needed for flashing.
2. **esptool.py** (fallback) — Python-based esptool for systems without Node serialport.

---

## Development

### Build from Source

```sh
# Clone the repository
git clone https://github.com/eesha000009-dev/airone-ide.git
cd airone-ide

# Install dependencies
yarn install

# Build
yarn build

# Package the Electron app
yarn package:applications
```

### CI/CD

GitHub Actions automatically builds installers for Windows, Linux, and Android. The CI pipeline:

1. Installs PlatformIO Core via pip
2. Downloads the ESP32 toolchain (Xtensa compiler + Arduino framework)
3. Copies the toolchain into `vendor/platformio_cache/`
4. Builds the Electron app with `electron-builder` (which includes `vendor/` as `extraResources`)
5. Produces platform-specific installers with the bundled toolchain

---

## License

**Proprietary** — All rights reserved. This software is the property of Airone. Unauthorized copying, distribution, or modification is prohibited. See the [LICENSE](LICENSE) file for details.

---

## Trademark

"Airone" and "Airone IDE" are trademarks of Airone.
