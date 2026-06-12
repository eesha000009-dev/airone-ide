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
import { CompileRequest, CompileResult } from '../common/airo-protocol';
import { AiroBuiltInCompiler } from './airo-built-in-compiler';
import { AiroTranspiler } from './airo-transpiler';

// ─── Configurable Constants ──────────────────────────────────────────────────

/** Default PlatformIO board identifier for ESP32 */
const DEFAULT_PIO_BOARD = 'esp32dev';

/** Default ESP32 chip family for flash operations */
const DEFAULT_CHIP_FAMILY = 'esp32';

/** PlatformIO build directory relative to project */
const PIO_BUILD_DIR = '.pio';

/** Default Python command per platform */
function defaultPythonCommand(): string {
    return process.platform === 'win32' ? 'python' : 'python3';
}

/** Resolve the vendor directory for bundled PlatformIO Core + toolchain */
function resolveVendorDir(): string {
    // In packaged Electron app: resources/vendor
    if (typeof __dirname !== 'undefined' && __dirname.includes('.asar')) {
        return path.join(process.resourcesPath!, 'vendor');
    }
    // Dev mode: check project root
    const devLocations = [
        path.resolve(__dirname, '../../../../../../vendor'),
        path.resolve(process.cwd(), 'vendor'),
    ];
    for (const loc of devLocations) {
        if (fs.existsSync(loc)) return loc;
    }
    // Fallback: create in home directory
    return path.join(os.homedir(), '.airone', 'vendor');
}

/** Resolve the PlatformIO Core directory (bundled or user-installed) */
function resolvePlatformioCoreDir(): string {
    const vendorDir = resolveVendorDir();
    const bundledCore = path.join(vendorDir, 'platformio_cache');
    if (fs.existsSync(bundledCore)) return bundledCore;

    // Fallback: user's default PlatformIO Core dir
    return path.join(os.homedir(), '.platformio');
}

/** Map common .airo target names to PlatformIO board IDs */
const TARGET_TO_PIO_BOARD: Record<string, string> = {
    esp32: 'esp32dev',
    esp32s2: 'esp32-s2-saola-1',
    esp32s3: 'esp32-s3-devkitc-1',
    esp32c3: 'esp32-c3-devkitm-1',
    esp8266: 'esp01_1m',
};

/** Map PlatformIO board IDs to chip families (for flash operations) */
const PIO_BOARD_TO_CHIP: Record<string, string> = {
    'esp32dev': 'esp32',
    'esp32-s2-saola-1': 'esp32s2',
    'esp32-s3-devkitc-1': 'esp32s3',
    'esp32-c3-devkitm-1': 'esp32c3',
    'esp01_1m': 'esp8266',
};

/**
 * Compiler service that uses PlatformIO as the compilation backend.
 *
 * Pipeline:
 * **Step 1 – Built-in (TypeScript)**: Fast, no-dependency syntax checking.
 * **Step 2 – Transpiler (TypeScript)**: Converts .airo code to C++ ESP32 code.
 * **Step 3 – PlatformIO build**: Compiles C++ into firmware .bin files.
 *    Supports both bundled (offline) and system PlatformIO installations.
 *    Produces firmware.bin, bootloader.bin, and partitions.bin in the build output.
 */
@injectable()
export class AiroCompilerService {

    @inject(AiroBuiltInCompiler)
    protected readonly builtInCompiler!: AiroBuiltInCompiler;

    @inject(AiroTranspiler)
    protected readonly transpiler!: AiroTranspiler;

    private pythonPath: string;
    private compilerDir: string;
    private cachedPioPath: string | undefined;
    private _pioInstalling: boolean = false;

    /** Directory where Airone stores tooling */
    private readonly toolsDir: string;

    constructor() {
        this.compilerDir = this.resolveCompilerDir();
        this.pythonPath = this.resolvePythonPath();
        this.toolsDir = path.join(os.homedir(), '.airone', 'tools');
    }

    private resolveCompilerDir(): string {
        // In packaged app: resources/airo-compiler
        if (typeof __dirname !== 'undefined' && __dirname.includes('.asar')) {
            return path.join(process.resourcesPath!, 'airo-compiler');
        }

        // Dev mode - look for airo-compiler in common locations
        const possibleLocations = [
            path.resolve(__dirname, '../../../../../../airo-compiler'),
            path.resolve(process.cwd(), 'airo-compiler'),
            path.resolve(process.cwd(), '../airo-compiler'),
        ];

        try {
            for (const loc of possibleLocations) {
                if (fs.existsSync(path.join(loc, 'airo_compiler', '__init__.py'))) {
                    return loc;
                }
            }
        } catch {
            // ignore
        }

        return possibleLocations[0];
    }

    private resolvePythonPath(): string {
        // Check for a bundled Python first
        const vendorDir = resolveVendorDir();
        const bundledPython = process.platform === 'win32'
            ? path.join(vendorDir, 'python', 'python.exe')
            : path.join(vendorDir, 'python', 'bin', 'python3');
        if (fs.existsSync(bundledPython)) return bundledPython;

        return defaultPythonCommand();
    }

    /**
     * Compile a .airo file through the full pipeline.
     */
    async compile(request: CompileRequest): Promise<CompileResult> {
        // ─── Step 1: Built-in syntax check (always runs, no dependencies) ──
        const builtInResult = await this.builtInCompiler.verify(request.filePath);

        if (!builtInResult.success) {
            return {
                success: false,
                output: builtInResult.output,
                error: builtInResult.error || builtInResult.errors?.map(e => e.message).join('\n'),
            };
        }

        // ─── Step 2: Transpile .airo → C++ (always runs) ──────────────
        let airoCode: string;
        const fsPath = request.filePath.startsWith('file://')
            ? this.fsPathFromUri(request.filePath)
            : request.filePath;

        try {
            airoCode = fs.readFileSync(fsPath, { encoding: 'utf8' });
        } catch (err: unknown) {
            return {
                success: false,
                output: '',
                error: `Cannot read .airo file: ${err instanceof Error ? err.message : String(err)}`,
            };
        }

        const sketchName = path.basename(fsPath, '.airo');
        const transpileResult = this.transpiler.transpile(airoCode, sketchName);

        // Write the generated C++ code to a PlatformIO project structure
        const outputDir = request.outputDir || path.join(path.dirname(fsPath), 'build');
        try {
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            // PlatformIO project structure: src/<sketchName>.cpp
            const srcDir = path.join(outputDir, 'src');
            if (!fs.existsSync(srcDir)) {
                fs.mkdirSync(srcDir, { recursive: true });
            }

            const cppPath = path.join(srcDir, `${sketchName}.cpp`);
            fs.writeFileSync(cppPath, transpileResult.cppCode, { encoding: 'utf8' });

            // Generate platformio.ini
            const pioBoard = TARGET_TO_PIO_BOARD[request.target] || DEFAULT_PIO_BOARD;
            const pioIniContent = this.generatePlatformioIni(pioBoard, transpileResult.requiredLibraries);
            const pioIniPath = path.join(outputDir, 'platformio.ini');
            fs.writeFileSync(pioIniPath, pioIniContent, { encoding: 'utf8' });

            const generatedFiles = [cppPath, pioIniPath];
            let combinedOutput = builtInResult.output + '\n' +
                `✓ Step 2 — Transpiled to C++: ${cppPath}\n` +
                `  PlatformIO board: ${pioBoard}\n` +
                `  Required libraries: ${transpileResult.requiredLibraries.join(', ') || 'none'}\n` +
                (transpileResult.errors.length > 0 ? `  Warnings: ${transpileResult.errors.join('; ')}\n` : '');

            // ─── Step 3: PlatformIO build ─────────────────────────────
            // Find or install PlatformIO
            let pioCmd = this.findPlatformIO();

            if (!pioCmd) {
                combinedOutput += '\n⏳ Step 3 — PlatformIO not found. Attempting auto-install via pip...\n';
                const installResult = await this.ensurePlatformIO(combinedOutput);
                combinedOutput = installResult.output;

                if (installResult.pioPath) {
                    pioCmd = installResult.pioPath;
                } else {
                    combinedOutput +=
                        '\n⚠ Step 3 — Could not auto-install PlatformIO.\n' +
                        '  Firmware binary (.bin) not produced.\n' +
                        '  Please install Python 3 and PlatformIO:\n' +
                        '    pip install platformio\n' +
                        '  Or for offline use, bundle PlatformIO in the vendor/ directory.\n';

                    return {
                        success: true,
                        output: combinedOutput,
                        generatedFiles,
                    };
                }
            }

            // Run PlatformIO build
            const pioResult = await this.runPlatformioBuild(pioCmd, outputDir, pioBoard);

            if (pioResult.success) {
                combinedOutput += '\n✓ Step 3 — PlatformIO build succeeded.\n' + pioResult.output;
                if (pioResult.generatedFiles) {
                    generatedFiles.push(...pioResult.generatedFiles);
                }
                return {
                    success: true,
                    output: combinedOutput,
                    generatedFiles,
                    binaryPath: pioResult.binaryPath,
                };
            }

            // PlatformIO build failed
            combinedOutput +=
                '\n✗ Step 3 — PlatformIO build failed:\n' +
                `  ${pioResult.error || pioResult.output}\n`;

            return {
                success: true, // C++ was generated even if PlatformIO build failed
                output: combinedOutput,
                generatedFiles,
            };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                success: false,
                output: '',
                error: `Failed to write compiled output: ${message}`,
            };
        }
    }

    /**
     * Verify using the built-in TypeScript compiler (fast, no dependencies).
     */
    async verifyBuiltIn(filePath: string): Promise<import('../common/airo-protocol').VerifyResult> {
        return this.builtInCompiler.verify(filePath);
    }

    // ─── PlatformIO Detection & Installation ─────────────────────────────

    /**
     * Find PlatformIO CLI — checks:
     *  1. Bundled PlatformIO in vendor/
     *  2. System PATH (pio command)
     *  3. pip-installed PlatformIO (python -m platformio)
     */
    findPlatformIO(): string | undefined {
        if (this.cachedPioPath !== undefined) {
            return this.cachedPioPath;
        }

        // 1. Bundled PlatformIO in vendor directory
        const vendorDir = resolveVendorDir();
        const bundledPio = process.platform === 'win32'
            ? path.join(vendorDir, 'platformio_cache', 'penv', 'Scripts', 'pio.exe')
            : path.join(vendorDir, 'platformio_cache', 'penv', 'bin', 'pio');
        if (fs.existsSync(bundledPio)) {
            this.cachedPioPath = bundledPio;
            return this.cachedPioPath;
        }

        // 2. System PATH
        try {
            const isWin = process.platform === 'win32';
            const checkCmd = isWin ? 'where' : 'which';
            execSync(`${checkCmd} pio`, { stdio: 'ignore', timeout: 5000 });
            this.cachedPioPath = 'pio';
            return this.cachedPioPath;
        } catch {
            // not in PATH
        }

        // 3. Python module
        try {
            execSync(`"${this.pythonPath}" -m platformio --version`, {
                stdio: 'pipe',
                encoding: 'utf8',
                timeout: 10000,
            });
            this.cachedPioPath = `${this.pythonPath} -m platformio`;
            return this.cachedPioPath;
        } catch {
            // not installed as module
        }

        this.cachedPioPath = undefined;
        return undefined;
    }

    /**
     * Auto-install PlatformIO via pip.
     */
    async ensurePlatformIO(currentOutput: string): Promise<{ pioPath: string | undefined; output: string }> {
        let output = currentOutput;

        // Prevent concurrent installations
        if (this._pioInstalling) {
            output += '  PlatformIO installation already in progress...\n';
            return { pioPath: undefined, output };
        }

        this._pioInstalling = true;

        try {
            output += `  Installing PlatformIO via pip (${this.pythonPath} -m pip install platformio)...\n`;

            const installResult = await new Promise<boolean>(resolve => {
                const proc = spawn(this.pythonPath, ['-m', 'pip', 'install', 'platformio'], {
                    stdio: 'pipe',
                });

                let stderr = '';
                proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
                proc.stdout.on('data', (data: Buffer) => { output += data.toString(); });

                proc.on('close', (code: number | null) => {
                    resolve(code === 0);
                });

                proc.on('error', () => {
                    resolve(false);
                });

                // 5 minute timeout for pip install
                setTimeout(() => {
                    proc.kill();
                    resolve(false);
                }, 300_000);
            });

            if (installResult) {
                // Clear cache and re-detect
                this.cachedPioPath = undefined;
                const pioPath = this.findPlatformIO();

                if (pioPath) {
                    output += `  ✓ PlatformIO installed successfully: ${pioPath}\n`;
                    return { pioPath, output };
                }
            }

            output += '  ✗ PlatformIO auto-install failed.\n';
            return { pioPath: undefined, output };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            output += `  ✗ PlatformIO auto-install failed: ${message}\n`;
            return { pioPath: undefined, output };
        } finally {
            this._pioInstalling = false;
        }
    }

    // ─── PlatformIO Project Generation ───────────────────────────────────

    /**
     * Generate platformio.ini content for an ESP32 project.
     *
     * @param board PlatformIO board identifier (e.g. 'esp32dev')
     * @param libraries List of required Arduino libraries
     */
    generatePlatformioIni(board: string, libraries: string[] = []): string {
        const lines: string[] = [];

        lines.push('; PlatformIO Project Configuration File');
        lines.push('; Generated by Airone IDE');
        lines.push('');
        lines.push('[env:' + board + ']');

        // Board and platform
        lines.push(`platform = espressif32`);
        lines.push(`board = ${board}`);
        lines.push(`framework = arduino`);

        // Serial monitor speed
        lines.push(`monitor_speed = 115200`);
        lines.push(`monitor_filters = direct`);

        // Build flags for proper Arduino compatibility
        lines.push(`build_flags =`);
        lines.push(`    -DARDUINO=10820`);
        lines.push(`    -DBOARD_HAS_WIFI`);

        // Upload speed for faster flashing
        lines.push(`upload_speed = 460800`);

        // Libraries
        if (libraries.length > 0) {
            lines.push('');
            lines.push('lib_deps =');
            for (const lib of libraries) {
                lines.push(`    ${lib}`);
            }
        }

        lines.push('');
        return lines.join('\n');
    }

    // ─── PlatformIO Build ────────────────────────────────────────────────

    /**
     * Run PlatformIO build and locate the output firmware files.
     *
     * Supports both online and offline (bundled toolchain) modes.
     */
    async runPlatformioBuild(
        pioCmd: string,
        projectDir: string,
        board: string
    ): Promise<CompileResult> {
        return new Promise(resolve => {
            // Build environment variables for offline/bundled mode
            const pioCoreDir = resolvePlatformioCoreDir();
            const env: NodeJS.ProcessEnv = {
                ...process.env,
                PLATFORMIO_CORE_DIR: pioCoreDir,
            };

            // If using bundled vendor directory, force offline mode
            const vendorDir = resolveVendorDir();
            if (fs.existsSync(path.join(vendorDir, 'platformio_cache'))) {
                env.PLATFORMIO_SETTING_FORCE_OFFLINE = 'true';
            }

            // Parse pio command (may be "python -m platformio" or just "pio")
            const cmdParts = pioCmd.includes(' ')
                ? pioCmd.split(' ')
                : [pioCmd];
            const command = cmdParts[0];
            const baseArgs = cmdParts.slice(1);

            const args = [...baseArgs, 'run', '-d', projectDir, '-e', board];

            const proc = spawn(command, args, {
                cwd: projectDir,
                env,
                stdio: 'pipe',
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            proc.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            proc.on('close', (code: number | null) => {
                if (code === 0) {
                    // Find the firmware binaries in the PlatformIO build output
                    const firmwareFiles = this.findPlatformioFirmware(projectDir, board);

                    if (firmwareFiles.firmware) {
                        const generatedFiles = [firmwareFiles.firmware];
                        if (firmwareFiles.bootloader) generatedFiles.push(firmwareFiles.bootloader);
                        if (firmwareFiles.partitions) generatedFiles.push(firmwareFiles.partitions);

                        resolve({
                            success: true,
                            output: `  Firmware binary: ${firmwareFiles.firmware}\n` +
                                (firmwareFiles.bootloader ? `  Bootloader: ${firmwareFiles.bootloader}\n` : '') +
                                (firmwareFiles.partitions ? `  Partitions: ${firmwareFiles.partitions}\n` : ''),
                            generatedFiles,
                            binaryPath: firmwareFiles.firmware,
                        });
                    } else {
                        resolve({
                            success: false,
                            output: stdout,
                            error: 'PlatformIO build completed but no firmware .bin file was found in the build output.',
                        });
                    }
                } else {
                    resolve({
                        success: false,
                        output: stdout,
                        error: stderr || `PlatformIO exited with code ${code}`,
                    });
                }
            });

            proc.on('error', (err: Error) => {
                resolve({
                    success: false,
                    output: '',
                    error: `Failed to start PlatformIO: ${err.message}`,
                });
            });

            // 10 minute timeout — first builds can be very slow (downloading toolchain)
            setTimeout(() => {
                proc.kill();
                resolve({
                    success: false,
                    output: stdout,
                    error: 'PlatformIO build timed out after 600 seconds.',
                });
            }, 600_000);
        });
    }

    /**
     * Find firmware binaries in the PlatformIO build output directory.
     *
     * PlatformIO outputs to: .pio/build/<board>/
     * Key files: firmware.bin, bootloader.bin, partitions.bin
     */
    findPlatformioFirmware(projectDir: string, board: string): {
        firmware?: string;
        bootloader?: string;
        partitions?: string;
    } {
        const result: { firmware?: string; bootloader?: string; partitions?: string } = {};

        const buildDir = path.join(projectDir, PIO_BUILD_DIR, 'build', board);
        if (!fs.existsSync(buildDir)) {
            // Try searching recursively for firmware.bin
            result.firmware = this.findFileRecursive(projectDir, 'firmware.bin');
            return result;
        }

        // Standard PlatformIO output files
        const firmwarePath = path.join(buildDir, 'firmware.bin');
        const bootloaderPath = path.join(buildDir, 'bootloader.bin');
        const partitionsPath = path.join(buildDir, 'partitions.bin');

        if (fs.existsSync(firmwarePath)) {
            result.firmware = firmwarePath;
        }
        if (fs.existsSync(bootloaderPath)) {
            result.bootloader = bootloaderPath;
        }
        if (fs.existsSync(partitionsPath)) {
            result.partitions = partitionsPath;
        }

        // If firmware.bin not found at expected location, search recursively
        if (!result.firmware) {
            result.firmware = this.findFileRecursive(projectDir, 'firmware.bin');
        }

        return result;
    }

    /**
     * Get the chip family for a given PlatformIO board identifier.
     */
    getChipFamilyForBoard(board: string): string {
        return PIO_BOARD_TO_CHIP[board] || DEFAULT_CHIP_FAMILY;
    }

    // ─── Legacy Python Compiler (kept for backwards compatibility) ───────

    /**
     * Attempt to compile using the Python-based airo_compiler.
     * Kept as an optional step for backwards compatibility.
     */
    protected async tryPythonCompile(request: CompileRequest): Promise<CompileResult | undefined> {
        return new Promise(resolve => {
            const args = [
                '-m', 'airo_compiler',
                request.filePath,
                '--target', request.target,
                '--output', request.outputDir,
            ];
            if (request.wifiSsid) {
                args.push('--wifi-ssid', request.wifiSsid);
            }
            if (request.wifiPass) {
                args.push('--wifi-pass', request.wifiPass);
            }

            const proc = spawn(this.pythonPath, args, {
                cwd: this.compilerDir,
                env: { ...process.env, PYTHONPATH: this.compilerDir },
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            proc.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            proc.on('close', (code: number | null) => {
                resolve({
                    success: code === 0,
                    output: stdout,
                    error: code !== 0 ? stderr : undefined,
                });
            });

            proc.on('error', () => {
                resolve(undefined);
            });

            setTimeout(() => {
                proc.kill();
                resolve({
                    success: false,
                    output: stdout,
                    error: 'Compilation timed out after 60 seconds',
                });
            }, 60000);
        });
    }

    // ─── Template ────────────────────────────────────────────────────────

    /**
     * Get a new sketch template.
     */
    async getTemplate(): Promise<string> {
        const pythonTemplate = await this.tryPythonTemplate();
        if (pythonTemplate) {
            return pythonTemplate;
        }
        return this.getDefaultTemplate();
    }

    protected async tryPythonTemplate(): Promise<string | undefined> {
        return new Promise(resolve => {
            const proc = spawn(this.pythonPath, ['-m', 'airo_compiler', '--template'], {
                cwd: this.compilerDir,
                env: { ...process.env, PYTHONPATH: this.compilerDir },
            });

            let stdout = '';
            proc.stdout.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            proc.on('close', () => {
                resolve(stdout || undefined);
            });

            proc.on('error', () => {
                resolve(undefined);
            });
        });
    }

    private getDefaultTemplate(): string {
        return `#library#

Pin defi {

}

#variables#

loop {

}
`;
    }

    // ─── Utility Methods ─────────────────────────────────────────────────

    private fsPathFromUri(uri: string): string {
        const parsed = new URL(uri);
        let filePath = decodeURIComponent(parsed.pathname);
        if (process.platform === 'win32' && filePath.match(/^\/[A-Za-z]:/)) {
            filePath = filePath.substring(1);
        }
        return filePath;
    }

    /**
     * Search recursively for a file by name and return its full path.
     */
    private findFileRecursive(dir: string, fileName: string): string | undefined {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                // Skip node_modules and .git directories for performance
                if (entry.isDirectory() && !['node_modules', '.git'].includes(entry.name)) {
                    const result = this.findFileRecursive(fullPath, fileName);
                    if (result) return result;
                } else if (entry.name === fileName) {
                    return fullPath;
                }
            }
        } catch { /* ignore permission errors */ }
        return undefined;
    }
}
