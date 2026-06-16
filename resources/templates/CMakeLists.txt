# ═════════════════════════════════════════════════════════════════════════════
#  Airone IDE — Native ESP32 CMake Build Template
# ═════════════════════════════════════════════════════════════════════════════
#
#  This CMakeLists.txt is copied into the project build directory by
#  Esp32BuildService. It uses the bundled xtensa-esp32-elf GCC toolchain
#  to compile the user's C++ sketch into firmware.bin — NO Python, NO
#  PlatformIO, NO Arduino CLI required.
#
#  Variables passed in by Esp32BuildService via -D flags:
#    AIRONE_COMPILER_DIR  — Path to xtensa-esp32-elf/ (contains bin/)
#    AIRONE_FRAMEWORK_DIR — Path to framework-arduinoespressif32/
#    AIRONE_ESPTOOL       — Path to esptool executable
#    AIRONE_SKETCH        — Path to the user's main .cpp file
#    AIRONE_BOARD         — Board name (esp32, esp32s2, esp32s3, esp32c3)
# ═════════════════════════════════════════════════════════════════════════════

cmake_minimum_required(VERSION 3.16)

# ─── Project Setup ────────────────────────────────────────────────────────────

project(AironeFirmware C CXX ASM)

# ─── Cross-Compiler Configuration ────────────────────────────────────────────
# Force CMake to use our bundled cross-compiler

set(CMAKE_C_COMPILER   "${AIRONE_COMPILER_DIR}/bin/xtensa-esp32-elf-gcc")
set(CMAKE_CXX_COMPILER "${AIRONE_COMPILER_DIR}/bin/xtensa-esp32-elf-g++")
set(CMAKE_ASM_COMPILER "${AIRONE_COMPILER_DIR}/bin/xtensa-esp32-elf-gcc")

# ─── ESP32 Build Flags ───────────────────────────────────────────────────────

# Board-specific SDK path
set(AIRONE_SDK_DIR "${AIRONE_FRAMEWORK_DIR}/tools/sdk/${AIRONE_BOARD}")

# Compilation flags for ESP32 Arduino
set(COMMON_FLAGS
    -mlongcalls
    -mtext-section-literals
    -ffunction-sections
    -fdata-sections
    -fno-rtti
    -fno-exceptions
    -std=gnu++17
    -DCORE_DEBUG_LEVEL=0
    -DCONFIG_ARDUHAL_LOG_DEFAULT_LEVEL=0
    -DARDUINO_ARCH_ESP32
    -DARDUINO=10820
    -DBOARD_HAS_WIFI
    -DESP_PLATFORM
    -DARDUINO_USB_MODE=1
    -DARDUINO_USB_CDC_ON_BOOT=0
)

# Include paths
set(INCLUDE_DIRS
    "${AIRONE_FRAMEWORK_DIR}/cores/esp32"
    "${AIRONE_FRAMEWORK_DIR}/variants/${AIRONE_BOARD}"
    "${AIRONE_SDK_DIR}/include"
    "${AIRONE_SDK_DIR}/qio_qspi/include"
    "${AIRONE_SDK_DIR}/include/config"
)

# Convert include dirs to -I flags
foreach(INC_DIR ${INCLUDE_DIRS})
    if(EXISTS "${INC_DIR}")
        list(APPEND INCLUDE_FLAGS "-I${INC_DIR}")
    endif()
endforeach()

set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} ${COMMON_FLAGS} ${INCLUDE_FLAGS}")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${COMMON_FLAGS} ${INCLUDE_FLAGS}")
set(CMAKE_ASM_FLAGS "${CMAKE_ASM_FLAGS} ${COMMON_FLAGS} ${INCLUDE_FLAGS}")

# Linker flags
set(LINKER_FLAGS
    -T"${AIRONE_FRAMEWORK_DIR}/tools/partitions/default.csv"
    -L"${AIRONE_SDK_DIR}/lib"
    -L"${AIRONE_SDK_DIR}/ld"
    -T"${AIRONE_SDK_DIR}/ld/esp32.project.ld"
    -T"${AIRONE_SDK_DIR}/ld/esp32.rom.ld"
    -T"${AIRONE_SDK_DIR}/ld/esp32.peripherals.ld"
    -Wl,--gc-sections
    -Wl,-Map,"${CMAKE_BINARY_DIR}/firmware.map"
    --specs=nano.specs
)

# ─── Arduino Core Library ────────────────────────────────────────────────────
# Link against the pre-compiled Arduino core library

set(ARDUINO_CORE_LIB "${AIRONE_SDK_DIR}/lib/libesp32.a")

# ─── User Sketch ─────────────────────────────────────────────────────────────

add_executable(firmware.elf ${AIRONE_SKETCH})

# Link against Arduino core and ESP32 SDK libraries
target_link_libraries(firmware.elf
    ${ARDUINO_CORE_LIB}
    -lm
    -lgcc
    -lc
    -lnano
)

set_target_properties(firmware.elf PROPERTIES
    LINK_FLAGS "${LINKER_FLAGS}"
)

# ─── Generate firmware.bin from firmware.elf ─────────────────────────────────
# Use esptool to convert the ELF to a flashable .bin

add_custom_command(
    TARGET firmware.elf
    POST_BUILD
    COMMAND "${AIRONE_ESPTOOL}"
            --chip ${AIRONE_BOARD}
            elf2image
            --flash_mode dio
            --flash_freq 40m
            --flash_size 4MB
            -o "${CMAKE_BINARY_DIR}/firmware.bin"
            "${CMAKE_BINARY_DIR}/firmware.elf"
    BYPRODUCTS "${CMAKE_BINARY_DIR}/firmware.bin"
    COMMENT "Generating firmware.bin from firmware.elf"
)

# Also generate bootloader.bin and partitions.bin if they don't exist
# (These are normally pre-built in the framework)
add_custom_command(
    TARGET firmware.elf
    POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${AIRONE_SDK_DIR}/bin/bootloader_qio_80m.bin"
            "${CMAKE_BINARY_DIR}/bootloader.bin"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${AIRONE_FRAMEWORK_DIR}/tools/partitions/default.bin"
            "${CMAKE_BINARY_DIR}/partitions.bin"
    COMMENT "Copying bootloader.bin and partitions.bin"
)
