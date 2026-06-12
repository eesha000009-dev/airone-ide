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

- **PlatformIO Integration** — Built-in PlatformIO support for compiling ESP32 firmware. Supports both online and offline (bundled toolchain) modes. No separate IDE or toolchain installation needed.

- **One-Click Flash** — Flash compiled firmware directly to your ESP32 board via USB. Uses esptool-js for Python-free flashing, with esptool.py as a fallback. Supports full 3-file flash (bootloader + partitions + firmware).

- **Serial Monitor** — Built-in serial monitor with real-time data display, ESP32 auto-detection, and configurable baud rates.

- **AI Brain Integration** — Connect your ESP32 robot to an AI brain server via WebSocket. The `.airo` language has native support for `senddatato` and `brain_url` directives.

- **Offline Capable** — Bundle PlatformIO Core and the ESP32 toolchain inside the app for fully offline compilation (Python is the only external prerequisite).

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

- **Python 3.8+** — Required by PlatformIO for compilation
- **USB Driver** — For your ESP32 board's USB-to-UART bridge (CP210x, CH340, or FTDI)

### Installation

Download the latest installer from the [Releases](https://github.com/eesha000009-dev/airone-ide/releases) page.

### Quick Start

1. **Create a new `.airo` file** — File → New File, choose `.airo` extension
2. **Write your code** — Use the `.airo` language to define pins and behavior
3. **Compile** — Click the compile button or press the shortcut
4. **Connect your board** — Plug in your ESP32 via USB
5. **Upload** — Click the upload button to flash firmware

### Example `.airo` Code

```
#library#
Servo

Pin defi {
    led output 2
    button input 0
    servo output 13
}

#variables#
wifi_ssid = "MyNetwork"
wifi_password = "MyPassword"
brain_url = "wss://airone-brain.onrender.com/?robot=mybot"

loop {
    read_for(100) {
        button
    }

    ask button > 2000 {
        actfor(500) {
            led
        }
    } else {
        read_for(0) {
            servo = 90
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
    ↓ (PlatformIO)
firmware.bin + bootloader.bin + partitions.bin
    ↓ (esptool-js / esptool.py)
ESP32 board
```

### Compilation Pipeline

1. **Built-in syntax check** — Fast TypeScript-based syntax validation
2. **Transpiler** — Converts `.airo` to C++ Arduino/ESP32 code
3. **PlatformIO build** — Compiles C++ into firmware binaries using the ESP32 toolchain

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
yarn

# Build
yarn build

# Package the Electron app
yarn package:applications
```

### Offline Toolchain Bundling

To bundle PlatformIO Core and the ESP32 toolchain for offline use:

1. Install PlatformIO: `pip install platformio`
2. Build an ESP32 project once to download the toolchain
3. Copy `~/.platformio` to `vendor/platformio_cache/` in the project root
4. Build the Electron app — the vendor directory is included via `extraResources`

---

## License

**Proprietary** — All rights reserved. This software is the property of Airone. Unauthorized copying, distribution, or modification is prohibited.

---

## Trademark

"Airone" and "Airone IDE" are trademarks of Airone.
