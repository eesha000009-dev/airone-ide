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

# ─── Cross-Compiler Configuration ────────────────────────────────────────────
# Force CMake to use our bundled cross-compiler. These MUST be set BEFORE
# project() so CMake uses them for language detection (not the host compiler).

set(CMAKE_C_COMPILER   "${AIRONE_COMPILER_DIR}/bin/xtensa-esp32-elf-gcc"     CACHE FILEPATH "C compiler")
set(CMAKE_CXX_COMPILER "${AIRONE_COMPILER_DIR}/bin/xtensa-esp32-elf-g++"     CACHE FILEPATH "C++ compiler")
set(CMAKE_ASM_COMPILER "${AIRONE_COMPILER_DIR}/bin/xtensa-esp32-elf-gcc"     CACHE FILEPATH "ASM compiler")
set(CMAKE_AR           "${AIRONE_COMPILER_DIR}/bin/xtensa-esp32-elf-ar"      CACHE FILEPATH "Archiver")
set(CMAKE_RANLIB       "${AIRONE_COMPILER_DIR}/bin/xtensa-esp32-elf-ranlib"  CACHE FILEPATH "Ranlib")

# Critical for cross-compilation: during compiler detection, CMake normally
# tries to LINK a test program. With a cross-compiler targeting ESP32, linking
# would fail (no standard libc). STATIC_LIBRARY tells CMake to only compile
# to object files during detection — never link.
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)

# ─── Project Setup ────────────────────────────────────────────────────────────

project(AironeFirmware C CXX ASM)

# ─── ESP32 SDK Paths ─────────────────────────────────────────────────────────

set(AIRONE_SDK_DIR "${AIRONE_FRAMEWORK_DIR}/tools/sdk/${AIRONE_BOARD}")

# ─── Compilation Flags ───────────────────────────────────────────────────────
# These flags match what the Arduino-ESP32 core and PlatformIO use.

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
    -DARDUINO_USB_MODE=1
    -DARDUINO_USB_CDC_ON_BOOT=0
    -DESP_PLATFORM
    -DBOARD_HAS_WIFI
)

# Note: Do NOT define -DARDUINO=10820 here — the Arduino core headers define
# ARDUINO themselves, and redefining it causes warnings on every compile unit.

# ─── Include Paths ───────────────────────────────────────────────────────────

set(INCLUDE_DIRS
    "${AIRONE_FRAMEWORK_DIR}/cores/esp32"
    "${AIRONE_FRAMEWORK_DIR}/variants/${AIRONE_BOARD}"
    "${AIRONE_SDK_DIR}/include"
    "${AIRONE_SDK_DIR}/qio_qspi/include"
    "${AIRONE_SDK_DIR}/include/config"
    "${AIRONE_FRAMEWORK_DIR}/libraries"
)

# Convert include dirs to -I flags (only if they exist)
foreach(INC_DIR ${INCLUDE_DIRS})
    if(EXISTS "${INC_DIR}")
        list(APPEND INCLUDE_FLAGS "-I${INC_DIR}")
    endif()
endforeach()

set(CMAKE_C_FLAGS   "${CMAKE_C_FLAGS} ${COMMON_FLAGS} ${INCLUDE_FLAGS}")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${COMMON_FLAGS} ${INCLUDE_FLAGS}")
set(CMAKE_ASM_FLAGS "${CMAKE_ASM_FLAGS} ${COMMON_FLAGS} ${INCLUDE_FLAGS}")

# ─── Arduino Core Static Library ─────────────────────────────────────────────
# Compile all .cpp files from cores/esp32/ into a static library.
# This provides setup(), loop(), pinMode(), digitalWrite(), Serial, WiFi, etc.

file(GLOB ARDUINO_CORE_SOURCES
    "${AIRONE_FRAMEWORK_DIR}/cores/esp32/*.cpp"
    "${AIRONE_FRAMEWORK_DIR}/cores/esp32/*.c"
)

# The main.cpp in cores/esp32/ contains the real main() that calls
# app_main() → setup()/loop(). We need it in the core library.
add_library(arduino_core STATIC ${ARDUINO_CORE_SOURCES})

target_include_directories(arduino_core PRIVATE
    "${AIRONE_FRAMEWORK_DIR}/cores/esp32"
    "${AIRONE_FRAMEWORK_DIR}/variants/${AIRONE_BOARD}"
    "${AIRONE_SDK_DIR}/include"
    "${AIRONE_SDK_DIR}/include/config"
    "${AIRONE_SDK_DIR}/qio_qspi/include"
)

# ─── User Sketch Executable ──────────────────────────────────────────────────

add_executable(firmware.elf ${AIRONE_SKETCH})

target_include_directories(firmware.elf PRIVATE
    "${AIRONE_FRAMEWORK_DIR}/cores/esp32"
    "${AIRONE_FRAMEWORK_DIR}/variants/${AIRONE_BOARD}"
    "${AIRONE_SDK_DIR}/include"
    "${AIRONE_SDK_DIR}/include/config"
)

# ─── Linker Configuration ────────────────────────────────────────────────────
# Link against the compiled Arduino core + pre-compiled ESP32 SDK libraries.

set(SDK_LIB_DIR "${AIRONE_SDK_DIR}/lib")
set(SDK_LD_DIR  "${AIRONE_SDK_DIR}/ld")

# Collect all .a libraries from the SDK lib directory
file(GLOB SDK_LIBS "${SDK_LIB_DIR}/*.a")

# Primary linker script + SDK linker scripts
set(LINKER_SCRIPTS
    "-T${AIRONE_FRAMEWORK_DIR}/tools/partitions/default.csv"
)

# Add SDK linker scripts if they exist
foreach(LD_SCRIPT
    "${SDK_LD_DIR}/esp32.project.ld"
    "${SDK_LD_DIR}/esp32.rom.ld"
    "${SDK_LD_DIR}/esp32.peripherals.ld"
    "${SDK_LD_DIR}/memory.ld"
    "${SDK_LD_DIR}/sections.ld"
)
    if(EXISTS "${LD_SCRIPT}")
        list(APPEND LINKER_SCRIPTS "-T${LD_SCRIPT}")
    endif()
endforeach()

set(LINKER_FLAGS
    ${LINKER_SCRIPTS}
    -L"${SDK_LIB_DIR}"
    -L"${SDK_LD_DIR}"
    -Wl,--gc-sections
    -Wl,-Map,"${CMAKE_BINARY_DIR}/firmware.map"
    --specs=nano.specs
    -u ld_include_hope_points
    -u __cxa_guard_acquire
    -u uxTaskGetStackHighWaterMark
)

target_link_libraries(firmware.elf
    arduino_core
    ${SDK_LIBS}
    -lm
    -lgcc
    -lc
    -lnano
)

set_target_properties(firmware.elf PROPERTIES
    LINK_FLAGS "${LINKER_FLAGS}"
)

# ─── Generate firmware.bin from firmware.elf ─────────────────────────────────
# Use esptool to convert the ELF to a flashable .bin image.

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

# ─── Copy bootloader.bin and partitions.bin ──────────────────────────────────
# These are pre-built in the framework — just copy them to the build directory.
# Wrapped in if(EXISTS) so the build doesn't fail if they're missing (the
# flash service handles missing bootloader/partitions gracefully).

set(BOOTLOADER_SRC "${AIRONE_SDK_DIR}/bin/bootloader_qio_80m.bin")
set(PARTITIONS_SRC "${AIRONE_FRAMEWORK_DIR}/tools/partitions/default.bin")

if(EXISTS "${BOOTLOADER_SRC}")
    add_custom_command(
        TARGET firmware.elf
        POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
                "${BOOTLOADER_SRC}"
                "${CMAKE_BINARY_DIR}/bootloader.bin"
        COMMENT "Copying bootloader.bin"
    )
endif()

if(EXISTS "${PARTITIONS_SRC}")
    add_custom_command(
        TARGET firmware.elf
        POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
                "${PARTITIONS_SRC}"
                "${CMAKE_BINARY_DIR}/partitions.bin"
        COMMENT "Copying partitions.bin"
    )
endif()
