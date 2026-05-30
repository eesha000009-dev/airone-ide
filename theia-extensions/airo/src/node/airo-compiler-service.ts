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
import { CompileRequest, CompileResult } from '../common/airo-protocol';
import { AiroBuiltInCompiler } from './airo-built-in-compiler';

/**
 * Compiler service that provides two tiers of compilation:
 *
 * 1. **Built-in (TypeScript)**: Fast, no-dependency syntax checking.
 *    This runs immediately in the Node.js process and provides
 *    structural/syntactic validation of .airo files.
 *
 * 2. **Python (airo_compiler)**: Full transpilation to C++ for ESP32.
 *    This is used when Python and airo_compiler are available.
 *    Falls back gracefully when they are not installed.
 *
 * The bundled airo_compiler module is looked for in several locations:
 * - Next to the app resources (in packaged app)
 * - In the airo-compiler directory at the project root (in dev mode)
 * - As a system-installed Python module (pip install airo-compiler)
 */
@injectable()
export class AiroCompilerService {

    @inject(AiroBuiltInCompiler)
    protected readonly builtInCompiler!: AiroBuiltInCompiler;

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
     * then attempt Python-based full compilation if requested.
     */
    async compile(request: CompileRequest): Promise<CompileResult> {
        // ─── Step 1: Built-in syntax check (always runs, no dependencies) ──
        const builtInResult = await this.builtInCompiler.verify(request.filePath);

        if (!builtInResult.success) {
            // Built-in check found errors — no need to try Python compilation
            return {
                success: false,
                output: builtInResult.output,
                error: builtInResult.error || builtInResult.errors?.map(e => e.message).join('\n'),
            };
        }

        // ─── Step 2: Try Python-based full compilation ────────────────────
        const pythonResult = await this.tryPythonCompile(request);

        if (pythonResult) {
            return pythonResult;
        }

        // ─── Step 3: Python not available — return built-in result ─────────
        // The built-in check passed, so we report success for syntax validation.
        // Note: Full transpilation to C++ requires Python + airo_compiler.
        return {
            success: true,
            output: builtInResult.output +
                '\n\n⚠ Full compilation requires Python + airo_compiler module.\n' +
                'Install with: pip install airo-compiler\n' +
                'Syntax check passed — code structure is valid.',
        };
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
}
