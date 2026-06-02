/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

export const AIRO_COMPILER_PATH = '/services/airo-compiler';
export const AIRO_SERIAL_PATH = '/services/airo-serial';
export const AIRO_SKETCH_PATH = '/services/airo-sketch';
export const AIRO_UPLOAD_PATH = '/services/airo-upload';

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

export interface AiroUploadClient {
    detectEspPort(): Promise<SerialPortInfo | undefined>;
    flash(request: FlashRequest): Promise<FlashResult>;
    isEsptoolAvailable(): Promise<boolean>;
    installEsptool(): Promise<boolean>;
}

// ─── DI Symbols ──────────────────────────────────────────────────────────────

export const AiroCompilerService = Symbol('AiroCompilerService');
export const AiroSerialService = Symbol('AiroSerialService');
export const AiroSketchService = Symbol('AiroSketchService');
export const AiroUploadService = Symbol('AiroUploadService');
