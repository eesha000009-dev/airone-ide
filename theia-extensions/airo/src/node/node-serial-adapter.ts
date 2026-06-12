/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Airone Proprietary License, which is available in the project root.
 *
 * SPDX-License-Identifier: Proprietary
 ********************************************************************************/

/**
 * Node SerialPort adapter for esptool-js.
 *
 * esptool-js expects a Web Serial API compatible `SerialPort` object
 * with `readable` and `writable` properties (Web Streams API).
 *
 * This adapter wraps the Node.js `serialport` npm package to provide
 * a Web Serial API compatible interface that esptool-js can use.
 *
 * This enables flashing ESP32 boards from the Electron main process
 * without requiring Python or esptool.py.
 */

import * as fs from 'fs';

// ─── Types ──────────────────────────────────────────────────────────────────

interface NodeSerialPortInstance {
    readonly path: string;
    readonly baudRate: number;
    readonly isOpen: boolean;
    open(): Promise<void>;
    close(): Promise<void>;
    write(data: Buffer | Uint8Array): Promise<void>;
    set(options: { dtr?: boolean; rts?: boolean }): Promise<void>;
    on(event: 'data', callback: (data: Buffer) => void): void;
    on(event: 'close', callback: () => void): void;
    on(event: 'error', callback: (err: Error) => void): void;
    removeListener(event: string, callback: Function): void;
    drain(): Promise<void>;
}

interface NodeSerialPortConstructor {
    new (options: { path: string; baudRate: number; autoOpen?: boolean }): NodeSerialPortInstance;
    list(): Promise<Array<{ path: string; manufacturer?: string; vendorId?: string; productId?: string }>>;
}

// ─── Web Streams Polyfill for Node.js ────────────────────────────────────────

/**
 * A ReadableStream that wraps Node serialport's data events.
 * Implements the Web Streams API ReadableStream interface.
 */
class SerialReadableStream {
    private reader: SerialReadableStreamReader | null = null;
    private port: NodeSerialPortInstance | null = null;
    private dataBuffer: Uint8Array[] = [];
    private dataResolve: ((result: { value: Uint8Array; done: boolean }) => void) | null = null;
    private closed = false;

    locked: boolean = false;

    constructor(port: NodeSerialPortInstance) {
        this.port = port;

        port.on('data', (data: Buffer) => {
            if (this.closed) return;

            const uint8 = new Uint8Array(data);
            if (this.dataResolve) {
                const resolve = this.dataResolve;
                this.dataResolve = null;
                resolve({ value: uint8, done: false });
            } else {
                this.dataBuffer.push(uint8);
            }
        });

        port.on('close', () => {
            this.closed = true;
            if (this.dataResolve) {
                const resolve = this.dataResolve;
                this.dataResolve = null;
                resolve({ value: new Uint8Array(0), done: true });
            }
        });
    }

    getReader(): SerialReadableStreamReader {
        if (this.reader) {
            throw new Error('ReadableStream already locked');
        }
        this.reader = new SerialReadableStreamReader(this);
        this.locked = true;
        return this.reader;
    }

    async pull(): Promise<{ value: Uint8Array; done: boolean }> {
        if (this.closed) {
            return { value: new Uint8Array(0), done: true };
        }

        if (this.dataBuffer.length > 0) {
            return { value: this.dataBuffer.shift()!, done: false };
        }

        return new Promise((resolve) => {
            this.dataResolve = resolve;
        });
    }

    releaseReader(): void {
        this.reader = null;
        this.locked = false;
    }

    cancel(): void {
        this.closed = true;
        if (this.dataResolve) {
            const resolve = this.dataResolve;
            this.dataResolve = null;
            resolve({ value: new Uint8Array(0), done: true });
        }
    }
}

/**
 * A ReadableStreamDefaultReader for the serial readable stream.
 */
class SerialReadableStreamReader {
    private stream: SerialReadableStream;

    constructor(stream: SerialReadableStream) {
        this.stream = stream;
    }

    async read(): Promise<{ value: Uint8Array; done: boolean }> {
        return this.stream.pull();
    }

    releaseLock(): void {
        this.stream.releaseReader();
    }

    cancel(): void {
        this.stream.cancel();
    }
}

/**
 * A WritableStream that wraps Node serialport's write method.
 * Implements the Web Streams API WritableStream interface.
 */
class SerialWritableStream {
    private writer: SerialWritableStreamWriter | null = null;
    private port: NodeSerialPortInstance | null = null;

    locked: boolean = false;

    constructor(port: NodeSerialPortInstance) {
        this.port = port;
    }

    getWriter(): SerialWritableStreamWriter {
        if (this.writer) {
            throw new Error('WritableStream already locked');
        }
        this.writer = new SerialWritableStreamWriter(this);
        this.locked = true;
        return this.writer;
    }

    async write(data: Uint8Array): Promise<void> {
        if (!this.port || !this.port.isOpen) {
            throw new Error('Serial port is not open');
        }
        await this.port.write(Buffer.from(data));
    }

    releaseWriter(): void {
        this.writer = null;
        this.locked = false;
    }
}

/**
 * A WritableStreamDefaultWriter for the serial writable stream.
 */
class SerialWritableStreamWriter {
    private stream: SerialWritableStream;

    constructor(stream: SerialWritableStream) {
        this.stream = stream;
    }

    async write(data: Uint8Array): Promise<void> {
        return this.stream.write(data);
    }

    releaseLock(): void {
        this.stream.releaseWriter();
    }

    async close(): Promise<void> {
        // No-op for serial port
    }
}

// ─── Node SerialPort Adapter ────────────────────────────────────────────────

/**
 * Adapter that wraps Node's `serialport` npm package to provide a
 * Web Serial API compatible interface for esptool-js.
 *
 * esptool-js expects a `SerialPort` object with:
 * - `readable`: ReadableStream (Web Streams API)
 * - `writable`: WritableStream (Web Streams API)
 * - `open()`: Opens the port
 * - `close()`: Closes the port
 * - `getInfo()`: Returns port info
 * - `setSignals()`: Sets control signals (DTR, RTS)
 */
export class NodeSerialPortAdapter {
    private nodePort: NodeSerialPortInstance | null = null;
    private _readable: SerialReadableStream | null = null;
    private _writable: SerialWritableStream | null = null;
    private _path: string;
    private _baudRate: number;

    constructor(path: string, baudRate: number) {
        this._path = path;
        this._baudRate = baudRate;
    }

    /**
     * Open a serial port and return a Web Serial API compatible adapter.
     */
    static async open(path: string, baudRate: number): Promise<NodeSerialPortAdapter> {
        const adapter = new NodeSerialPortAdapter(path, baudRate);
        await adapter.open();
        return adapter;
    }

    /**
     * Close a serial port adapter.
     */
    static async close(adapter: NodeSerialPortAdapter): Promise<void> {
        await adapter.close();
    }

    // ─── Web Serial API Compatible Interface ─────────────────────────────

    /**
     * Readable stream (Web Streams API) for receiving serial data.
     */
    get readable(): SerialReadableStream | null {
        return this._readable;
    }

    /**
     * Writable stream (Web Streams API) for sending serial data.
     */
    get writable(): SerialWritableStream | null {
        return this._writable;
    }

    /**
     * Open the serial port.
     */
    async open(): Promise<void> {
        if (this.nodePort && this.nodePort.isOpen) {
            return; // Already open
        }

        // Dynamically import serialport
        const { SerialPort } = require('serialport') as { SerialPort: NodeSerialPortConstructor };

        this.nodePort = new SerialPort({
            path: this._path,
            baudRate: this._baudRate,
            autoOpen: false,
        });

        await this.nodePort.open();

        // Create Web Streams API compatible streams
        this._readable = new SerialReadableStream(this.nodePort);
        this._writable = new SerialWritableStream(this.nodePort);
    }

    /**
     * Close the serial port.
     */
    async close(): Promise<void> {
        if (this._readable) {
            this._readable.cancel();
            this._readable = null;
        }
        this._writable = null;

        if (this.nodePort && this.nodePort.isOpen) {
            try {
                await this.nodePort.close();
            } catch {
                // Ignore close errors
            }
            this.nodePort = null;
        }
    }

    /**
     * Get serial port information (Web Serial API compatible).
     */
    getInfo(): { vendorId?: string; productId?: string } {
        return {};
    }

    /**
     * Set control signals on the serial port.
     * Used by esptool-js for bootloader reset sequence.
     */
    async setSignals(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void> {
        if (!this.nodePort || !this.nodePort.isOpen) {
            throw new Error('Serial port is not open');
        }

        await this.nodePort.set({
            dtr: signals.dataTerminalReady,
            rts: signals.requestToSend,
        });
    }

    /**
     * Get the port path.
     */
    get path(): string {
        return this._path;
    }

    /**
     * Get the baud rate.
     */
    get baudRate(): number {
        return this._baudRate;
    }

    /**
     * Check if the port is open.
     */
    get isOpen(): boolean {
        return this.nodePort?.isOpen ?? false;
    }
}
