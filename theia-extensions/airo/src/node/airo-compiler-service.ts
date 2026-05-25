/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { injectable } from '@theia/core/shared/inversify';
import { spawn } from 'child_process';
import * as path from 'path';
import { CompileRequest, CompileResult } from '../common/airo-protocol';

@injectable()
export class AiroCompilerService {

    private pythonPath: string;
    private compilerDir: string;

    constructor() {
        this.compilerDir = this.resolveCompilerDir();
        this.pythonPath = this.resolvePythonPath();
    }

    private resolveCompilerDir(): string {
        // In packaged app: resources/airo-compiler
        // In dev mode: look for airo-compiler relative to the extension
        if (__dirname.includes('.asar')) {
            return path.join(process.resourcesPath!, 'airo-compiler');
        }
        // Dev mode - look for airo-compiler in common locations
        // First try relative to the extension, then try the known project path
        const relativePath = path.resolve(__dirname, '../../../../../../airo-compiler');
        const projectPath = '/home/z/my-project/airo-compiler';

        // Prefer the project path if it exists
        try {
            const fs = require('fs');
            if (fs.existsSync(projectPath)) {
                return projectPath;
            }
        } catch {
            // ignore
        }
        return relativePath;
    }

    private resolvePythonPath(): string {
        return process.platform === 'win32' ? 'python' : 'python3';
    }

    async compile(request: CompileRequest): Promise<CompileResult> {
        return new Promise((resolve) => {
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
                resolve({
                    success: false,
                    output: '',
                    error: `Failed to start compiler: ${err.message}`,
                });
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

    async getTemplate(): Promise<string> {
        return new Promise((resolve) => {
            const proc = spawn(this.pythonPath, ['-m', 'airo_compiler', '--template'], {
                cwd: this.compilerDir,
                env: { ...process.env, PYTHONPATH: this.compilerDir },
            });

            let stdout = '';
            proc.stdout.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            proc.on('close', () => {
                resolve(stdout || this.getDefaultTemplate());
            });

            proc.on('error', () => {
                // Return hardcoded template as fallback
                resolve(this.getDefaultTemplate());
            });
        });
    }

    private getDefaultTemplate(): string {
        return `# ============================================
# AIRONE ROBOT CONFIGURATION
# ============================================

#library#
# Import body modules for your robot
# call body/actuation/upper-right-hands.airo.
# call body/sight/eyes.airo.
# call body/hearing/ears.airo.
# call body/speech/mouth.airo.
# call body/other_sensors/temperature.airo.

Pin defi {
    # pin_name = pin_number; mode.
    # mode: input (brings data in / senses) or output (makes action)
    ledpin = 2; output.
    # temperature_sensor = 35; input.
    # ultrasonic = 34; input.
    # servo_right = 13; output.
}

#variables#
# Brain URL — where your AI brain lives
brain_url = "wss://your-brain.local:8080".
call brain_url.

# Aliases (short names for body modules)
# body/sight/eyes.airo = eyes.
# body/hearing/ears.airo = ears.

# ============================================
# MAIN LOOP — The robot runs this forever
# SENSE → THINK → ACT
# ============================================
loop {
    # Phase 1: SENSE — Read all input sensors
    # Only place sensors/modules that bring in data or sense
    read_for(1000) {
        # temperature.
        # eyes.
        # ears.
    }

    # Phase 2: THINK — Send data to brain via WebSocket
    senddatato(brain_url).

    # Phase 3: ACT — Execute brain commands
    # Only place output modules here (things that make actions)
    actfor(1000) {
        ledpin.
        # servo_right.
    }
}
`;
    }
}
