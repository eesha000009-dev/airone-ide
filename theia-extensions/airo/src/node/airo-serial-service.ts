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
    private dataCallbacks: ((data: string) => void)[] = [];

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
                this.dataCallbacks.forEach(cb => cb(line + '\n'));
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
                    resolve(true);
                });
            });
        }
        this.port = null;
        return true;
    }

    onData(callback: (data: string) => void): void {
        this.dataCallbacks.push(callback);
    }

    removeDataCallback(callback: (data: string) => void): void {
        this.dataCallbacks = this.dataCallbacks.filter(cb => cb !== callback);
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
