# Bundled Native Toolchain

This directory contains **platform-specific, pre-compiled native binaries** for
ESP32 firmware compilation and flashing. No Python, PlatformIO, or Arduino CLI
is required at runtime — only these bundled executables.

## Directory Structure

```
resources/tools/
├── win32/
│   ├── xtensa-esp32-elf/     # GCC cross-compiler toolchain
│   ├── cmake/                # CMake build generator
│   ├── ninja.exe             # Ninja build tool
│   └── esptool.exe           # Standalone flasher (no Python needed)
├── linux/
│   ├── xtensa-esp32-elf/
│   ├── cmake/
│   ├── ninja
│   └── esptool
└── darwin/
    ├── xtensa-esp32-elf/
    ├── cmake/
    ├── ninja
    └── esptool
```

## Download Sources (used by CI)

| Binary | Source |
|--------|--------|
| xtensa-esp32-elf | https://github.com/espressif/crosstool-NG/releases |
| cmake | https://cmake.org/download/ |
| ninja | https://github.com/ninja-build/ninja/releases |
| esptool | https://github.com/espressif/esptool/releases |

## How It Works

1. **Compile**: `Esp32BuildService` invokes bundled `cmake` + `ninja` with the
   bundled `xtensa-esp32-elf-g++` to compile C++ → firmware.elf
2. **Flash**: `Esp32BuildService` invokes bundled `esptool` to flash firmware.bin
   to the ESP32 over serial

No external dependencies are needed. The entire toolchain is self-contained.
