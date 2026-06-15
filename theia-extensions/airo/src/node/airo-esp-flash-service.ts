/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_BAUD_RATE } from './airo-platformio-utils';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FlashBinary {
    data: Uint8Array;
    address: number;
    label: string; // for progress messages
}

export type FlashStage = 'connecting' | 'detecting' | 'erasing' | 'writing' | 'verifying' | 'resetting' | 'complete' | 'error';

export interface FlashProgress {
    percent: number;
    message: string;
    stage: FlashStage;
}

export interface FlashResult {
    success: boolean;
    chipName?: string;
    error?: string;
    output: string;
    portUsed?: string;
}

// ─── Duck-type Readable / Writable for esptool-js Transport ─────────────────
//
// esptool-js's Transport expects a Web Serial API-compatible port object.
// It accesses `port.readable.getReader()`, `port.writable.getWriter()`,
// `port.open()`, `port.close()`, `port.setSignals()`, and `port.getInfo()`.
//
// We provide duck-type implementations of the readable/writable streams
// that feed data from/to Node's serialport package.

/**
 * A readable stream compatible with the Web Streams API getReader() pattern.
 * Data is enqueued from Node serialport's 'data' events.
 */
class AdapterReadable {
    private _locked = false;
    private dataQueue: Uint8Array[] = [];
    private waitingReader: ((result: { value: Uint8Array | undefined; done: boolean }) => void) | null = null;
    private _closed = false;

    get locked(): boolean {
        return this._locked;
    }

    getReader(): { read(): Promise<{ value: Uint8Array | undefined; done: boolean }>; releaseLock(): void } {
        if (this._locked) {
            throw new Error('AdapterReadable is already locked');
        }
        this._locked = true;

        const self = this;
        return {
            async read(): Promise<{ value: Uint8Array | undefined; done: boolean }> {
                return new Promise<{ value: Uint8Array | undefined; done: boolean }>(resolve => {
                    if (self.dataQueue.length > 0) {
                        resolve({ value: self.dataQueue.shift()!, done: false });
                    } else if (self._closed) {
                        resolve({ value: undefined, done: true });
                    } else {
                        self.waitingReader = resolve;
                    }
                });
            },
            releaseLock(): void {
                self._locked = false;
            },
        };
    }

    /** Enqueue data from Node serialport. Resolves a waiting reader if one exists. */
    enqueue(data: Uint8Array): void {
        if (this.waitingReader) {
            const resolve = this.waitingReader;
            this.waitingReader = null;
            resolve({ value: data, done: false });
        } else {
            this.dataQueue.push(data);
        }
    }

    /** Signal end-of-stream. */
    close(): void {
        this._closed = true;
        if (this.waitingReader) {
            const resolve = this.waitingReader;
            this.waitingReader = null;
            resolve({ value: undefined, done: true });
        }
    }
}

/**
 * A writable stream compatible with the Web Streams API getWriter() pattern.
 * Writes are forwarded to Node's serialport.
 */
class AdapterWritable {
    private _locked = false;
    private writeCallback: (data: Uint8Array) => Promise<void>;

    constructor(writeCallback: (data: Uint8Array) => Promise<void>) {
        this.writeCallback = writeCallback;
    }

    get locked(): boolean {
        return this._locked;
    }

    getWriter(): { write(data: Uint8Array): Promise<void>; releaseLock(): void; close(): Promise<void> } {
        if (this._locked) {
            throw new Error('AdapterWritable is already locked');
        }
        this._locked = true;

        const self = this;
        return {
            async write(data: Uint8Array): Promise<void> {
                await self.writeCallback(data);
            },
            releaseLock(): void {
                self._locked = false;
            },
            async close(): Promise<void> {
                // no-op for our adapter
            },
        };
    }
}

// ─── Node SerialPort Adapter ────────────────────────────────────────────────

/**
 * Adapter that wraps Node's `serialport` package to provide a Web Serial API
 * compatible interface that esptool-js's `Transport` can use.
 *
 * Key methods Transport uses on the device/port object:
 *   - `port.open({ baudRate, ... })`
 *   - `port.close()`
 *   - `port.readable`  → getter returning an object with `getReader()` and `locked`
 *   - `port.writable`  → getter returning an object with `getWriter()` and `locked`
 *   - `port.setSignals({ dataTerminalReady, requestToSend })`
 *   - `port.getInfo()`  → returns `{ usbVendorId?, usbProductId? }`
 */
class NodeSerialPortAdapter {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private port: any; // Node serialport SerialPort instance
    private _readable: AdapterReadable | null = null;
    private _writable: AdapterWritable | null = null;
    private _vendorId: string | undefined;
    private _productId: string | undefined;
    private _isOpen = false;

    constructor(portPath: string, vendorId?: string, productId?: string) {
        // Dynamic import of serialport (may not be available in all environments)
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { SerialPort } = require('serialport');
        this.port = new SerialPort({ path: portPath, baudRate: 115200, autoOpen: false });
        this._vendorId = vendorId;
        this._productId = productId;
    }

    /** Web Serial API compatible readable stream (null when port is closed). */
    get readable(): AdapterReadable | null {
        return this._readable;
    }

    /** Web Serial API compatible writable stream (null when port is closed). */
    get writable(): AdapterWritable | null {
        return this._writable;
    }

    /**
     * Open the serial port with the given options.
     * Sets up readable/writable streams and data forwarding.
     */
    async open(options: { baudRate?: number; dataBits?: number; stopBits?: number; bufferSize?: number; parity?: string; flowControl?: string }): Promise<void> {
        const baudRate = options.baudRate || 115200;

        return new Promise<void>((resolve, reject) => {
            // Open the Node serialport
            this.port.open((err: Error | null) => {
                if (err) {
                    reject(err);
                    return;
                }

                this._isOpen = true;

                // Update baud rate if different from default
                if (baudRate !== 115200) {
                    try {
                        this.port.update({ baudRate });
                    } catch {
                        // Some platforms may not support update; ignore
                    }
                }

                // Set up the readable stream — data from Node serialport → esptool-js
                this._readable = new AdapterReadable();

                // Set up the writable stream — data from esptool-js → Node serialport
                this._writable = new AdapterWritable(async (data: Uint8Array) => {
                    return new Promise<void>((res, rej) => {
                        if (!this._isOpen) {
                            rej(new Error('Port is not open'));
                            return;
                        }
                        this.port.write(Buffer.from(data), (writeErr: Error | null) => {
                            if (writeErr) {
                                rej(writeErr);
                            } else {
                                this.port.drain();
                                res();
                            }
                        });
                    });
                });

                // Forward data from Node serialport to the readable stream
                this.port.on('data', (data: Buffer) => {
                    if (this._readable) {
                        this._readable.enqueue(new Uint8Array(data));
                    }
                });

                this.port.on('close', () => {
                    this._isOpen = false;
                    if (this._readable) {
                        this._readable.close();
                    }
                    this._readable = null;
                    this._writable = null;
                });

                this.port.on('error', (portErr: Error) => {
                    console.error('[NodeSerialPortAdapter] Port error:', portErr.message);
                    this._isOpen = false;
                    if (this._readable) {
                        this._readable.close();
                    }
                    this._readable = null;
                    this._writable = null;
                });

                resolve();
            });
        });
    }

    /**
     * Close the serial port and clean up streams.
     */
    async close(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this._readable) {
                this._readable.close();
            }
            this._readable = null;
            this._writable = null;

            if (this._isOpen && this.port.isOpen) {
                this.port.close((err: Error | null) => {
                    this._isOpen = false;
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            } else {
                this._isOpen = false;
                resolve();
            }
        });
    }

    /**
     * Set serial control signals (DTR, RTS).
     * Used by esptool-js Transport for bootloader reset sequences.
     */
    async setSignals(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void> {
        if (!this._isOpen) {
            return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const settings: any = {};
        if (signals.dataTerminalReady !== undefined) {
            settings.dtr = signals.dataTerminalReady;
        }
        if (signals.requestToSend !== undefined) {
            settings.rts = signals.requestToSend;
        }
        try {
            this.port.set(settings);
        } catch {
            // Some platforms may not support all signal controls
        }
    }

    /**
     * Return port info in the format expected by esptool-js Transport.
     * Transport.getInfo() calls `this.device.getInfo()` and accesses
     * `.usbVendorId` and `.usbProductId` as numbers.
     */
    getInfo(): { usbVendorId?: number; usbProductId?: number } {
        return {
            usbVendorId: this._vendorId ? parseInt(this._vendorId, 16) : undefined,
            usbProductId: this._productId ? parseInt(this._productId, 16) : undefined,
        };
    }
}

// ─── Dynamic ESM import helper ──────────────────────────────────────────────

/**
 * Dynamic import of the `esptool-js` ESM module from a CommonJS context.
 *
 * TypeScript's `import()` expression compiles to `require()` in CJS mode,
 * which fails for ESM packages. Using `Function()` preserves the native
 * dynamic `import()` at runtime.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _esptoolJsCache: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importEsptoolJs(): Promise<any> {
    if (_esptoolJsCache) {
        return _esptoolJsCache;
    }
    // Use Function() to bypass TypeScript's import() → require() transform
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    _esptoolJsCache = await new Function('module', 'return import(module)')('esptool-js');
    return _esptoolJsCache;
}

// ─── Flash Backend Service ──────────────────────────────────────────────────

/**
 * ESP32 firmware flash service that runs in the Electron main process.
 *
 * Uses esptool-js (the same JS library used in the browser) with a
 * Node serialport adapter to flash ESP32 boards without requiring
 * Python or esptool.py.
 *
 * Supports 3-file flash:
 *   - bootloader.bin @ 0x1000
 *   - partitions.bin  @ 0x8000
 *   - firmware.bin    @ 0x10000
 */
export class AiroEspFlashBackendService {

    /**
     * Flash firmware to an ESP32 board via Node serialport + esptool-js.
     *
     * @param portPath   Serial port path (e.g. COM3, /dev/ttyUSB0)
     * @param binaries   Array of FlashBinary objects (data + address + label)
     * @param onProgress Optional progress callback
     * @returns FlashResult indicating success or failure
     */
    async flashFirmware(
        portPath: string,
        binaries: FlashBinary[],
        onProgress?: (progress: FlashProgress) => void,
    ): Promise<FlashResult> {
        const outputLines: string[] = [];
        const log = (msg: string) => outputLines.push(msg);

        let adapter: NodeSerialPortAdapter | undefined;

        try {
            // 1. Create adapter
            onProgress?.({ percent: 2, message: 'Opening serial port...', stage: 'connecting' });
            adapter = new NodeSerialPortAdapter(portPath);

            // 2. Import esptool-js dynamically
            const { ESPLoader, Transport } = await importEsptoolJs();

            // 3. Create Transport and ESPLoader
            // Cast adapter to `any` because Transport expects a Web Serial API SerialPort,
            // but our duck-type adapter provides the same interface.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const transport = new Transport(adapter as any, true);

            const esploader = new ESPLoader({
                transport,
                baudrate: DEFAULT_BAUD_RATE,
                terminal: {
                    clean: () => { /* no-op */ },
                    writeLine: (data: string) => {
                        log(data);
                    },
                    write: (data: string) => {
                        // Parse progress from write data
                        const writeMatch = data.match(/\((\d+)%\)/);
                        if (writeMatch && onProgress) {
                            const percent = parseInt(writeMatch[1], 10);
                            onProgress({
                                percent,
                                message: `Writing... ${percent}%`,
                                stage: 'writing',
                            });
                        }
                    },
                },
            });

            // 4. Connect and detect chip
            onProgress?.({ percent: 5, message: 'Connecting to ESP32...', stage: 'detecting' });
            const chipName = await esploader.main();
            log(`Connected to: ${chipName}`);
            onProgress?.({ percent: 10, message: `Detected: ${chipName}`, stage: 'detecting' });

            // 5. Flash all binaries
            onProgress?.({ percent: 15, message: 'Starting flash...', stage: 'erasing' });

            const fileArray = binaries.map(b => ({
                data: b.data,
                address: b.address,
            }));

            await esploader.writeFlash({
                fileArray,
                flashMode: 'keep',
                flashFreq: 'keep',
                flashSize: 'keep',
                eraseAll: false,
                compress: true,
                reportProgress: (fileIndex: number, written: number, total: number) => {
                    if (onProgress && total > 0) {
                        const filePercent = Math.round((written / total) * 100);
                        const totalPercent = 15 + Math.round(((fileIndex + written / total) / binaries.length) * 80);
                        onProgress({
                            percent: Math.min(totalPercent, 95),
                            message: `Writing ${binaries[fileIndex]?.label || 'firmware'}... ${filePercent}%`,
                            stage: 'writing',
                        });
                    }
                },
            });

            log(`Flashed ${binaries.length} binary file(s) successfully.`);

            // 6. Hard reset
            onProgress?.({ percent: 95, message: 'Resetting board...', stage: 'resetting' });
            try {
                await esploader.after('hard_reset');
                log('Board reset successfully.');
            } catch {
                log('Could not auto-reset. Press EN/RST button.');
            }

            onProgress?.({ percent: 100, message: 'Flash complete!', stage: 'complete' });

            return { success: true, chipName, output: outputLines.join('\n'), portUsed: portPath };

        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            log(`Flash failed: ${msg}`);
            onProgress?.({ percent: -1, message: msg, stage: 'error' });

            let userError = msg;
            if (msg.includes('Failed to connect') || msg.includes('timed out')) {
                userError = 'Could not connect to ESP32. Ensure board is connected and try holding BOOT button.';
            } else if (msg.includes('permission') || msg.includes('access')) {
                userError = 'Serial port access denied. Check permissions and ensure no other program is using the port.';
            }

            return { success: false, error: userError, output: outputLines.join('\n'), portUsed: portPath };

        } finally {
            // Clean up — close the serial port
            try {
                if (adapter) {
                    await adapter.close();
                }
            } catch {
                // ignore cleanup errors
            }
        }
    }

    /**
     * Read binary files for 3-file flash from a PlatformIO build directory.
     *
     * Looks for:
     *   - bootloader.bin  @ 0x1000
     *   - partitions.bin   @ 0x8000
     *   - firmware.bin     @ 0x10000
     *
     * Falls back to a single firmware.bin @ 0x10000 if the .pio directory
     * doesn't exist (e.g. for legacy Arduino CLI builds).
     */
    readFlashBinaries(buildDir: string, envName?: string): FlashBinary[] {
        const binaries: FlashBinary[] = [];

        // Try PlatformIO build directory first
        if (envName) {
            const pioDir = path.join(buildDir, '.pio', 'build', envName);
            if (fs.existsSync(pioDir)) {
                this.tryAddBinary(binaries, path.join(pioDir, 'bootloader.bin'), 0x1000, 'bootloader');
                this.tryAddBinary(binaries, path.join(pioDir, 'partitions.bin'), 0x8000, 'partition table');
                this.tryAddBinary(binaries, path.join(pioDir, 'firmware.bin'), 0x10000, 'firmware');
            }
        }

        // Try legacy build directory structure (non-PlatformIO builds)
        if (binaries.length === 0) {
            // Some build systems put bootloader/partitions alongside the firmware
            this.tryAddBinary(binaries, path.join(buildDir, 'bootloader.bin'), 0x1000, 'bootloader');
            this.tryAddBinary(binaries, path.join(buildDir, 'partitions.bin'), 0x8000, 'partition table');
        }

        // Add the main firmware binary
        const sketchName = path.basename(buildDir);
        const firmwarePaths = [
            path.join(buildDir, `${sketchName}.ino.bin`),
            path.join(buildDir, 'firmware.bin'),
        ];
        if (envName) {
            firmwarePaths.unshift(path.join(buildDir, '.pio', 'build', envName, 'firmware.bin'));
        }

        for (const fp of firmwarePaths) {
            if (fs.existsSync(fp)) {
                this.tryAddBinary(binaries, fp, 0x10000, 'firmware');
                break; // Use the first firmware found
            }
        }

        // Absolute fallback: if still nothing, try any .bin in the build dir
        if (binaries.length === 0) {
            try {
                const files = fs.readdirSync(buildDir).filter(f => f.endsWith('.bin'));
                for (const file of files) {
                    const filePath = path.join(buildDir, file);
                    this.tryAddBinary(binaries, filePath, 0x10000, path.basename(file, '.bin'));
                }
            } catch {
                // ignore
            }
        }

        return binaries;
    }

    /**
     * Helper to add a binary file to the array if it exists.
     */
    private tryAddBinary(binaries: FlashBinary[], filePath: string, address: number, label: string): void {
        try {
            if (fs.existsSync(filePath)) {
                const data = new Uint8Array(fs.readFileSync(filePath));
                if (data.length > 0) {
                    binaries.push({ data, address, label });
                }
            }
        } catch {
            // ignore — file may not exist or be readable
        }
    }
}
