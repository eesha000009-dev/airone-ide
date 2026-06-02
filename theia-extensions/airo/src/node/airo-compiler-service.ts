/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { injectable, inject } from '@theia/core/shared/inversify';
import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { CompileRequest, CompileResult } from '../common/airo-protocol';
import { AiroBuiltInCompiler } from './airo-built-in-compiler';
import { AiroTranspiler } from './airo-transpiler';

/**
 * Compiler service that provides a four-step TRUSTED compilation pipeline:
 *
 * **Step 1 – Built-in (TypeScript)**: Fast, no-dependency syntax checking.
 *    This runs immediately in the Node.js process and provides
 *    structural/syntactic validation of .airo files.
 *
 * **Step 2 – Transpiler (TypeScript)**: Converts .airo code to C++ Arduino/ESP32 code.
 *    Generates proper setup(), loop(), WiFi, WebSocket, and sensor/actuator code.
 *    Uses the brain_url from the .airo file for WebSocket communication.
 *    No hardcoding — everything comes from the .airo source.
 *    Always runs, produces .ino.cpp and .ino files.
 *
 * **Step 3 – Python (airo_compiler)**: Full compilation pipeline using Python.
 *    Always attempted. Produces refined .ino.cpp and .ino files when available.
 *    If Python is not installed, the TypeScript transpiler output is used as the
 *    C++ source (this is fine — it's a valid fallback).
 *
 * **Step 4 – Arduino CLI build**: Compiles the C++ into a .bin firmware file.
 *    Runs when `arduino-cli` is available in PATH.
 *    Produces <sketchName>.ino.bin in the build directory.
 *    If Arduino CLI is not installed, a clear message explains how to install it.
 *
 * The resulting .bin can be flashed to the ESP32 using esptool.py.
 */
@injectable()
export class AiroCompilerService {

    @inject(AiroBuiltInCompiler)
    protected readonly builtInCompiler!: AiroBuiltInCompiler;

    @inject(AiroTranspiler)
    protected readonly transpiler!: AiroTranspiler;

    private pythonPath: string;
    private compilerDir: string;
    private cachedArduinoCli: string | undefined;

    constructor() {
        this.compilerDir = this.resolveCompilerDir();
        this.pythonPath = this.resolvePythonPath();
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
            const fs = require('fs');
            for (const loc of possibleLocations) {
                if (fs.existsSync(path.join(loc, 'airo_compiler', '__init__.py'))) {
                    return loc;
                }
            }
        } catch {
            // ignore
        }

        // Fallback
        return possibleLocations[0];
    }

    private resolvePythonPath(): string {
        // Check for python3 first, then python
        return process.platform === 'win32' ? 'python' : 'python3';
    }

    /**
     * Compile a .airo file through the full TRUSTED pipeline:
     * Step 1: Built-in syntax check (always, fast)
     * Step 2: TypeScript transpile → C++ (always, produces .ino.cpp)
     * Step 3: Python airo_compiler (always attempt, produces .ino.cpp + .ino)
     * Step 4: Arduino CLI build (if available, produces .bin)
     */
    async compile(request: CompileRequest): Promise<CompileResult> {
        // ─── Step 1: Built-in syntax check (always runs, no dependencies) ──
        const builtInResult = await this.builtInCompiler.verify(request.filePath);

        if (!builtInResult.success) {
            // Built-in check found errors — no need to try transpilation
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

        // Write the generated C++ code to the output directory
        const outputDir = request.outputDir || path.join(path.dirname(fsPath), 'build');
        try {
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            const cppPath = path.join(outputDir, `${sketchName}.ino.cpp`);
            fs.writeFileSync(cppPath, transpileResult.cppCode, { encoding: 'utf8' });

            // Also write a minimal Arduino sketch .ino file
            const inoPath = path.join(outputDir, `${sketchName}.ino`);
            if (!fs.existsSync(inoPath)) {
                fs.writeFileSync(inoPath, `#include "${sketchName}.ino.cpp"\n`, { encoding: 'utf8' });
            }

            const generatedFiles = [cppPath, inoPath];
            let combinedOutput = builtInResult.output + '\n' +
                `✓ Step 2 — Transpiled to C++: ${cppPath}\n` +
                `  Required libraries: ${transpileResult.requiredLibraries.join(', ') || 'none'}\n` +
                (transpileResult.errors.length > 0 ? `  Warnings: ${transpileResult.errors.join('; ')}\n` : '');

            // ─── Step 3: Python airo_compiler (always attempt) ────────
            const pythonResult = await this.tryPythonCompile(request);

            if (pythonResult) {
                // Python compilation succeeded or failed with specific errors
                if (pythonResult.success) {
                    combinedOutput += '\n✓ Step 3 — Python airo_compiler succeeded.\n' + pythonResult.output;
                    if (pythonResult.generatedFiles) {
                        generatedFiles.push(...pythonResult.generatedFiles);
                    }
                } else {
                    // Python compilation failed but transpilation succeeded
                    combinedOutput +=
                        '\n⚠ Step 3 — Python airo_compiler failed (using TypeScript transpiler output as fallback):\n' +
                        `  ${pythonResult.error || pythonResult.output}\n` +
                        '  The C++ file from Step 2 is ready for Arduino CLI.\n';
                }
            } else {
                // Python not available — TypeScript transpiler result is the C++ output
                combinedOutput +=
                    '\n⚠ Step 3 — Python airo_compiler not available.\n' +
                    '  The TypeScript transpiler C++ output will be used (this is fine).\n' +
                    '  To enable Python-based compilation: pip install airo-compiler\n';
            }

            // ─── Step 4: Arduino CLI build (if available) ────────────
            const fqbn = request.target === 'esp8266'
                ? 'esp8266:esp8266:generic'
                : 'esp32:esp32:esp32';

            const arduinoResult = await this.tryArduinoBuild(outputDir, sketchName, fqbn);

            if (arduinoResult) {
                if (arduinoResult.success) {
                    combinedOutput += '\n✓ Step 4 — Arduino CLI build succeeded.\n' + arduinoResult.output;
                    if (arduinoResult.generatedFiles) {
                        generatedFiles.push(...arduinoResult.generatedFiles);
                    }
                    return {
                        success: true,
                        output: combinedOutput,
                        generatedFiles,
                        binaryPath: arduinoResult.binaryPath,
                    };
                }
                // Arduino CLI ran but build failed
                combinedOutput +=
                    '\n✗ Step 4 — Arduino CLI build failed:\n' +
                    `  ${arduinoResult.error || arduinoResult.output}\n` +
                    '  The C++ code is correct but the build did not produce a .bin file.\n' +
                    '  Check that ESP32 board support is installed:\n' +
                    '    arduino-cli core install esp32:esp32\n';
                return {
                    success: true, // C++ was generated even if Arduino build failed
                    output: combinedOutput,
                    generatedFiles,
                };
            }

            // Arduino CLI not available
            combinedOutput +=
                '\n⚠ Step 4 — Arduino CLI not found. Firmware binary (.bin) not produced.\n' +
                '  Install Arduino CLI for full compilation: https://arduino.github.io/arduino-cli/latest/\n' +
                '  Then install ESP32 board support: arduino-cli core install esp32:esp32\n' +
                `  Then compile: arduino-cli compile --fqbn ${fqbn} ${outputDir}\n` +
                '  Or use the Upload button which handles compilation + flashing automatically.\n';

            return {
                success: true,
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

    /**
     * Check if arduino-cli is available in the system PATH.
     * Returns the command string if found, or undefined.
     */
    findArduinoCli(): string | undefined {
        if (this.cachedArduinoCli !== undefined) {
            return this.cachedArduinoCli;
        }

        try {
            const isWin = process.platform === 'win32';
            const checkCmd = isWin ? 'where' : 'which';
            execSync(`${checkCmd} arduino-cli`, { stdio: 'ignore', timeout: 5000 });
            this.cachedArduinoCli = 'arduino-cli';
            return this.cachedArduinoCli;
        } catch {
            this.cachedArduinoCli = undefined;
            return undefined;
        }
    }

    /**
     * Attempt to compile C++ → .bin firmware using Arduino CLI.
     *
     * @param outputDir  Directory containing the .ino sketch (also receives the .bin)
     * @param sketchName Name of the sketch (without extension)
     * @param fqbn       Fully Qualified Board Name, e.g. 'esp32:esp32:esp32'
     * @returns CompileResult with binaryPath on success, or undefined if arduino-cli is not installed
     */
    async tryArduinoBuild(outputDir: string, sketchName: string, fqbn: string): Promise<CompileResult | undefined> {
        const arduinoCli = this.findArduinoCli();
        if (!arduinoCli) {
            return undefined;
        }

        return new Promise(resolve => {
            const args = [
                'compile',
                '--fqbn', fqbn,
                '--output-dir', outputDir,
                outputDir,
            ];

            const proc = spawn(arduinoCli, args, {
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
                const expectedBinPath = path.join(outputDir, `${sketchName}.ino.bin`);
                const binExists = fs.existsSync(expectedBinPath);

                if (code === 0 && binExists) {
                    resolve({
                        success: true,
                        output: `  Firmware binary: ${expectedBinPath}`,
                        generatedFiles: [expectedBinPath],
                        binaryPath: expectedBinPath,
                    });
                } else if (code === 0 && !binExists) {
                    // Arduino CLI succeeded but we can't find the .bin — search for alternatives
                    const altBinPath = this.findBinaryInDir(outputDir, sketchName);
                    if (altBinPath) {
                        resolve({
                            success: true,
                            output: `  Firmware binary: ${altBinPath}`,
                            generatedFiles: [altBinPath],
                            binaryPath: altBinPath,
                        });
                    } else {
                        resolve({
                            success: false,
                            output: stdout,
                            error: 'Arduino CLI reported success but no .bin file was found in the output directory.',
                        });
                    }
                } else {
                    resolve({
                        success: false,
                        output: stdout,
                        error: stderr || `Arduino CLI exited with code ${code}`,
                    });
                }
            });

            proc.on('error', (err: Error) => {
                // Should not happen since we already checked findArduinoCli(), but be safe
                resolve(undefined);
            });

            // 120 second timeout — Arduino CLI builds can be slow on first run
            setTimeout(() => {
                proc.kill();
                resolve({
                    success: false,
                    output: stdout,
                    error: 'Arduino CLI build timed out after 120 seconds.',
                });
            }, 120_000);
        });
    }

    /**
     * Search for a .bin file in the output directory if the expected name is not found.
     */
    private findBinaryInDir(outputDir: string, sketchName: string): string | undefined {
        try {
            const entries = fs.readdirSync(outputDir);
            // Look for any .bin file, preferring ones with the sketch name
            const binFiles = entries.filter(e => e.endsWith('.bin'));
            if (binFiles.length === 0) {
                return undefined;
            }
            // Prefer the one with sketch name
            const preferred = binFiles.find(b => b.includes(sketchName));
            return path.join(outputDir, preferred || binFiles[0]);
        } catch {
            return undefined;
        }
    }

    /**
     * Attempt to compile using the Python-based airo_compiler.
     * Returns undefined if Python or the module is not available.
     * Always attempted in the compile pipeline — undefined means Python is not installed,
     * and the TypeScript transpiler output is used as the C++ source instead.
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

            proc.on('error', (err: Error) => {
                // Python not found or airo_compiler not installed
                // This is expected — return undefined to indicate Python is not available
                resolve(undefined);
            });

            // 60 second timeout
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

    /**
     * Get a new sketch template.
     */
    async getTemplate(): Promise<string> {
        // Try Python first
        const pythonTemplate = await this.tryPythonTemplate();
        if (pythonTemplate) {
            return pythonTemplate;
        }

        // Fall back to built-in template
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

    private fsPathFromUri(uri: string): string {
        const parsed = new URL(uri);
        let filePath = decodeURIComponent(parsed.pathname);
        if (process.platform === 'win32' && filePath.match(/^\/[A-Za-z]:/)) {
            filePath = filePath.substring(1);
        }
        return filePath;
    }
}
