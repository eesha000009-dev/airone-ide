/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Airone Proprietary License, which is available in the project root.
 *
 * SPDX-License-Identifier: Proprietary
 ********************************************************************************/

import { injectable } from '@theia/core/shared/inversify';
import { execSync } from 'child_process';
import { SerialPortInfo } from '../common/airo-protocol';

/**
 * Serial port service for communicating with ESP32 and other boards.
 *
 * Uses the `serialport` npm package when available. If serialport is not
 * installed (e.g., in a browser-only environment), the service gracefully
 * degrades and reports no available ports.
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

@injectable()
export class AiroSerialService {
    private port: SerialPortInstance | undefined = undefined;
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
        // Try serialport npm package first
        if (this.serialportAvailable) {
            try {
                const { SerialPort } = require('serialport');
                const ports = await SerialPort.list();
                if (ports.length > 0) {
                    return ports.map((p: SerialPortListEntry) => ({
                        path: p.path,
                        manufacturer: p.manufacturer || undefined,
                        pnpId: p.pnpId || undefined,
                        vendorId: p.vendorId || undefined,
                        productId: p.productId || undefined,
                    }));
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                console.error('[AiroSerialService] serialport.list() failed:', message);
            }
        }

        // Fallback: Platform-specific port detection
        // This is essential when serialport native module doesn't work in
        // the packaged Electron app (common on Windows)
        try {
            const fallbackPorts = this.listPortsFallback();
            if (fallbackPorts.length > 0) {
                return fallbackPorts;
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[AiroSerialService] Fallback port listing failed:', message);
        }

        console.warn('[AiroSerialService] No serial ports detected (neither serialport nor fallback worked).');
        return [];
    }

    /**
     * Fallback port detection using OS-native tools.
     * - Windows: PowerShell WMI query
     * - Linux/macOS: ls /dev/tty* and /dev/cu.*
     */
    private listPortsFallback(): SerialPortInfo[] {
        const isWin = process.platform === 'win32';

        if (isWin) {
            return this.listWindowsPorts();
        } else {
            return this.listUnixPorts();
        }
    }

    /**
     * List serial ports on Windows using WMI/PowerShell.
     * This works even when serialport native module is unavailable.
     */
    private listWindowsPorts(): SerialPortInfo[] {
        try {
            // Use WMI to list COM ports with manufacturer/vendor info
            const psCmd =
                `Get-CimInstance Win32_PnPEntity | ` +
                `Where-Object { $_.Name -match 'COM\\d+' -and $_.Status -eq 'OK' } | ` +
                `Select-Object Name, DeviceID, Manufacturer, PNPDeviceID | ` +
                `ConvertTo-Json -Compress`;

            const output = execSync(`powershell -NoProfile -Command "${psCmd}"`, {
                encoding: 'utf8',
                timeout: 10000,
            });

            if (!output || !output.trim()) {
                return [];
            }

            let devices: any[];
            try {
                const parsed = JSON.parse(output);
                devices = Array.isArray(parsed) ? parsed : [parsed];
            } catch {
                return [];
            }

            const ports: SerialPortInfo[] = [];
            for (const dev of devices) {
                // Extract COM port number from Name (e.g., "Silicon Labs CP210x USB to UART Bridge (COM3)")
                const comMatch = (dev.Name || '').match(/\(COM(\d+)\)/);
                if (!comMatch) continue;

                const comPort = `COM${comMatch[1]}`;

                // Extract vendor ID from PNPDeviceID
                // Example: USB\VID_10C4&PID_EA60\0001
                const pnpId = dev.PNPDeviceID || '';
                const vidMatch = pnpId.match(/VID_([0-9A-Fa-f]{4})/);
                const pidMatch = pnpId.match(/PID_([0-9A-Fa-f]{4})/);

                ports.push({
                    path: comPort,
                    manufacturer: dev.Manufacturer || undefined,
                    pnpId: pnpId || undefined,
                    vendorId: vidMatch ? vidMatch[1].toLowerCase() : undefined,
                    productId: pidMatch ? pidMatch[1].toLowerCase() : undefined,
                });
            }

            return ports;
        } catch (err) {
            console.warn('[AiroSerialService] Windows WMI port listing failed:', err instanceof Error ? err.message : String(err));
            return [];
        }
    }

    /**
     * List serial ports on Linux/macOS using /dev filesystem.
     */
    private listUnixPorts(): SerialPortInfo[] {
        try {
            const output = execSync(
                'ls -1 /dev/ttyUSB* /dev/ttyACM* /dev/tty.usbserial* /dev/tty.usbmodem* /dev/cu.usbserial* /dev/cu.usbmodem* 2>/dev/null || true',
                { encoding: 'utf8', timeout: 5000 }
            );

            if (!output || !output.trim()) {
                return [];
            }

            return output.trim().split('\n')
                .filter(line => line.trim())
                .map(portPath => ({
                    path: portPath.trim(),
                    manufacturer: undefined,
                    pnpId: undefined,
                    vendorId: undefined,
                    productId: undefined,
                }));
        } catch {
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
