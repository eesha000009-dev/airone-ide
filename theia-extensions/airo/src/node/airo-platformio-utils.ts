/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

/**
 * Shared PlatformIO utility functions used by both the compiler and upload services.
 */

/** Mapping of chip type names to PlatformIO environment names. */
const PLATFORMIO_ENV_MAP: Record<string, string> = {
    'esp32': 'esp32dev',
    'esp32s2': 'esp32-s2',
    'esp32s3': 'esp32-s3',
    'esp32c3': 'esp32-c3',
    'esp8266': 'esp8266',
};

/**
 * Map a target board name to the PlatformIO environment name.
 *
 * Accepts case-insensitive input with or without hyphens/spaces.
 * Falls back to 'esp32dev' if the target is not recognized.
 */
export function getPlatformioEnvName(target: string): string {
    const normalized = target.toLowerCase().replace(/[\s\-_]/g, '');
    return PLATFORMIO_ENV_MAP[normalized] || 'esp32dev';
}

/**
 * Known ESP32 USB-to-UART vendor IDs (lowercase hex, no prefix).
 * Used for auto-detecting ESP32 boards on serial ports.
 */
export const ESP_VENDOR_IDS = new Set([
    '10c4',  // Silicon Labs CP210x
    '1a86',  // QinHeng CH340 / CH9102
    '0403',  // FTDI FT232
    '303a',  // Espressif built-in USB (ESP32-S2/S3/C3 native USB)
    '2e8a',  // Raspberry Pi Pico (RP2040 running ESP firmware)
]);

/**
 * Flash offset for each chip family.
 * Used when only a single firmware.bin is available (no 3-file flash).
 */
export const CHIP_FLASH_OFFSETS: Record<string, string> = {
    esp32:    '0x10000',
    esp32s2:  '0x10000',
    esp32s3:  '0x0',
    esp32c3:  '0x0',
    esp8266:  '0x10000',
};

/** Default baud rate for flashing ESP32 boards. */
export const DEFAULT_BAUD_RATE = 460800;

/** Maximum time (ms) to wait for a flash operation to complete. */
export const FLASH_TIMEOUT_MS = 120_000;
