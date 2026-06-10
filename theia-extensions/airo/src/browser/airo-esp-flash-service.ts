/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { injectable } from '@theia/core/shared/inversify';

/**
 * Result of an ESP flash operation.
 */
export interface EspFlashResult {
    success: boolean;
    chipName?: string;
    error?: string;
    output: string;
}

/**
 * Information about a detected serial port via Web Serial API.
 */
export interface WebSerialPortInfo {
    port: SerialPort;
    path: string;
    vendorId?: string;
    productId?: string;
    manufacturer?: string;
    serialNumber?: string;
}

/**
 * Frontend service for ESP32 detection and flashing using esptool-js
 * and the Web Serial API.
 *
 * This replaces the old backend approach (serialport npm + esptool.py)
 * with a zero-dependency frontend solution that works directly in
 * Electron's renderer process.
 *
 * Key advantages:
 * - No Python installation required
 * - No serialport native module issues
 * - No esptool.py installation required
 * - Automatic ESP32 detection via Web Serial API
 * - Built-in flashing via esptool-js
 */
@injectable()
export class AiroEspFlashService {

    private connectedPort: SerialPort | undefined;
    private currentLoader: any; // ESPLoader instance (typed as any to avoid import issues)

    /**
     * Check if the Web Serial API is available in this environment.
     * Returns true if running in Electron or a browser that supports Web Serial.
     */
    isWebSerialAvailable(): boolean {
        return typeof navigator !== 'undefined' && 'serial' in navigator;
    }

    /**
     * Request a serial port from the user via the browser's built-in
     * port picker dialog. On Electron, the select-serial-port handler
     * in the main process auto-selects ESP32 ports — no dialog is shown.
     *
     * @returns The selected SerialPort, or undefined if no port was found.
     */
    async requestPort(): Promise<SerialPort | undefined> {
        if (!this.isWebSerialAvailable()) {
            console.error('[AiroEspFlash] Web Serial API not available');
            return undefined;
        }

        try {
            const port = await navigator.serial.requestPort();
            return port;
        } catch (err: unknown) {
            // In Electron: NotFoundError means no serial ports found by Chromium
            // In browser: NotFoundError means user cancelled the dialog
            if (err instanceof DOMException && err.name === 'NotFoundError') {
                return undefined;
            }
            console.error('[AiroEspFlash] Failed to request port:', err);
            return undefined;
        }
    }

    /**
     * Get all previously authorized serial ports (no user dialog needed).
     * These are ports the user has previously granted access to.
     */
    async getAuthorizedPorts(): Promise<WebSerialPortInfo[]> {
        if (!this.isWebSerialAvailable()) {
            return [];
        }

        try {
            const ports = await navigator.serial.getPorts();
            return ports.map(port => {
                const info = port.getInfo();
                return {
                    port,
                    path: `Serial Port (${info.vendorId || 'unknown'})`,
                    vendorId: info.vendorId,
                    productId: info.productId,
                };
            });
        } catch (err: unknown) {
            console.error('[AiroEspFlash] Failed to get authorized ports:', err);
            return [];
        }
    }

    /**
     * Check if a port looks like an ESP32 board based on USB vendor ID.
     */
    isEspPort(port: SerialPort): boolean {
        const info = port.getInfo();
        const vid = (info.vendorId || '').toLowerCase().replace(/^0x/, '');
        const ESP_VENDOR_IDS = new Set([
            '10c4',  // Silicon Labs CP210x
            '1a86',  // QinHeng CH340 / CH9102
            '0403',  // FTDI FT232
            '303a',  // Espressif built-in USB (ESP32-S2/S3/C3 native USB)
            '2e8a',  // Raspberry Pi Pico (RP2040 running ESP firmware)
        ]);
        return ESP_VENDOR_IDS.has(vid);
    }

    /**
     * Connect to an ESP32 board and flash a .bin firmware file.
     *
     * This uses esptool-js under the hood, which implements the ESP32
     * ROM bootloader protocol directly in JavaScript. No Python or
     * native tools are required.
     *
     * @param binaryBuffer The firmware .bin file data as an ArrayBuffer
     * @param flashAddress The flash offset (default: 0x10000 for ESP32)
     * @param onProgress Optional callback for progress updates
     * @returns Flash result with success status and chip info
     */
    async connectAndFlash(
        binaryBuffer: ArrayBuffer,
        flashAddress: number = 0x10000,
        onProgress?: (percent: number, message: string) => void
    ): Promise<EspFlashResult> {
        const outputLines: string[] = [];

        const log = (msg: string) => {
            outputLines.push(msg);
            console.log(`[AiroEspFlash] ${msg}`);
        };

        // ── Step 1: Request a serial port ──────────────────────────────
        log('Step 1: Selecting serial port...');

        if (!this.isWebSerialAvailable()) {
            const msg = 'Web Serial API not available. Please use the Airone Electron app for ESP32 flashing.';
            log('✗ ' + msg);
            return { success: false, error: msg, output: outputLines.join('\n') };
        }

        let port: SerialPort | undefined;
        try {
            port = await this.requestPort();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            log(`✗ Port selection failed: ${msg}`);
            return { success: false, error: `Port selection failed: ${msg}`, output: outputLines.join('\n') };
        }

        if (!port) {
            log('✗ No port selected. Flash cancelled.');
            return { success: false, error: 'No port selected', output: outputLines.join('\n') };
        }

        // Check if it looks like an ESP32
        const isEsp = this.isEspPort(port);
        if (isEsp) {
            log('✓ ESP32-compatible port detected');
        } else {
            log('⚠ Port may not be an ESP32 board. Proceeding anyway...');
        }

        // ── Step 2: Connect using esptool-js ───────────────────────────
        log('Step 2: Connecting to ESP32 bootloader...');

        try {
            // Dynamically import esptool-js (handles both ESM and CJS)
            const { ESPLoader, Transport } = await import('esptool-js');

            // IMPORTANT: Do NOT call port.open() before ESPLoader.main()!
            // ESPLoader.main() → ESPLoader.connect() → Transport.connect()
            // which calls port.open() internally. Pre-opening the port
            // causes "Failed to connect" because the port is already open.
            const transport = new Transport(port, true);

            // Create the ESP loader with terminal output callbacks
            const esploader = new ESPLoader({
                transport,
                baudrate: 460800, // High speed for flashing
                terminal: {
                    clean: () => { /* no-op */ },
                    writeLine: (data: string) => {
                        log(data);
                    },
                    write: (data: string) => {
                        // Progress data from esptool
                        if (onProgress) {
                            // Parse progress from write data
                            const writeMatch = data.match(/\((\d+)%\)/);
                            if (writeMatch) {
                                const percent = parseInt(writeMatch[1], 10);
                                onProgress(percent, `Writing firmware... ${percent}%`);
                            }
                        }
                    },
                },
            });

            this.currentLoader = esploader;
            this.connectedPort = port;

            // Connect and detect the chip.
            // main() internally calls connect() which calls Transport.connect()
            // which opens the serial port and performs the bootloader handshake.
            onProgress?.(5, 'Connecting to board...');
            const chipName = await esploader.main();
            log(`✓ Connected to: ${chipName}`);
            onProgress?.(10, `Detected: ${chipName}`);

            // ── Step 3: Flash the firmware ──────────────────────────────
            log('Step 3: Flashing firmware...');
            onProgress?.(15, 'Starting flash...');

            const flashData = new Uint8Array(binaryBuffer);
            await esploader.writeFlash({
                fileArray: [{ data: flashData, address: flashAddress }],
                flashMode: 'keep',
                flashFreq: 'keep',
                flashSize: 'keep',
                eraseAll: false,    // don't erase entire flash
                compress: true,     // compress
                reportProgress: (fileIndex: number, written: number, total: number) => {
                    if (onProgress && total > 0) {
                        const percent = Math.round((written / total) * 100);
                        onProgress(percent, `Writing firmware... ${percent}%`);
                    }
                },
            });

            log(`✓ Firmware flashed successfully to address 0x${flashAddress.toString(16)}`);
            log(`  Data size: ${flashData.length} bytes`);
            onProgress?.(100, 'Flashing complete!');

            // ── Step 4: Reset the board ─────────────────────────────────
            log('Step 4: Resetting board...');
            try {
                await esploader.after('hard_reset');
                log('✓ Board reset. Firmware should now be running.');
            } catch {
                log('⚠ Could not auto-reset. Press the EN/RST button on your board.');
            }

            // Clean up
            this.currentLoader = undefined;

            return {
                success: true,
                chipName,
                output: outputLines.join('\n'),
            };

        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            log(`✗ Flash failed: ${msg}`);

            // Try to provide helpful error messages
            let userError = msg;
            if (msg.includes('Failed to connect') || msg.includes('timed out') || msg.includes('No serial data')) {
                userError = 'Could not connect to the ESP32 board. Please ensure:\n' +
                    '  • The board is connected via USB\n' +
                    '  • The correct port is selected\n' +
                    '  • Try pressing and holding the BOOT button while connecting\n' +
                    '  • No other program is using the serial port';
            } else if (msg.includes('permission') || msg.includes('access')) {
                userError = 'Serial port access denied. Make sure no other program is using the port.';
            }

            this.currentLoader = undefined;

            // Try to close the port on error
            if (port && port.readable) {
                try { await port.close(); } catch { /* ignore */ }
            }

            return {
                success: false,
                error: userError,
                output: outputLines.join('\n'),
            };
        }
    }

    /**
     * Cancel an in-progress flash operation.
     */
    async cancelFlash(): Promise<void> {
        if (this.currentLoader) {
            try {
                // ESPLoader doesn't have a direct cancel method,
                // but we can close the transport
                const transport = this.currentLoader.transport;
                if (transport && transport.disconnect) {
                    await transport.disconnect();
                }
            } catch { /* ignore */ }
            this.currentLoader = undefined;
        }

        if (this.connectedPort) {
            try {
                if (this.connectedPort.readable) {
                    await this.connectedPort.close();
                }
            } catch { /* ignore */ }
            this.connectedPort = undefined;
        }
    }
}
