/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Airone Proprietary License, which is available in the project root.
 *
 * SPDX-License-Identifier: Proprietary
 ********************************************************************************/

import { injectable, inject } from '@theia/core/shared/inversify';
import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { SerialPortInfo, FlashRequest, FlashResult, CompileResultBinary, ESP_VENDOR_IDS, CHIP_FLASH_OFFSETS, TARGET_TO_PIO_BOARD, DEFAULT_FLASH_BAUD_RATE, SUPPORTED_CHIP_TYPES } from '../common/airo-protocol';
import { AiroCompilerService } from './airo-compiler-service';
import { Esp32BuildService } from './esp32-build-service';

// Re-export for convenience so consumers can import from either location
export { FlashRequest, FlashResult } from '../common/airo-protocol';

export type ProgressCallback = (percent: number, message: string) => void;

// ─── Configurable Constants ──────────────────────────────────────────────────

/** Maximum time (ms) to wait for a flash operation to complete */
const FLASH_TIMEOUT_MS = 120_000;

/** Default Python command per platform */
function defaultPythonCommand(): string {
    return process.platform === 'win32' ? 'python' : 'python3';
}

// ─── serialport dynamic‑load shim ────────────────────────────────────────────

interface SerialPortListEntry {
    path: string;
    manufacturer?: string;
    pnpId?: string;
    vendorId?: string;
    productId?: string;
}

interface SerialPortModule {
    SerialPort: {
        list(): Promise<SerialPortListEntry[]>;
    };
}

/**
 * ESP32 firmware upload service.
 *
 * Supports two flash methods:
 *  1. **esptool-js** (preferred): Pure JavaScript flashing using esptool-js
 *     with a Node serialport adapter. No Python required. Supports 3-file
 *     flash (bootloader + partitions + firmware).
 *
 *  2. **esptool.py** (fallback): Python-based esptool for systems where
 *     Node serialport is not available.
 *
 * Responsibilities:
 *  1. Detect serial ports that likely host an ESP32 board.
 *  2. Flash firmware using the best available method.
 *  3. Support full pipeline: .airo compile → PlatformIO build → flash.
 */
@injectable()
export class AiroUploadService {

    @inject(AiroCompilerService)
    protected readonly compilerService!: AiroCompilerService;

    @inject(Esp32BuildService)
    protected readonly esp32BuildService!: Esp32BuildService;

    private serialportAvailable = false;
    private cachedEsptoolPath: string | undefined;
    private pythonPath: string;

    constructor() {
        this.pythonPath = defaultPythonCommand();

        // Detect serialport availability at construction time
        try {
            require('serialport');
            this.serialportAvailable = true;
        } catch {
            this.serialportAvailable = false;
            console.warn('[AiroUploadService] serialport package not available. Port detection will be limited.');
        }
    }

    // ─── Port Detection ──────────────────────────────────────────────────

    /**
     * List all serial ports visible to the host.
     */
    async listPorts(): Promise<SerialPortInfo[]> {
        // Try serialport npm package first
        if (this.serialportAvailable) {
            try {
                const { SerialPort } = require('serialport') as SerialPortModule;
                const ports = await SerialPort.list();
                if (ports.length > 0) {
                    return ports.map(p => ({
                        path: p.path,
                        manufacturer: p.manufacturer || undefined,
                        pnpId: p.pnpId || undefined,
                        vendorId: p.vendorId || undefined,
                        productId: p.productId || undefined,
                    }));
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                console.error('[AiroUploadService] serialport.list() failed:', message);
            }
        }

        // Fallback: Platform-specific port detection
        try {
            const fallbackPorts = this.listPortsFallback();
            if (fallbackPorts.length > 0) {
                return fallbackPorts;
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[AiroUploadService] Fallback port listing failed:', message);
        }

        console.warn('[AiroUploadService] No serial ports detected.');
        return [];
    }

    /**
     * Fallback port detection using OS-native tools.
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
     */
    private listWindowsPorts(): SerialPortInfo[] {
        try {
            const psCmd =
                `Get-CimInstance Win32_PnPEntity | ` +
                `Where-Object { $_.Name -match 'COM\\d+' -and $_.Status -eq 'OK' } | ` +
                `Select-Object Name, DeviceID, Manufacturer, PNPDeviceID | ` +
                `ConvertTo-Json -Compress`;

            const output = execSync(`powershell -NoProfile -Command "${psCmd}"`, {
                encoding: 'utf8',
                timeout: 10000,
            });

            if (!output || !output.trim()) return [];

            let devices: any[];
            try {
                const parsed = JSON.parse(output);
                devices = Array.isArray(parsed) ? parsed : [parsed];
            } catch { return []; }

            const ports: SerialPortInfo[] = [];
            for (const dev of devices) {
                const comMatch = (dev.Name || '').match(/\(COM(\d+)\)/);
                if (!comMatch) continue;

                const comPort = `COM${comMatch[1]}`;
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
            console.warn('[AiroUploadService] Windows WMI port listing failed:', err instanceof Error ? err.message : String(err));
            return [];
        }
    }

    /**
     * List serial ports on Linux/macOS.
     */
    private listUnixPorts(): SerialPortInfo[] {
        try {
            const output = execSync(
                'ls -1 /dev/ttyUSB* /dev/ttyACM* /dev/tty.usbserial* /dev/tty.usbmodem* /dev/cu.usbserial* /dev/cu.usbmodem* 2>/dev/null || true',
                { encoding: 'utf8', timeout: 5000 }
            );

            if (!output || !output.trim()) return [];

            return output.trim().split('\n')
                .filter((line: string) => line.trim())
                .map((portPath: string) => ({
                    path: portPath.trim(),
                    manufacturer: undefined,
                    pnpId: undefined,
                    vendorId: undefined,
                    productId: undefined,
                }));
        } catch { return []; }
    }

    /**
     * Find the best candidate serial port for an ESP32 board.
     *
     * Priority:
     *  1. Ports whose vendorId is in the known ESP32 vendor ID set.
     *  2. Ports whose path contains common ESP32 identifiers.
     *  3. Any available port (fallback).
     *  4. undefined — no ports at all.
     */
    async detectEspPort(): Promise<SerialPortInfo | undefined> {
        const ports = await this.listPorts();
        if (ports.length === 0) {
            return undefined;
        }

        // Priority 1: Known ESP32 vendor IDs
        const espPort = ports.find(p =>
            ESP_VENDOR_IDS.has(p.vendorId?.toLowerCase() || '')
        );
        if (espPort) {
            return espPort;
        }

        // Priority 2: Port path contains common ESP32 identifiers
        const pathMatch = ports.find(p => {
            const lower = p.path.toLowerCase();
            return (
                lower.includes('usbserial') ||
                lower.includes('usbmodem') ||
                lower.includes('cu.usb') ||
                lower.startsWith('com')
            );
        });
        if (pathMatch) {
            return pathMatch;
        }

        // Priority 3: Any available port
        return ports[0];
    }

    // ─── esptool-js Flashing (Primary Method) ────────────────────────────

    /**
     * Flash firmware to ESP32 using esptool-js with Node serialport.
     *
     * This is the preferred method — no Python required.
     * Supports 3-file flash: bootloader.bin + partitions.bin + firmware.bin
     *
     * @param request Flash parameters
     * @param onProgress Optional progress callback
     */
    async flashWithEsptoolJs(
        request: FlashRequest,
        onProgress?: ProgressCallback
    ): Promise<FlashResult> {
        // Validate binary file
        if (!request.binaryPath) {
            return { success: false, output: '', error: 'No binary path specified.' };
        }

        try {
            if (!fs.existsSync(request.binaryPath)) {
                return { success: false, output: '', error: `Firmware file not found: ${request.binaryPath}` };
            }
        } catch (err: unknown) {
            return { success: false, output: '', error: `Cannot access firmware file: ${err instanceof Error ? err.message : String(err)}` };
        }

        // Resolve serial port
        let portPath = request.portPath;
        if (!portPath) {
            const detected = await this.detectEspPort();
            if (!detected) {
                return { success: false, output: '', error: 'No serial port detected. Please connect an ESP32 board.' };
            }
            portPath = detected.path;
        }

        const chipType = this.normalizeChipType(request.chipType);
        if (!chipType) {
            return { success: false, output: '', error: `Unsupported chip type: "${request.chipType}". Supported: esp32, esp32s2, esp32s3, esp32c3, esp8266` };
        }

        const baudRate = request.baudRate || DEFAULT_FLASH_BAUD_RATE;
        const offsets = CHIP_FLASH_OFFSETS[chipType] || CHIP_FLASH_OFFSETS['esp32'];

        // Build the list of files to flash
        const fileArray: { data: Uint8Array; address: number }[] = [];

        // 1. Firmware (always required)
        const firmwareData = fs.readFileSync(request.binaryPath);
        fileArray.push({
            data: new Uint8Array(firmwareData),
            address: parseInt(offsets.firmware, 16),
        });

        // 2. Bootloader (optional — from PlatformIO build output)
        const bootloaderPath = this.findCompanionBinary(request.binaryPath, 'bootloader.bin');
        if (bootloaderPath) {
            const bootloaderData = fs.readFileSync(bootloaderPath);
            fileArray.push({
                data: new Uint8Array(bootloaderData),
                address: parseInt(offsets.bootloader, 16),
            });
        }

        // 3. Partitions (optional — from PlatformIO build output)
        const partitionsPath = this.findCompanionBinary(request.binaryPath, 'partitions.bin');
        if (partitionsPath) {
            const partitionsData = fs.readFileSync(partitionsPath);
            fileArray.push({
                data: new Uint8Array(partitionsData),
                address: parseInt(offsets.partitions, 16),
            });
        }

        // Check if serialport is available for Node-based flashing
        if (!this.serialportAvailable) {
            // Fall back to Python esptool
            return this.flashWithEsptoolPy(request, onProgress);
        }

        const outputLines: string[] = [];
        const log = (msg: string) => {
            outputLines.push(msg);
            console.log(`[AiroEspFlash] ${msg}`);
        };

        try {
            log(`Step 1: Connecting to ${portPath} at ${baudRate} baud...`);
            onProgress?.(5, 'Connecting to board...');

            // Dynamically import esptool-js
            const { ESPLoader, Transport } = await import('esptool-js');

            // Create a Node serialport adapter for esptool-js
            const { NodeSerialPortAdapter } = await import('./node-serial-adapter');
            const serialPort = await NodeSerialPortAdapter.open(portPath, baudRate);
            const transport = new Transport(serialPort as any, true);

            const esploader = new ESPLoader({
                transport,
                baudrate: baudRate,
                terminal: {
                    clean: () => { /* no-op */ },
                    writeLine: (data: string) => { log(data); },
                    write: (data: string) => {
                        // Parse progress
                        if (onProgress) {
                            const writeMatch = data.match(/\((\d+)%\)/);
                            if (writeMatch) {
                                const percent = parseInt(writeMatch[1], 10);
                                onProgress(percent, `Writing firmware... ${percent}%`);
                            }
                        }
                    },
                },
            });

            // Connect and detect chip
            const chipName = await esploader.main();
            log(`✓ Connected to: ${chipName}`);
            onProgress?.(10, `Detected: ${chipName}`);

            // Flash all files
            log('Step 2: Flashing firmware...');
            onProgress?.(15, 'Starting flash...');

            await esploader.writeFlash({
                fileArray,
                flashMode: 'keep',
                flashFreq: 'keep',
                flashSize: 'keep',
                eraseAll: false,
                compress: true,
                reportProgress: (fileIndex: number, written: number, total: number) => {
                    if (onProgress && total > 0) {
                        const percent = Math.round((written / total) * 100);
                        onProgress(percent, `Writing file ${fileIndex + 1}/${fileArray.length}... ${percent}%`);
                    }
                },
            });

            log(`✓ Firmware flashed successfully!`);
            log(`  Files: ${fileArray.length} (firmware${bootloaderPath ? ' + bootloader' : ''}${partitionsPath ? ' + partitions' : ''})`);
            log(`  Total data: ${fileArray.reduce((sum, f) => sum + f.data.length, 0)} bytes`);
            onProgress?.(100, 'Flashing complete!');

            // Reset the board
            log('Step 3: Resetting board...');
            try {
                await esploader.after('hard_reset');
                log('✓ Board reset. Firmware should now be running.');
            } catch {
                log('⚠ Could not auto-reset. Press the EN/RST button on your board.');
            }

            // Clean up
            try {
                await NodeSerialPortAdapter.close(serialPort);
            } catch { /* ignore */ }

            return {
                success: true,
                output: outputLines.join('\n'),
                portUsed: portPath,
            };

        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            log(`✗ Flash failed: ${msg}`);

            let userError = msg;
            if (msg.includes('Failed to connect') || msg.includes('timed out') || msg.includes('No serial data')) {
                userError = 'Could not connect to the ESP32 board. Please ensure:\n' +
                    '  • The board is connected via USB\n' +
                    '  • The correct port is selected\n' +
                    '  • Try pressing and holding the BOOT button while connecting\n' +
                    '  • No other program is using the serial port';
            } else if (msg.includes('permission') || msg.includes('access') || msg.includes('EACCES')) {
                userError = 'Serial port access denied. You may need to:\n' +
                    '  • Add your user to the dialout group (Linux): sudo usermod -aG dialout $USER\n' +
                    '  • Close other programs using the port\n' +
                    '  • Run the IDE as administrator (Windows)';
            }

            return {
                success: false,
                output: outputLines.join('\n'),
                error: userError,
                portUsed: portPath,
            };
        }
    }

    // ─── esptool.py Flashing (Fallback Method) ───────────────────────────

    /**
     * Flash firmware using Python esptool.py (fallback when Node serialport
     * or esptool-js is not available).
     */
    private async flashWithEsptoolPy(
        request: FlashRequest,
        onProgress?: ProgressCallback
    ): Promise<FlashResult> {
        // Validate binary file
        if (!request.binaryPath) {
            return { success: false, output: '', error: 'No binary path specified.' };
        }

        try {
            if (!fs.existsSync(request.binaryPath)) {
                return { success: false, output: '', error: `Firmware file not found: ${request.binaryPath}` };
            }
        } catch (err: unknown) {
            return { success: false, output: '', error: `Cannot access firmware file: ${err instanceof Error ? err.message : String(err)}` };
        }

        // Resolve serial port
        let portPath = request.portPath;
        if (!portPath) {
            const detected = await this.detectEspPort();
            if (!detected) {
                return { success: false, output: '', error: 'No serial port detected. Please connect an ESP32 board.' };
            }
            portPath = detected.path;
        }

        // Locate esptool
        const esptoolCmd = await this.findEsptool();
        if (!esptoolCmd) {
            return { success: false, output: '', error: 'esptool is not available. PlatformIO and esptool come bundled with Airone IDE. Ensure Python 3.8+ is installed and restart Airone IDE.' };
        }

        // Resolve chip type & flash offset
        const chipType = this.normalizeChipType(request.chipType);
        if (!chipType) {
            return { success: false, output: '', error: `Unsupported chip type: "${request.chipType}". Supported: esp32, esp32s2, esp32s3, esp32c3, esp8266` };
        }

        const offsets = CHIP_FLASH_OFFSETS[chipType] || CHIP_FLASH_OFFSETS['esp32'];
        const baudRate = request.baudRate || DEFAULT_FLASH_BAUD_RATE;

        // Build command with 3-file flash support
        const useModule = esptoolCmd.includes('-m esptool');
        let cmd: string;
        let args: string[];

        // Base args: chip, port, baud
        const baseArgs = ['--chip', chipType, '--port', portPath, '--baud', String(baudRate), 'write_flash', '-z'];

        // Add flash addresses for companion binaries
        const bootloaderPath = this.findCompanionBinary(request.binaryPath, 'bootloader.bin');
        const partitionsPath = this.findCompanionBinary(request.binaryPath, 'partitions.bin');

        const flashArgs: string[] = [];
        if (bootloaderPath) {
            flashArgs.push(offsets.bootloader, bootloaderPath);
        }
        if (partitionsPath) {
            flashArgs.push(offsets.partitions, partitionsPath);
        }
        flashArgs.push(offsets.firmware, request.binaryPath);

        if (useModule) {
            const parts = esptoolCmd.split(' ');
            cmd = parts[0];
            args = [...parts.slice(1), ...baseArgs, ...flashArgs];
        } else {
            cmd = esptoolCmd;
            args = [...baseArgs, ...flashArgs];
        }

        return this.executeFlash(cmd, args, portPath, onProgress);
    }

    // ─── Primary Flash Method (auto-selects best available) ─────────────

    /**
     * Flash a .bin firmware file to an ESP32 board.
     * Automatically selects the best available flash method:
     *  1. esptool-js with Node serialport (preferred, no Python needed)
     *  2. esptool.py (fallback)
     */
    async flash(request: FlashRequest, onProgress?: ProgressCallback): Promise<FlashResult> {
        // ── Priority 1: Native bundled esptool (NO Python required) ──
        // The Esp32BuildService has a flashDevice() method that uses the
        // bundled standalone esptool executable. This is the preferred path
        // because it requires zero external dependencies.
        if (request.binaryPath && request.portPath) {
            try {
                // Find companion binaries (bootloader, partitions) if they exist
                const bootloaderPath = this.findCompanionBinary(request.binaryPath, 'bootloader.bin');
                const partitionsPath = this.findCompanionBinary(request.binaryPath, 'partitions.bin');

                const outputLines: string[] = [];
                const result = await this.esp32BuildService.flashDevice(
                    request.portPath,
                    request.binaryPath,
                    (line) => {
                        outputLines.push(line);
                        // Parse progress from esptool output
                        if (onProgress) {
                            const writeMatch = line.match(/\((\d+)%\)/);
                            if (writeMatch) {
                                onProgress(parseInt(writeMatch[1], 10), line);
                            }
                        }
                    },
                    bootloaderPath,
                    partitionsPath
                );
                return result;
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn('[AiroUploadService] Native esptool failed, trying fallbacks:', msg);
            }
        }

        // ── Priority 2: esptool-js (if serialport is available) ──
        if (this.serialportAvailable) {
            try {
                await import('esptool-js');
                return this.flashWithEsptoolJs(request, onProgress);
            } catch {
                console.warn('[AiroUploadService] esptool-js not available, falling back to esptool.py');
            }
        }

        // ── Priority 3: Python esptool (last resort) ──
        return this.flashWithEsptoolPy(request, onProgress);
    }

    // ─── Full Pipeline: Compile + Flash ──────────────────────────────────

    /**
     * Compile an .airo file and flash the resulting firmware to an ESP32 board.
     *
     * Pipeline:
     * 1. Compile the .airo file → C++ (via AiroCompilerService)
     * 2. Build C++ → .bin (via PlatformIO)
     * 3. Flash .bin → ESP32 (via esptool-js or esptool.py)
     */
    async flashAiroFile(airoFilePath: string, chipType: string, portPath?: string): Promise<FlashResult> {
        // ── Resolve filesystem path ───────────────────────────────────
        const fsPath = airoFilePath.startsWith('file://')
            ? this.fsPathFromUri(airoFilePath)
            : airoFilePath;

        if (!fs.existsSync(fsPath)) {
            return { success: false, output: '', error: `File not found: ${fsPath}` };
        }

        const buildDir = path.join(path.dirname(fsPath), 'build');

        // ── Step 1: Compile .airo → C++ → .bin ────────────────────────
        const compileResult = await this.compilerService.compile({
            filePath: fsPath,
            target: chipType,
            outputDir: buildDir,
        });

        if (!compileResult.success) {
            return { success: false, output: compileResult.output, error: compileResult.error || 'Compilation failed' };
        }

        // ── Step 2: Locate the .bin firmware ──────────────────────────
        let binaryPath = compileResult.binaryPath;

        if (!binaryPath) {
            // The compile result didn't include binaryPath — search the build directory
            const pioBoard = this.chipTypeToPioBoard(chipType);
            const firmwareFiles = this.compilerService.findPlatformioFirmware(buildDir, pioBoard);
            binaryPath = firmwareFiles.firmware;

            if (!binaryPath) {
                return {
                    success: false,
                    output: compileResult.output,
                    error: 'Firmware binary (.bin) not found. PlatformIO build may have failed. ' +
                        'PlatformIO comes bundled with Airone IDE. Ensure Python 3.8+ is installed and restart Airone IDE.',
                };
            }
        }

        // ── Step 3: Flash the firmware ────────────────────────────────
        const flashRequest: FlashRequest = {
            binaryPath,
            chipType,
            baudRate: DEFAULT_FLASH_BAUD_RATE,
        };

        if (portPath) {
            flashRequest.portPath = portPath;
        }

        return this.flash(flashRequest);
    }

    // ─── Compile-Only (for frontend esptool-js flashing) ──────────────

    /**
     * Compile an .airo file to produce a .bin firmware binary without flashing.
     * Used by the frontend esptool-js flash flow:
     *   1. Backend compiles .airo → C++ → .bin
     *   2. Frontend reads the .bin via readBinaryFile()
     *   3. Frontend flashes using esptool-js + Web Serial API
     */
    async compileAiroFile(airoFilePath: string, chipType: string): Promise<CompileResultBinary> {
        // ── Resolve filesystem path ───────────────────────────────────
        const fsPath = airoFilePath.startsWith('file://')
            ? this.fsPathFromUri(airoFilePath)
            : airoFilePath;

        if (!fs.existsSync(fsPath)) {
            return { success: false, output: '', error: `File not found: ${fsPath}` };
        }

        const buildDir = path.join(path.dirname(fsPath), 'build');

        // ── Compile .airo → C++ → .bin ────────────────────────────────
        const compileResult = await this.compilerService.compile({
            filePath: fsPath,
            target: chipType,
            outputDir: buildDir,
        });

        if (!compileResult.success) {
            return { success: false, output: compileResult.output, error: compileResult.error || 'Compilation failed' };
        }

        // ── Locate the .bin firmware ──────────────────────────────────
        let binaryPath = compileResult.binaryPath;

        if (!binaryPath) {
            const pioBoard = this.chipTypeToPioBoard(chipType);
            const firmwareFiles = this.compilerService.findPlatformioFirmware(buildDir, pioBoard);
            binaryPath = firmwareFiles.firmware;
        }

        return {
            success: true,
            output: compileResult.output,
            binaryPath,
            generatedFiles: compileResult.generatedFiles,
        };
    }

    /**
     * Read a binary file and return it as a base64-encoded string.
     * The frontend can decode this to an ArrayBuffer for esptool-js.
     */
    async readBinaryFile(filePath: string): Promise<string | undefined> {
        try {
            if (!fs.existsSync(filePath)) {
                return undefined;
            }
            const data = fs.readFileSync(filePath);
            return data.toString('base64');
        } catch {
            return undefined;
        }
    }

    // ─── esptool Detection & Installation ────────────────────────────────

    /**
     * Check whether esptool is available.
     */
    async isEsptoolAvailable(): Promise<boolean> {
        const found = await this.findEsptool();
        return found !== undefined;
    }

    /**
     * Locate esptool on the host system.
     *
     * Search order:
     *  1. PlatformIO's bundled esptool
     *  2. `esptool.py` in system PATH
     *  3. `esptool` in system PATH
     *  4. Bundled `esptool.py` in resources directory
     *  5. Python module invocation
     */
    async findEsptool(): Promise<string | undefined> {
        if (this.cachedEsptoolPath !== undefined) {
            return this.cachedEsptoolPath;
        }

        // 1. PlatformIO's bundled esptool
        const pioEsptool = this.findPioEsptool();
        if (pioEsptool) {
            this.cachedEsptoolPath = pioEsptool;
            return this.cachedEsptoolPath;
        }

        // 2. esptool.py in PATH
        if (this.commandExists('esptool.py')) {
            this.cachedEsptoolPath = 'esptool.py';
            return this.cachedEsptoolPath;
        }

        // 3. esptool in PATH
        if (this.commandExists('esptool')) {
            this.cachedEsptoolPath = 'esptool';
            return this.cachedEsptoolPath;
        }

        // 4. Bundled esptool
        const bundled = this.findBundledEsptool();
        if (bundled) {
            this.cachedEsptoolPath = bundled;
            return this.cachedEsptoolPath;
        }

        // 5. Python module invocation
        if (await this.pythonModuleExists(this.pythonPath, 'esptool')) {
            this.cachedEsptoolPath = `${this.pythonPath} -m esptool`;
            return this.cachedEsptoolPath;
        }

        return undefined;
    }

    /**
     * Install esptool via pip.
     */
    async installEsptool(): Promise<boolean> {
        this.cachedEsptoolPath = undefined;

        return new Promise(resolve => {
            const proc = spawn(this.pythonPath, ['-m', 'pip', 'install', 'esptool'], { stdio: 'pipe' });
            let stderr = '';

            proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

            proc.on('close', (code: number | null) => {
                resolve(code === 0);
            });

            proc.on('error', () => {
                resolve(false);
            });
        });
    }

    // ─── Private Helpers ─────────────────────────────────────────────────

    /**
     * Find PlatformIO's bundled esptool.
     */
    private findPioEsptool(): string | undefined {
        const homeDir = os.homedir();
        const isWin = process.platform === 'win32';

        // PlatformIO stores esptool in packages
        const pioPackagesDir = path.join(homeDir, '.platformio', 'packages', 'tool-esptoolpy');
        const esptoolScript = isWin
            ? path.join(pioPackagesDir, 'esptool.exe')
            : path.join(pioPackagesDir, 'esptool.py');

        if (fs.existsSync(esptoolScript)) {
            return esptoolScript;
        }

        // Check vendor directory
        const vendorDir = path.join(homeDir, '.airone', 'vendor');
        const vendorEsptool = isWin
            ? path.join(vendorDir, 'platformio_cache', 'packages', 'tool-esptoolpy', 'esptool.exe')
            : path.join(vendorDir, 'platformio_cache', 'packages', 'tool-esptoolpy', 'esptool.py');

        if (fs.existsSync(vendorEsptool)) {
            return vendorEsptool;
        }

        return undefined;
    }

    /**
     * Find companion binary files (bootloader.bin, partitions.bin) in the
     * same directory as the firmware binary.
     */
    private findCompanionBinary(firmwarePath: string, companionName: string): string | undefined {
        const dir = path.dirname(firmwarePath);
        const companionPath = path.join(dir, companionName);
        if (fs.existsSync(companionPath)) {
            return companionPath;
        }

        // Also check parent directory (PlatformIO sometimes puts files in different levels)
        const parentDir = path.dirname(dir);
        const parentCompanion = path.join(parentDir, companionName);
        if (fs.existsSync(parentCompanion)) {
            return parentCompanion;
        }

        return undefined;
    }

    /**
     * Map chip type to PlatformIO board identifier.
     */
    private chipTypeToPioBoard(chipType: string): string {
        return TARGET_TO_PIO_BOARD[chipType.toLowerCase()] || TARGET_TO_PIO_BOARD['esp32'];
    }

    /**
     * Run the flash subprocess and parse its output for progress.
     */
    private executeFlash(
        cmd: string,
        args: string[],
        portUsed: string,
        onProgress?: ProgressCallback,
    ): Promise<FlashResult> {
        return new Promise(resolve => {
            const proc = spawn(cmd, args, { stdio: 'pipe' });

            let stdout = '';
            let stderr = '';
            let resolved = false;

            const finish = (result: FlashResult) => {
                if (resolved) return;
                resolved = true;
                resolve(result);
            };

            proc.stdout.on('data', (data: Buffer) => {
                const text = data.toString();
                stdout += text;
                this.parseProgress(text, onProgress);
            });

            proc.stderr.on('data', (data: Buffer) => {
                const text = data.toString();
                stderr += text;
                this.parseProgress(text, onProgress);
            });

            proc.on('close', (code: number | null) => {
                const fullOutput = stdout + '\n' + stderr;

                if (code === 0) {
                    finish({ success: true, output: fullOutput.trim(), portUsed });
                } else {
                    const error = this.classifyFlashError(stderr || stdout, code);
                    finish({ success: false, output: fullOutput.trim(), error, portUsed });
                }
            });

            proc.on('error', (err: Error) => {
                finish({
                    success: false,
                    output: '',
                    error: `Failed to start esptool: ${err.message}`,
                    portUsed,
                });
            });

            setTimeout(() => {
                if (!resolved) {
                    proc.kill();
                    finish({
                        success: false,
                        output: (stdout + '\n' + stderr).trim(),
                        error: `Flash operation timed out after ${FLASH_TIMEOUT_MS / 1000} seconds.`,
                        portUsed,
                    });
                }
            }, FLASH_TIMEOUT_MS);
        });
    }

    /**
     * Parse esptool output for progress information.
     */
    private parseProgress(text: string, onProgress?: ProgressCallback): void {
        if (!onProgress) return;

        const lines = text.split(/\r?\n|\r/);
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            const writeMatch = trimmed.match(/Writing at 0x[0-9a-fA-F]+\s*\((\d+)%\)/);
            if (writeMatch) {
                const percent = parseInt(writeMatch[1], 10);
                const scaled = Math.round(percent * 0.8);
                onProgress(scaled, `Writing firmware... ${percent}%`);
                continue;
            }

            if (trimmed.includes('Hash of data verified')) {
                onProgress(100, 'Firmware verified successfully.');
                continue;
            }

            const chipMatch = trimmed.match(/Chip is (ESP[^\(]+)/i);
            if (chipMatch) {
                onProgress(5, `Detected chip: ${chipMatch[1].trim()}`);
                continue;
            }

            if (trimmed.includes('Connecting')) {
                onProgress(2, 'Connecting to board...');
                continue;
            }

            if (trimmed.toLowerCase().includes('erasing') || trimmed.toLowerCase().includes('erase')) {
                onProgress(10, 'Erasing flash...');
                continue;
            }

            if (trimmed.includes('Leaving...')) {
                onProgress(95, 'Finishing up...');
                continue;
            }

            if (trimmed.includes('A fatal error occurred')) {
                onProgress(-1, `Error: ${trimmed}`);
                continue;
            }
        }
    }

    /**
     * Classify a flash failure into a user-friendly error message.
     */
    private classifyFlashError(output: string, exitCode: number | null): string {
        if (!output) return `esptool exited with code ${exitCode} (no output).`;

        const lower = output.toLowerCase();

        if (lower.includes('failed to connect') || lower.includes('no serial data received')) {
            return 'Could not connect to the ESP32 board. Please ensure:\n' +
                '  • The board is connected via USB.\n' +
                '  • The correct port is selected.\n' +
                '  • No other program is using the port.\n' +
                '  • Try pressing and holding the BOOT button while flashing.';
        }

        if (lower.includes('permission denied') || lower.includes('access is denied') || lower.includes('could not open port')) {
            return 'Serial port access denied. You may need to:\n' +
                '  • Add your user to the dialout group (Linux): sudo usermod -aG dialout $USER\n' +
                '  • Close other programs using the port.\n' +
                '  • Run the IDE as administrator (Windows).';
        }

        if (lower.includes('wrong boot mode') || lower.includes('download mode')) {
            return 'The chip is not in download mode. Try:\n' +
                '  • Hold the BOOT button, then click Upload, and release BOOT after "Connecting..." appears.';
        }

        const fatalMatch = output.match(/A fatal error occurred:\s*(.*)/i);
        if (fatalMatch) return `esptool error: ${fatalMatch[1].trim()}`;

        const lastLines = output.split('\n').filter(l => l.trim()).slice(-3).join('\n');
        return `Flash failed (exit code ${exitCode}):\n${lastLines}`;
    }

    /**
     * Normalise a chip type string.
     */
    private normalizeChipType(raw: string): string | undefined {
        const normalized = raw.toLowerCase().replace(/[\s\-_]/g, '');

        if (SUPPORTED_CHIP_TYPES.includes(normalized)) return normalized;
        if (['s2', 's3', 'c3'].includes(normalized)) return `esp32${normalized}`;

        return undefined;
    }

    private commandExists(command: string): boolean {
        try {
            const isWin = process.platform === 'win32';
            const checkCmd = isWin ? 'where' : 'which';
            execSync(`${checkCmd} ${command}`, { stdio: 'ignore', timeout: 5000 });
            return true;
        } catch {
            return false;
        }
    }

    private async pythonModuleExists(python: string, module: string): Promise<boolean> {
        return new Promise(resolve => {
            const proc = spawn(python, ['-c', `import ${module}`], { stdio: 'ignore' });
            proc.on('close', (code: number | null) => { resolve(code === 0); });
            proc.on('error', () => { resolve(false); });
            setTimeout(() => { proc.kill(); resolve(false); }, 5000);
        });
    }

    private fsPathFromUri(uri: string): string {
        const parsed = new URL(uri);
        let filePath = decodeURIComponent(parsed.pathname);
        if (process.platform === 'win32' && filePath.match(/^\/[A-Za-z]:/)) {
            filePath = filePath.substring(1);
        }
        return filePath;
    }

    private findBundledEsptool(): string | undefined {
        const candidates: string[] = [];

        if (typeof process.resourcesPath !== 'undefined') {
            candidates.push(path.join(process.resourcesPath, 'esptool', 'esptool.py'));
        }

        if (typeof __dirname !== 'undefined' && __dirname.includes('.asar')) {
            candidates.push(path.join(process.resourcesPath!, 'esptool', 'esptool.py'));
        }

        candidates.push(
            path.resolve(__dirname, '../../../../resources/esptool/esptool.py'),
            path.resolve(__dirname, '../../../../../resources/esptool/esptool.py'),
            path.resolve(process.cwd(), 'resources/esptool/esptool.py'),
        );

        try {
            for (const candidate of candidates) {
                if (fs.existsSync(candidate)) return candidate;
            }
        } catch { /* ignore */ }

        return undefined;
    }
}
