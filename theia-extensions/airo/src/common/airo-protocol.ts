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

export interface CompileRequest {
    filePath: string;
    target: 'esp32' | 'stm32';
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

export interface SerialPortInfo {
    path: string;
    manufacturer?: string;
    pnpId?: string;
    vendorId?: string;
    productId?: string;
}

export interface AiroCompilerClient {
    compile(request: CompileRequest): Promise<CompileResult>;
    getTemplate(): Promise<string>;
}

export interface AiroSerialClient {
    listPorts(): Promise<SerialPortInfo[]>;
    connect(portPath: string, baudRate: number): Promise<boolean>;
    disconnect(): Promise<boolean>;
    onData(callback: (data: string) => void): void;
    sendData(data: string): Promise<boolean>;
    isConnected(): boolean;
}

export const AiroCompilerService = Symbol('AiroCompilerService');
export const AiroSerialService = Symbol('AiroSerialService');
