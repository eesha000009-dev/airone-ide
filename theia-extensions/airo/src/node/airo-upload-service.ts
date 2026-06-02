/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { injectable } from '@theia/core/shared/inversify';
import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { SerialPortInfo, FlashRequest, FlashResult } from '../common/airo-protocol';

// Re-export for convenience so consumers can import from either location
export { FlashRequest, FlashResult } from '../common/airo-protocol';

export type ProgressCallback = (percent: number, message: string) => void;

// ─── Internal Constants ───────────────────────────────────────────────────────

/** Known ESP32 USB-to-UART vendor IDs (lowercase hex, no prefix) */
const ESP_VENDOR_IDS = new Set([
    '10c4',  // Silicon Labs CP210x
    '1a86',  // QinHeng CH340 / CH9102
    '0403',  // FTDI FT232
    '303a',  // Espressif built-in USB (ESP32-S2/S3/C3 native USB)
    '2e8a',  // Raspberry Pi Pico (RP2040 running ESP firmware)
]);

/** Flash offset for each chip family */
const CHIP_FLASH_OFFSETS: Record<string, string> = {
    esp32:    '0x10000',
    esp32s2:  '0x10000',
    esp32s3:  '0x0',
    esp32c3:  '0x0',
    esp8266:  '0x10000',
};

/** Default baud rate for flashing */
const DEFAULT_BAUD_RATE = 460800;

/** Maximum time (ms) to wait for a flash operation to complete */
const FLASH_TIMEOUT_MS = 120_000;

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
 * Responsibilities:
 *  1. Detect serial ports that likely host an ESP32 board.
 *  2. Locate `esptool.py` (or `esptool`) on the host system.
 *  3. Execute the flash command and stream progress back to the caller.
 *  4. Optionally install esptool via pip.
 */
@injectable()
export class AiroUploadService {

    private serialportAvailable = false;
    private cachedEsptoolPath: string | undefined;

    constructor() {
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
        if (!this.serialportAvailable) {
            console.warn('[AiroUploadService] Cannot list ports: serialport package not available.');
            return [];
        }

        try {
            const { SerialPort } = require('serialport') as SerialPortModule;
            const ports = await SerialPort.list();
            return ports.map(p => ({
                path: p.path,
                manufacturer: p.manufacturer || undefined,
                pnpId: p.pnpId || undefined,
                vendorId: p.vendorId || undefined,
                productId: p.productId || undefined,
            }));
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[AiroUploadService] Failed to list serial ports:', message);
            return [];
        }
    }

    /**
     * Find the best candidate serial port for an ESP32 board.
     *
     * Priority:
     *  1. Ports whose vendorId is in the known ESP32 vendor ID set.
     *  2. Ports whose path contains common ESP32 identifiers (usbserial, usbmodem, cu.usb, COM).
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
                lower.startsWith('com') // Windows COM ports
            );
        });
        if (pathMatch) {
            return pathMatch;
        }

        // Priority 3: Any available port
        return ports[0];
    }

    // ─── esptool Detection & Installation ────────────────────────────────

    /**
     * Check whether esptool.py (or the `esptool` command) is available.
     */
    async isEsptoolAvailable(): Promise<boolean> {
        const found = await this.findEsptool();
        return found !== undefined;
    }

    /**
     * Locate esptool on the host system.
     *
     * Search order:
     *  1. `esptool.py` in system PATH
     *  2. `esptool` in system PATH (newer pip versions)
     *  3. Bundled `esptool.py` in a `resources/esptool/` directory
     *  4. Python module invocation (`python3 -m esptool`)
     *
     * Returns the *command* to invoke (may include arguments like `-m esptool`).
     */
    async findEsptool(): Promise<string | undefined> {
        // Return cached result if we already looked
        if (this.cachedEsptoolPath !== undefined) {
            return this.cachedEsptoolPath;
        }

        const pythonCmd = this.resolvePythonPath();

        // 1. esptool.py in PATH
        if (this.commandExists('esptool.py')) {
            this.cachedEsptoolPath = 'esptool.py';
            return this.cachedEsptoolPath;
        }

        // 2. esptool in PATH (newer versions drop the .py suffix)
        if (this.commandExists('esptool')) {
            this.cachedEsptoolPath = 'esptool';
            return this.cachedEsptoolPath;
        }

        // 3. Bundled esptool
        const bundled = this.findBundledEsptool();
        if (bundled) {
            this.cachedEsptoolPath = bundled;
            return this.cachedEsptoolPath;
        }

        // 4. python3 -m esptool (or python -m esptool on Windows)
        if (await this.pythonModuleExists(pythonCmd, 'esptool')) {
            this.cachedEsptoolPath = `${pythonCmd} -m esptool`;
            return this.cachedEsptoolPath;
        }

        return undefined;
    }

    /**
     * Install esptool.py via pip.
     *
     * Returns true if the installation succeeded (exit code 0).
     */
    async installEsptool(): Promise<boolean> {
        const pythonCmd = this.resolvePythonPath();
        // Clear cache so we re-detect after installation
        this.cachedEsptoolPath = undefined;

        return new Promise(resolve => {
            const args = ['-m', 'pip', 'install', 'esptool'];
            const proc = spawn(pythonCmd, args, { stdio: 'pipe' });

            let stderr = '';

            proc.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            proc.on('close', (code: number | null) => {
                if (code === 0) {
                    console.log('[AiroUploadService] esptool installed successfully.');
                    resolve(true);
                } else {
                    console.error('[AiroUploadService] esptool installation failed:', stderr);
                    resolve(false);
                }
            });

            proc.on('error', (err: Error) => {
                console.error('[AiroUploadService] esptool installation error:', err.message);
                resolve(false);
            });
        });
    }

    // ─── Flash ───────────────────────────────────────────────────────────

    /**
     * Flash a .bin firmware file to an ESP32 board.
     *
     * @param request  Flash parameters (binary path, chip type, optional port/baud/offset).
     * @param onProgress  Optional callback invoked with progress percentage (0‑100) and a message.
     * @returns A {@link FlashResult} indicating success or failure.
     */
    async flash(request: FlashRequest, onProgress?: ProgressCallback): Promise<FlashResult> {
        // ── Validate binary file ──────────────────────────────────────────
        if (!request.binaryPath) {
            return {
                success: false,
                output: '',
                error: 'No binary path specified.',
            };
        }

        try {
            if (!fs.existsSync(request.binaryPath)) {
                return {
                    success: false,
                    output: '',
                    error: `Firmware file not found: ${request.binaryPath}`,
                };
            }
        } catch (err: unknown) {
            return {
                success: false,
                output: '',
                error: `Cannot access firmware file: ${err instanceof Error ? err.message : String(err)}`,
            };
        }

        // ── Resolve serial port ───────────────────────────────────────────
        let portPath = request.portPath;
        if (!portPath) {
            const detected = await this.detectEspPort();
            if (!detected) {
                return {
                    success: false,
                    output: '',
                    error: 'No serial port detected. Please connect an ESP32 board and try again.',
                };
            }
            portPath = detected.path;
        }

        // ── Locate esptool ────────────────────────────────────────────────
        const esptoolCmd = await this.findEsptool();
        if (!esptoolCmd) {
            return {
                success: false,
                output: '',
                error: 'esptool.py is not installed. Install it with: pip install esptool',
            };
        }

        // ── Resolve chip type & flash offset ──────────────────────────────
        const chipType = this.normalizeChipType(request.chipType);
        if (!chipType) {
            return {
                success: false,
                output: '',
                error: `Unsupported chip type: "${request.chipType}". Supported: esp32, esp32s2, esp32s3, esp32c3, esp8266`,
            };
        }

        const flashOffset = request.flashOffset || CHIP_FLASH_OFFSETS[chipType] || '0x10000';
        const baudRate = request.baudRate || DEFAULT_BAUD_RATE;

        // ── Build command ─────────────────────────────────────────────────
        const useModule = esptoolCmd.includes('-m esptool');
        let cmd: string;
        let args: string[];

        if (useModule) {
            // e.g. "python3 -m esptool" → cmd="python3", args=["-m","esptool",...]
            const parts = esptoolCmd.split(' ');
            cmd = parts[0];
            args = [
                ...parts.slice(1),
                '--chip', chipType,
                '--port', portPath,
                '--baud', String(baudRate),
                'write_flash',
                '-z',
                flashOffset,
                request.binaryPath,
            ];
        } else {
            // e.g. "esptool.py" or "esptool"
            cmd = esptoolCmd;
            args = [
                '--chip', chipType,
                '--port', portPath,
                '--baud', String(baudRate),
                'write_flash',
                '-z',
                flashOffset,
                request.binaryPath,
            ];
        }

        // ── Execute ───────────────────────────────────────────────────────
        return this.executeFlash(cmd, args, portPath, onProgress);
    }

    // ─── Private Helpers ─────────────────────────────────────────────────

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
                if (resolved) {
                    return;
                }
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
                // esptool writes most of its output to stderr
                this.parseProgress(text, onProgress);
            });

            proc.on('close', (code: number | null) => {
                const fullOutput = stdout + '\n' + stderr;

                if (code === 0) {
                    finish({
                        success: true,
                        output: fullOutput.trim(),
                        portUsed,
                    });
                } else {
                    const error = this.classifyFlashError(stderr || stdout, code);
                    finish({
                        success: false,
                        output: fullOutput.trim(),
                        error,
                        portUsed,
                    });
                }
            });

            proc.on('error', (err: Error) => {
                if (err.message.includes('ENOENT')) {
                    finish({
                        success: false,
                        output: '',
                        error: `esptool command not found: ${cmd}. Please install esptool (pip install esptool).`,
                        portUsed,
                    });
                } else {
                    finish({
                        success: false,
                        output: '',
                        error: `Failed to start esptool: ${err.message}`,
                        portUsed,
                    });
                }
            });

            // Timeout
            setTimeout(() => {
                if (!resolved) {
                    proc.kill();
                    finish({
                        success: false,
                        output: (stdout + '\n' + stderr).trim(),
                        error: `Flash operation timed out after ${FLASH_TIMEOUT_MS / 1000} seconds. ` +
                               'The board may not be responding. Try pressing the BOOT button while flashing.',
                        portUsed,
                    });
                }
            }, FLASH_TIMEOUT_MS);
        });
    }

    /**
     * Parse esptool output lines for progress information.
     *
     * Recognised patterns:
     *  - "Writing at 0x... (N%)"   → writing progress
     *  - "Hash of data verified"    → 100 % verification step
     *  - "A fatal error occurred"   → fatal failure
     *  - "Chip is ESP32..."         → chip detection confirmation
     */
    private parseProgress(text: string, onProgress?: ProgressCallback): void {
        if (!onProgress) {
            return;
        }

        // Split on newlines — esptool often uses \r for progress updates
        const lines = text.split(/\r?\n|\r/);

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }

            // Writing progress: "Writing at 0x00010000... (12%)"
            const writeMatch = trimmed.match(/Writing at 0x[0-9a-fA-F]+\s*\((\d+)%\)/);
            if (writeMatch) {
                const percent = parseInt(writeMatch[1], 10);
                // Writing is roughly 0‑80 % of the total operation
                const scaled = Math.round(percent * 0.8);
                onProgress(scaled, `Writing firmware... ${percent}%`);
                continue;
            }

            // Verification: "Hash of data verified."
            if (trimmed.includes('Hash of data verified')) {
                onProgress(100, 'Firmware verified successfully.');
                continue;
            }

            // Chip detection: "Chip is ESP32-D0WDQ6 (revision v1.0)"
            const chipMatch = trimmed.match(/Chip is (ESP[^\(]+)/i);
            if (chipMatch) {
                onProgress(5, `Detected chip: ${chipMatch[1].trim()}`);
                continue;
            }

            // Connecting: "Connecting...."
            if (trimmed.includes('Connecting')) {
                onProgress(2, 'Connecting to board...');
                continue;
            }

            // Erasing flash
            if (trimmed.toLowerCase().includes('erasing') || trimmed.toLowerCase().includes('erase')) {
                onProgress(10, 'Erasing flash...');
                continue;
            }

            // Compressed size info
            const compMatch = trimmed.match(/Wrote (\d+) bytes.*compressed/);
            if (compMatch) {
                onProgress(85, `Wrote ${compMatch[1]} bytes (compressed), verifying...`);
                continue;
            }

            // Leaving...
            if (trimmed.includes('Leaving...')) {
                onProgress(95, 'Finishing up...');
                continue;
            }

            // Fatal error
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
        if (!output) {
            return `esptool exited with code ${exitCode} (no output).`;
        }

        const lower = output.toLowerCase();

        // Board not found / no serial data
        if (lower.includes('failed to connect') || lower.includes('no serial data received')) {
            return (
                'Could not connect to the ESP32 board. Please ensure:\n' +
                '  • The board is connected via USB.\n' +
                '  • The correct port is selected.\n' +
                '  • No other program (serial monitor, IDE) is using the port.\n' +
                '  • Try pressing and holding the BOOT button while flashing.'
            );
        }

        // Port access denied
        if (lower.includes('permission denied') || lower.includes('access is denied') || lower.includes('could not open port')) {
            return (
                'Serial port access denied. You may need to:\n' +
                '  • Add your user to the dialout group (Linux): sudo usermod -aG dialout $USER\n' +
                '  • Close other programs using the port.\n' +
                '  • Run the IDE as administrator (Windows).'
            );
        }

        // Chip not in bootloader mode
        if (lower.includes('wrong boot mode') || lower.includes('download mode')) {
            return (
                'The chip is not in download mode. Try:\n' +
                '  • Hold the BOOT button, then click Upload, and release BOOT after "Connecting..." appears.\n' +
                '  • Check that EN/RST and BOOT pins are correctly wired.'
            );
        }

        // Flash verification failure
        if (lower.includes('verify failed') || lower.includes('md5') && lower.includes('mismatch')) {
            return (
                'Flash verification failed. The firmware was written but the read-back did not match.\n' +
                'Possible causes: bad USB cable, unstable power supply, or defective flash chip.'
            );
        }

        // Generic fatal error from esptool
        const fatalMatch = output.match(/A fatal error occurred:\s*(.*)/i);
        if (fatalMatch) {
            return `esptool error: ${fatalMatch[1].trim()}`;
        }

        // Timed out
        if (lower.includes('timeout') || lower.includes('timed out')) {
            return 'Connection timed out. The board may not be responding. Try pressing the BOOT button while flashing.';
        }

        // Fallback — return the last few lines of output
        const lastLines = output.split('\n').filter(l => l.trim()).slice(-3).join('\n');
        return `Flash failed (exit code ${exitCode}):\n${lastLines}`;
    }

    /**
     * Normalise a chip type string to one of the supported values.
     * Accepts case-insensitive input with or without hyphens/spaces.
     */
    private normalizeChipType(raw: string): string | undefined {
        const normalized = raw.toLowerCase().replace(/[\s\-_]/g, '');
        const knownTypes = ['esp32', 'esp32s2', 'esp32s3', 'esp32c3', 'esp8266'];

        // Direct match
        if (knownTypes.includes(normalized)) {
            return normalized;
        }

        // Handle "esp32-s2" → "esp32s2" (already handled by the replace above)
        // Handle just "s2" / "s3" / "c3"
        if (['s2', 's3', 'c3'].includes(normalized)) {
            return `esp32${normalized}`;
        }

        return undefined;
    }

    /**
     * Determine the platform-appropriate Python command.
     */
    private resolvePythonPath(): string {
        return process.platform === 'win32' ? 'python' : 'python3';
    }

    /**
     * Check whether a command exists in the system PATH.
     */
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

    /**
     * Check whether a Python module is importable.
     */
    private async pythonModuleExists(python: string, module: string): Promise<boolean> {
        return new Promise(resolve => {
            const proc = spawn(python, ['-c', `import ${module}`], { stdio: 'ignore' });
            proc.on('close', (code: number | null) => {
                resolve(code === 0);
            });
            proc.on('error', () => {
                resolve(false);
            });
            // Bail after 5 s
            setTimeout(() => {
                proc.kill();
                resolve(false);
            }, 5000);
        });
    }

    /**
     * Search for a bundled esptool.py in known resource locations.
     *
     * Returns the full path to esptool.py if found, or undefined.
     */
    private findBundledEsptool(): string | undefined {
        const candidates: string[] = [];

        // Packaged Electron app: resources/esptool/esptool.py
        if (typeof process.resourcesPath !== 'undefined') {
            candidates.push(path.join(process.resourcesPath, 'esptool', 'esptool.py'));
        }

        // ASAR-packed path
        if (typeof __dirname !== 'undefined' && __dirname.includes('.asar')) {
            candidates.push(path.join(process.resourcesPath!, 'esptool', 'esptool.py'));
        }

        // Dev mode: project-relative locations
        candidates.push(
            path.resolve(__dirname, '../../../../resources/esptool/esptool.py'),
            path.resolve(__dirname, '../../../../../resources/esptool/esptool.py'),
            path.resolve(process.cwd(), 'resources/esptool/esptool.py'),
        );

        try {
            for (const candidate of candidates) {
                if (fs.existsSync(candidate)) {
                    return candidate;
                }
            }
        } catch {
            // ignore FS errors
        }

        return undefined;
    }
}
