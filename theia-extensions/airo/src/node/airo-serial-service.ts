/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { injectable } from '@theia/core/shared/inversify';
import { SerialPortInfo } from '../common/airo-protocol';

/**
 * Serial port service for communicating with ESP32 and other boards.
 *
 * Uses the `serialport` npm package when available. If serialport is not
 * installed (e.g., in a browser-only environment, or the native module
 * fails to load in a packaged Electron app), the service gracefully
 * degrades and reports no available ports.
 *
 * CRITICAL: The serialport native module is loaded LAZILY (only when
 * actually needed) and wrapped in comprehensive error handling to prevent
 * it from crashing the entire Theia backend process.
 */

interface SerialPortInstance {
    isOpen: boolean;
    open(callback: (err?: Error) => void): void;
    close(callback?: (err?: Error) => void): void;
    write(data: string, callback: (err?: Error) => void): void;
    pipe(parser: unknown): unknown;
    on(event: string, callback: (data: string | Buffer) => void): void;
}

interface SerialPortListEntry {
    path: string;
    manufacturer?: string;
    pnpId?: string;
    vendorId?: string;
    productId?: string;
}

/** Cached serialport module — loaded lazily */
let serialportModule: any = undefined;
let serialportChecked = false;

/**
 * Safely load the serialport native module.
 * Returns the module if available, or null if not.
 * This is separated out so that a failure to load the native module
 * doesn't crash the entire service or backend.
 */
function getSerialportModule(): any | null {
    if (serialportChecked) {
        return serialportModule;
    }
    serialportChecked = true;

    try {
        // Attempt to require the serialport module
        // This can fail if:
        // 1. The native addon (.node) is missing (not built for this platform)
        // 2. The native addon was built for a different Electron/Node version
        // 3. The .node file is corrupt or missing dependencies
        serialportModule = require('serialport');
        console.log('[AiroSerialService] serialport module loaded successfully.');
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[AiroSerialService] serialport package not available. Serial communication will be disabled.');
        console.warn('[AiroSerialService] Reason:', message);
        serialportModule = null;
    }

    return serialportModule;
}

@injectable()
export class AiroSerialService {
    private port: SerialPortInstance | undefined = undefined;
    private dataBuffer: string = '';

    /**
     * Check if the serialport module is available.
     * Loads it lazily on first check.
     */
    private isSerialportAvailable(): boolean {
        return getSerialportModule() !== null;
    }

    async listPorts(): Promise<SerialPortInfo[]> {
        const sp = getSerialportModule();
        if (!sp) {
            return [];
        }

        try {
            const { SerialPort } = sp;
            if (!SerialPort || typeof SerialPort.list !== 'function') {
                console.warn('[AiroSerialService] SerialPort.list not available.');
                return [];
            }
            const ports = await SerialPort.list();
            return ports.map((p: SerialPortListEntry) => ({
                path: p.path,
                manufacturer: p.manufacturer || undefined,
                pnpId: p.pnpId || undefined,
                vendorId: p.vendorId || undefined,
                productId: p.productId || undefined,
            }));
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[AiroSerialService] Failed to list serial ports:', message);
            return [];
        }
    }

    async connect(portPath: string, baudRate: number): Promise<boolean> {
        const sp = getSerialportModule();
        if (!sp) {
            console.error('[AiroSerialService] Cannot connect: serialport package not available.');
            return false;
        }

        try {
            if (this.port && this.port.isOpen) {
                await this.disconnect();
            }

            const { SerialPort } = sp;

            this.port = new SerialPort({
                path: portPath,
                baudRate: baudRate,
                autoOpen: false,
            });

            // Try to load the readline parser
            try {
                const parserReadline = require('@serialport/parser-readline');
                const { ReadlineParser } = parserReadline;
                const parser = this.port!.pipe(new ReadlineParser({ delimiter: '\n' })) as {
                    on: (event: string, cb: (data: string) => void) => void;
                };
                parser.on('data', (line: string) => {
                    this.dataBuffer += line + '\n';
                });
            } catch {
                // If parser not available, use raw data
                console.warn('[AiroSerialService] @serialport/parser-readline not available, using raw data mode.');
                this.port!.on('data', (chunk: string | Buffer) => {
                    this.dataBuffer += chunk.toString();
                });
            }

            return new Promise(resolve => {
                this.port!.open((err?: Error) => {
                    if (err) {
                        console.error('[AiroSerialService] Failed to open port:', err.message);
                        this.port = undefined;
                        resolve(false);
                    } else {
                        console.log(`[AiroSerialService] Connected to ${portPath} at ${baudRate} baud`);
                        resolve(true);
                    }
                });

                // Timeout after 5 seconds
                setTimeout(() => {
                    if (this.port && !this.port.isOpen) {
                        console.error('[AiroSerialService] Connection timeout');
                        try { this.port.close(); } catch { /* ignore */ }
                        this.port = undefined;
                        resolve(false);
                    }
                }, 5000);
            });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[AiroSerialService] Connect error:', message);
            this.port = undefined;
            return false;
        }
    }

    async disconnect(): Promise<boolean> {
        if (this.port && this.port.isOpen) {
            return new Promise(resolve => {
                this.port!.close((err?: Error) => {
                    if (err) {
                        console.error('[AiroSerialService] Disconnect error:', err.message);
                    }
                    this.port = undefined;
                    this.dataBuffer = '';
                    resolve(!err);
                });
            });
        }
        this.port = undefined;
        this.dataBuffer = '';
        return true;
    }

    /**
     * Read all available data from the serial buffer (for polling mode).
     * Returns the accumulated data and clears the buffer.
     */
    async readAvailable(): Promise<string> {
        if (!this.port || !this.port.isOpen) {
            return '';
        }
        const data = this.dataBuffer;
        this.dataBuffer = '';
        return data;
    }

    async sendData(data: string): Promise<boolean> {
        if (!this.port || !this.port.isOpen) {
            return false;
        }
        return new Promise(resolve => {
            this.port!.write(data, (err?: Error) => {
                if (err) {
                    console.error('[AiroSerialService] Send error:', err.message);
                    resolve(false);
                } else {
                    resolve(true);
                }
            });
        });
    }

    isConnected(): boolean {
        return this.port !== undefined && this.port !== null && this.port.isOpen === true;
    }
}
