/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { injectable, inject } from '@theia/core/shared/inversify';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { CompileRequest, CompileResult } from '../common/airo-protocol';
import { AiroBuiltInCompiler } from './airo-built-in-compiler';
import { AiroTranspiler } from './airo-transpiler';

/**
 * Compiler service that provides three tiers of compilation:
 *
 * 1. **Built-in (TypeScript)**: Fast, no-dependency syntax checking.
 *    This runs immediately in the Node.js process and provides
 *    structural/syntactic validation of .airo files.
 *
 * 2. **Transpiler (TypeScript)**: Converts .airo code to C++ Arduino/ESP32 code.
 *    Generates proper setup(), loop(), WiFi, WebSocket, and sensor/actuator code.
 *    Uses the brain_url from the .airo file for WebSocket communication.
 *    No hardcoding — everything comes from the .airo source.
 *
 * 3. **Python (airo_compiler)**: Full compilation pipeline using Python.
 *    This is used when Python and airo_compiler are available.
 *    Falls back gracefully when they are not installed.
 *
 * The compiled C++ code can then be built using Arduino CLI and flashed
 * to the ESP32 using esptool.py.
 */
@injectable()
export class AiroCompilerService {

    @inject(AiroBuiltInCompiler)
    protected readonly builtInCompiler!: AiroBuiltInCompiler;

    @inject(AiroTranspiler)
    protected readonly transpiler!: AiroTranspiler;

    private pythonPath: string;
    private compilerDir: string;

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
     * Compile a .airo file using the built-in TypeScript verifier first,
     * then transpile to C++, then attempt Python-based full compilation if requested.
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

        // ─── Step 2: Transpile .airo → C++ ──────────────────────────────
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

            // ─── Step 3: Try Python-based full compilation ─────────────
            const pythonResult = await this.tryPythonCompile(request);

            if (pythonResult) {
                // Python compilation succeeded or failed with specific errors
                if (pythonResult.success) {
                    return {
                        success: true,
                        output: builtInResult.output + '\n' +
                            `✓ Transpiled to C++: ${cppPath}\n` +
                            `  Required libraries: ${transpileResult.requiredLibraries.join(', ') || 'none'}\n` +
                            (transpileResult.errors.length > 0 ? `  Warnings: ${transpileResult.errors.join('; ')}\n` : '') +
                            pythonResult.output,
                        generatedFiles: [...generatedFiles, ...(pythonResult.generatedFiles || [])],
                    };
                }
                // Python compilation failed but transpilation succeeded
                // Return transpilation result + Python errors
                return {
                    success: true, // C++ was generated even if Python build failed
                    output: builtInResult.output + '\n' +
                        `✓ Transpiled to C++: ${cppPath}\n` +
                        `  Required libraries: ${transpileResult.requiredLibraries.join(', ') || 'none'}\n` +
                        (transpileResult.errors.length > 0 ? `  Warnings: ${transpileResult.errors.join('; ')}\n` : '') +
                        '\n⚠ Arduino compilation requires Arduino CLI or Python airo_compiler.\n' +
                        `  Install Arduino CLI: https://arduino.github.io/arduino-cli/latest/\n` +
                        `  Or install airo_compiler: pip install airo-compiler\n` +
                        `  The C++ file is ready at: ${cppPath}\n`,
                    generatedFiles,
                };
            }

            // ─── Step 4: Python not available — return transpilation result ──
            return {
                success: true,
                output: builtInResult.output +
                    '\n\n✓ Transpiled to C++ successfully!\n' +
                    `  Output: ${cppPath}\n` +
                    `  Required libraries: ${transpileResult.requiredLibraries.join(', ') || 'none'}\n` +
                    (transpileResult.errors.length > 0 ? `  Warnings: ${transpileResult.errors.join('; ')}\n` : '') +
                    '\n⚠ Full Arduino compilation requires Arduino CLI or Python + airo_compiler module.\n' +
                    '  To compile and flash manually:\n' +
                    '  1. Install Arduino CLI: https://arduino.github.io/arduino-cli/latest/\n' +
                    '  2. Install ESP32 board support: arduino-cli core install esp32:esp32\n' +
                    `  3. Compile: arduino-cli compile --fqbn ${request.target === 'esp8266' ? 'esp8266:esp8266:generic' : 'esp32:esp32:esp32'} ${outputDir}\n` +
                    '  4. Or use the Upload button which handles compilation + flashing automatically.\n',
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
     * Attempt to compile using the Python-based airo_compiler.
     * Returns null if Python or the module is not available.
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
