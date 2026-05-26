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

@injectable()
export class AiroSerialService {
    private port: any = null;
    private dataBuffer: string = '';

    async listPorts(): Promise<SerialPortInfo[]> {
        try {
            const { SerialPort } = require('serialport');
            const ports = await SerialPort.list();
            return ports.map((p: any) => ({
                path: p.path,
                manufacturer: p.manufacturer,
                pnpId: p.pnpId,
                vendorId: p.vendorId,
                productId: p.productId,
            }));
        } catch (err: any) {
            console.error('Failed to list serial ports:', err.message);
            return [];
        }
    }

    async connect(portPath: string, baudRate: number): Promise<boolean> {
        try {
            if (this.port && this.port.isOpen) {
                await this.disconnect();
            }
            const { SerialPort } = require('serialport');
            const { ReadlineParser } = require('@serialport/parser-readline');

            this.port = new SerialPort({
                path: portPath,
                baudRate: baudRate,
            });

            const parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));
            parser.on('data', (line: string) => {
                this.dataBuffer += line + '\n';
            });

            // Also capture raw data for non-line-delimited output
            this.port.on('data', (chunk: Buffer) => {
                // Only buffer raw data if the parser didn't handle it
                // (parser handles line-based data)
            });

            return new Promise((resolve) => {
                this.port.on('open', () => resolve(true));
                this.port.on('error', () => resolve(false));
            });
        } catch (err) {
            return false;
        }
    }

    async disconnect(): Promise<boolean> {
        if (this.port && this.port.isOpen) {
            return new Promise((resolve) => {
                this.port.close(() => {
                    this.port = null;
                    this.dataBuffer = '';
                    resolve(true);
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
        if (this.port && this.port.isOpen) {
            return new Promise((resolve) => {
                this.port.write(data, (err: any) => {
                    resolve(!err);
                });
            });
        }
        return false;
    }

    isConnected(): boolean {
        return this.port !== null && this.port.isOpen;
    }
}
