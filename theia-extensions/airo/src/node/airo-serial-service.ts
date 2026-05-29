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
 * installed (e.g., in a browser-only environment), the service gracefully
 * degrades and reports no available ports.
 */
@injectable()
export class AiroSerialService {
    private port: any = null;
    private dataBuffer: string = '';
    private serialportAvailable = false;

    constructor() {
        // Check if serialport is available at startup
        try {
            require('serialport');
            this.serialportAvailable = true;
        } catch {
            this.serialportAvailable = false;
            console.warn('[AiroSerialService] serialport package not available. Serial communication will be disabled.');
        }
    }

    async listPorts(): Promise<SerialPortInfo[]> {
        if (!this.serialportAvailable) {
            console.warn('[AiroSerialService] Cannot list ports: serialport package not available.');
            return [];
        }

        try {
            const { SerialPort } = require('serialport');
            const ports = await SerialPort.list();
            return ports.map((p: any) => ({
                path: p.path,
                manufacturer: p.manufacturer || undefined,
                pnpId: p.pnpId || undefined,
                vendorId: p.vendorId || undefined,
                productId: p.productId || undefined,
            }));
        } catch (err: any) {
            console.error('[AiroSerialService] Failed to list serial ports:', err.message);
            return [];
        }
    }

    async connect(portPath: string, baudRate: number): Promise<boolean> {
        if (!this.serialportAvailable) {
            console.error('[AiroSerialService] Cannot connect: serialport package not available.');
            return false;
        }

        try {
            if (this.port && this.port.isOpen) {
                await this.disconnect();
            }

            const { SerialPort } = require('serialport');

            this.port = new SerialPort({
                path: portPath,
                baudRate: baudRate,
                autoOpen: false,
            });

            // Try to load the readline parser
            try {
                const { ReadlineParser } = require('@serialport/parser-readline');
                const parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));
                parser.on('data', (line: string) => {
                    this.dataBuffer += line + '\n';
                });
            } catch {
                // If parser not available, use raw data
                console.warn('[AiroSerialService] @serialport/parser-readline not available, using raw data mode.');
                this.port.on('data', (chunk: Buffer) => {
                    this.dataBuffer += chunk.toString();
                });
            }

            return new Promise((resolve) => {
                this.port.open((err: any) => {
                    if (err) {
                        console.error('[AiroSerialService] Failed to open port:', err.message);
                        this.port = null;
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
                        this.port = null;
                        resolve(false);
                    }
                }, 5000);
            });
        } catch (err: any) {
            console.error('[AiroSerialService] Connect error:', err.message);
            this.port = null;
            return false;
        }
    }

    async disconnect(): Promise<boolean> {
        if (this.port && this.port.isOpen) {
            return new Promise((resolve) => {
                this.port.close((err: any) => {
                    if (err) {
                        console.error('[AiroSerialService] Disconnect error:', err.message);
                    }
                    this.port = null;
                    this.dataBuffer = '';
                    resolve(!err);
                });
            });
        }
        this.port = null;
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
        return new Promise((resolve) => {
            this.port.write(data, (err: any) => {
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
        return this.port !== null && this.port.isOpen === true;
    }
}
