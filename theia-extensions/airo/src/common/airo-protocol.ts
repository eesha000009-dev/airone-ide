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

// ─── DI Symbols ──────────────────────────────────────────────────────────────

export const AiroCompilerService = Symbol('AiroCompilerService');
export const AiroSerialService = Symbol('AiroSerialService');
export const AiroSketchService = Symbol('AiroSketchService');
