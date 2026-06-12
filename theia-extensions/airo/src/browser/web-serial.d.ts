/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Airone Proprietary License, which is available in the project root.
 *
 * SPDX-License-Identifier: Proprietary
 ********************************************************************************/

// Web Serial API types — these are not in the default TypeScript DOM lib
// but are supported in Electron and Chromium-based browsers.

interface SerialPortInfo {
    vendorId?: string;
    productId?: string;
}

interface SerialPort {
    readonly readable: ReadableStream | null;
    readonly writable: WritableStream | null;
    getInfo(): SerialPortInfo;
    open(options: SerialOpenOptions): Promise<void>;
    close(): Promise<void>;
    setSignals(signals: SerialOutputSignals): Promise<void>;
    getSignals(): Promise<SerialInputSignals>;
}

interface SerialOpenOptions {
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: 'none' | 'even' | 'odd';
    flowControl?: 'none' | 'hardware';
    bufferSize?: number;
}

interface SerialOutputSignals {
    dataTerminalReady?: boolean;
    requestToSend?: boolean;
    break?: boolean;
}

interface SerialInputSignals {
    dataCarrierDetect: boolean;
    clearToSend: boolean;
    ringIndicator: boolean;
    dataSetReady: boolean;
    dataTerminalReady: boolean;
    requestToSend: boolean;
    break: boolean;
}

interface SerialPortFilter {
    vendorId?: number;
    productId?: number;
}

interface SerialPortRequestOptions {
    filters?: SerialPortFilter[];
}

interface Serial {
    getPorts(): Promise<SerialPort[]>;
    requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
    addEventListener(type: 'connect' | 'disconnect', listener: (event: SerialEvent) => void): void;
    removeEventListener(type: 'connect' | 'disconnect', listener: (event: SerialEvent) => void): void;
}

interface SerialEvent {
    type: 'connect' | 'disconnect';
    target: SerialPort;
}

declare var Serial: {
    prototype: Serial;
    new(): Serial;
};

interface Navigator {
    serial: Serial;
}
