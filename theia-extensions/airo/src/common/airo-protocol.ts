/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Airone Proprietary License, which is available in the project root.
 *
 * SPDX-License-Identifier: Proprietary
 ********************************************************************************/

export const AIRO_COMPILER_PATH = '/services/airo-compiler';
export const AIRO_SERIAL_PATH = '/services/airo-serial';
export const AIRO_SKETCH_PATH = '/services/airo-sketch';
export const AIRO_UPLOAD_PATH = '/services/airo-upload';

// ─── Shared Constants ────────────────────────────────────────────────────────

/** Default baud rate for flashing ESP32 boards */
export const DEFAULT_FLASH_BAUD_RATE = 460800;

/** Default serial monitor baud rate */
export const DEFAULT_MONITOR_BAUD_RATE = 115200;

/** GitHub releases URL for Airone IDE */
export const RELEASES_URL = 'https://github.com/eesha000009-dev/airone-ide/releases';

/** Map .airo target names to PlatformIO board IDs */
export const TARGET_TO_PIO_BOARD: Record<string, string> = {
    esp32: 'esp32dev',
    esp32s2: 'esp32-s2-saola-1',
    esp32s3: 'esp32-s3-devkitc-1',
    esp32c3: 'esp32-c3-devkitm-1',
    esp8266: 'esp01_1m',
};

/** Map PlatformIO board IDs to chip families */
export const PIO_BOARD_TO_CHIP: Record<string, string> = {
    'esp32dev': 'esp32',
    'esp32-s2-saola-1': 'esp32s2',
    'esp32-s3-devkitc-1': 'esp32s3',
    'esp32-c3-devkitm-1': 'esp32c3',
    'esp01_1m': 'esp8266',
};

/** Map chip families to PlatformIO platform names */
export const CHIP_TO_PIO_PLATFORM: Record<string, string> = {
    esp32: 'espressif32',
    esp32s2: 'espressif32',
    esp32s3: 'espressif32',
    esp32c3: 'espressif32',
    esp8266: 'espressif8266',
};

/** Flash offsets for each chip family */
export const CHIP_FLASH_OFFSETS: Record<string, { bootloader: string; partitions: string; firmware: string }> = {
    esp32:    { bootloader: '0x1000', partitions: '0x8000', firmware: '0x10000' },
    esp32s2:  { bootloader: '0x1000', partitions: '0x8000', firmware: '0x10000' },
    esp32s3:  { bootloader: '0x0',    partitions: '0x8000', firmware: '0x10000' },
    esp32c3:  { bootloader: '0x0',    partitions: '0x8000', firmware: '0x10000' },
    esp8266:  { bootloader: '0x0',    partitions: '0x0',    firmware: '0x10000' },
};

/** Known ESP32 USB-to-UART vendor IDs (lowercase hex, no prefix) */
export const ESP_VENDOR_IDS = new Set([
    '10c4',  // Silicon Labs CP210x
    '1a86',  // QinHeng CH340 / CH9102
    '0403',  // FTDI FT232
    '303a',  // Espressif built-in USB (ESP32-S2/S3/C3 native USB)
    '2e8a',  // Raspberry Pi Pico (RP2040 running ESP firmware)
]);

/** Supported chip types list (for validation and error messages) */
export const SUPPORTED_CHIP_TYPES = ['esp32', 'esp32s2', 'esp32s3', 'esp32c3', 'esp8266'];

// ─── Compiler Protocol ───────────────────────────────────────────────────────

export interface CompileRequest {
    filePath: string;
    target: string;
    outputDir: string;
    wifiSsid?: string;
    wifiPass?: string;
}

export interface CompileResult {
    success: boolean;
    output: string;
    error?: string;
    generatedFiles?: string[];
    /** Path to the compiled .bin firmware file (produced by PlatformIO) */
    binaryPath?: string;
}

export interface VerifyResult {
    success: boolean;
    output: string;
    error?: string;
    errors?: SyntaxError[];
}

export interface SyntaxError {
    line: number;
    column: number;
    message: string;
    severity: 'error' | 'warning';
}

// ─── Serial Port Protocol ────────────────────────────────────────────────────

export interface SerialPortInfo {
    path: string;
    manufacturer?: string;
    pnpId?: string;
    vendorId?: string;
    productId?: string;
}

// ─── Board Protocol ──────────────────────────────────────────────────────────

export interface BoardInfo {
    id: string;
    name: string;
    fqbn: string;
    platform: string;
}

// ─── Sketch Protocol ─────────────────────────────────────────────────────────

export interface ExampleSketch {
    name: string;
    category: string;
    description: string;
    code: string;
}

export interface SketchInfo {
    name: string;
    path: string;
    mainFile: string;
}

// ─── Service Interfaces (Backend) ────────────────────────────────────────────

export interface AiroCompilerClient {
    compile(request: CompileRequest): Promise<CompileResult>;
    verify(filePath: string): Promise<VerifyResult>;
    getTemplate(): Promise<string>;
}

export interface AiroSerialClient {
    listPorts(): Promise<SerialPortInfo[]>;
    connect(portPath: string, baudRate: number): Promise<boolean>;
    disconnect(): Promise<boolean>;
    /** Read any available data from the serial port (polling mode) */
    readAvailable(): Promise<string>;
    sendData(data: string): Promise<boolean>;
    isConnected(): boolean;
}

export interface AiroSketchClient {
    newSketch(name: string): Promise<SketchInfo>;
    newSketchFromExample(name: string, code: string): Promise<SketchInfo>;
    listExamples(): Promise<ExampleSketch[]>;
    loadExample(name: string): Promise<string>;
    verify(filePath: string): Promise<VerifyResult>;
    getBoards(): Promise<BoardInfo[]>;
    getDefaultBoard(): Promise<BoardInfo>;
}

// ─── Upload Protocol ─────────────────────────────────────────────────────────

export interface FlashRequest {
    /** Absolute path to the .bin firmware file */
    binaryPath: string;
    /** Serial port path (e.g. COM3, /dev/ttyUSB0). Auto-detected if omitted. */
    portPath?: string;
    /** Chip family: esp32, esp32s2, esp32s3, esp32c3, esp8266 */
    chipType: string;
    /** Baud rate for the flash operation. Default: 460800 */
    baudRate?: number;
    /** Flash offset override. Default: auto-detect based on chipType. */
    flashOffset?: string;
}

export interface FlashResult {
    success: boolean;
    output: string;
    error?: string;
    portUsed?: string;
}

export interface CompileResultBinary {
    success: boolean;
    output: string;
    error?: string;
    /** Path to the compiled .bin firmware file */
    binaryPath?: string;
    /** List of all generated files */
    generatedFiles?: string[];
}

export interface AiroUploadClient {
    detectEspPort(): Promise<SerialPortInfo | undefined>;
    flash(request: FlashRequest): Promise<FlashResult>;
    isEsptoolAvailable(): Promise<boolean>;
    installEsptool(): Promise<boolean>;
    /**
     * Compile an .airo file and flash the resulting firmware to an ESP32 board.
     * Handles the full pipeline: compile → PlatformIO build → esptool flash.
     */
    flashAiroFile(airoFilePath: string, chipType: string, portPath?: string): Promise<FlashResult>;
    /**
     * Compile an .airo file to produce a .bin firmware binary (no flashing).
     * Used by the frontend esptool-js flash flow: compile on backend, flash on frontend.
     */
    compileAiroFile(airoFilePath: string, chipType: string): Promise<CompileResultBinary>;
    /**
     * Read a binary file and return it as a base64-encoded string.
     * Used by the frontend to get .bin firmware data for esptool-js flashing.
     */
    readBinaryFile(filePath: string): Promise<string | undefined>;
}

// ─── DI Symbols ──────────────────────────────────────────────────────────────

export const AiroCompilerService = Symbol('AiroCompilerService');
export const AiroSerialService = Symbol('AiroSerialService');
export const AiroSketchService = Symbol('AiroSketchService');
export const AiroUploadService = Symbol('AiroUploadService');
