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
import * as os from 'os';
import * as https from 'https';
import * as zlib from 'zlib';
import { CompileRequest, CompileResult } from '../common/airo-protocol';
import { AiroBuiltInCompiler } from './airo-built-in-compiler';

/**
 * Compiler service that provides a 4-step compilation pipeline:
 *
 * 1. **Built-in (TypeScript)**: Fast syntax checking of .airo files.
 * 2. **Python (airo_compiler)**: Full transpilation .airo → C++ for ESP32.
 * 3. **Sketch preparation**: Convert C++ output to Arduino sketch format.
 * 4. **Arduino CLI**: Compile C++ → ESP32 .bin firmware binary.
 *
 * Step 4 auto-downloads Arduino CLI to ~/.airone/tools/ if not found,
 * and auto-installs the ESP32 core and required libraries.
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

    // ─── Path Resolution ──────────────────────────────────────────────────

    private resolveCompilerDir(): string {
        if (typeof __dirname !== 'undefined' && __dirname.includes('.asar')) {
            return path.join((process as any).resourcesPath!, 'airo-compiler');
        }

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
        return process.platform === 'win32' ? 'python' : 'python3';
    }

    /**
     * Get the Airone tools directory (~/.airone/tools/).
     * Arduino CLI and other tools are installed here.
     */
    private getToolsDir(): string {
        return path.join(os.homedir(), '.airone', 'tools');
    }

    /**
     * Get the Arduino CLI binary path.
     */
    private getArduinoCliPath(): string {
        const toolsDir = this.getToolsDir();
        const ext = process.platform === 'win32' ? '.exe' : '';
        return path.join(toolsDir, `arduino-cli${ext}`);
    }

    /**
     * Check if Arduino CLI exists at the expected path.
     */
    private isArduinoCliInstalled(): boolean {
        const cliPath = this.getArduinoCliPath();
        return fs.existsSync(cliPath);
    }

    // ─── Arduino CLI Auto-Install ─────────────────────────────────────────

    /**
     * Get the correct Arduino CLI download URL for the current platform.
     *
     * Official URLs from https://arduino.github.io/arduino-cli/1.2/installation/:
     * - Windows 64-bit: arduino-cli_latest_Windows_64bit.zip
     * - Windows ARM64:  arduino-cli_latest_Windows_ARM64.zip  (if available)
     * - Linux 64-bit:   arduino-cli_latest_Linux_64bit.tar.gz
     * - Linux ARM64:    arduino-cli_latest_Linux_ARM64.tar.gz
     * - macOS 64-bit:   arduino-cli_latest_macOS_64bit.tar.gz
     * - macOS ARM64:    arduino-cli_latest_macOS_ARM64.tar.gz
     */
    private getArduinoCliDownloadInfo(): { url: string; ext: string; osLabel: string } {
        const platform = process.platform;
        const arch = process.arch;

        // Map Node.js process.arch to Arduino CLI arch names
        let archName: string;
        if (arch === 'x64') {
            archName = '64bit';
        } else if (arch === 'arm64') {
            archName = 'ARM64';
        } else if (arch === 'ia32') {
            archName = '32bit';
        } else if (arch === 'arm') {
            archName = 'ARMv7';
        } else {
            archName = '64bit'; // default fallback
        }

        let osName: string;
        let ext: string;

        if (platform === 'win32') {
            osName = 'Windows';
            ext = 'zip';   // Windows uses .zip, NOT .tar.gz
        } else if (platform === 'darwin') {
            osName = 'macOS';
            ext = 'tar.gz';
        } else {
            osName = 'Linux';
            ext = 'tar.gz';
        }

        // Primary URL: downloads.arduino.cc (redirects to versioned URL)
        const url = `https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_${osName}_${archName}.${ext}`;
        const osLabel = `${osName}_${archName}`;

        return { url, ext, osLabel };
    }

    /**
     * Get the Arduino CLI download URL from GitHub Releases API.
     * Used as a fallback if the primary downloads.arduino.cc URL fails.
     */
    private async getArduinoCliGitHubUrl(osLabel: string, ext: string): Promise<string | undefined> {
        return new Promise(resolve => {
            const options: https.RequestOptions = {
                hostname: 'api.github.com',
                path: '/repos/arduino/arduino-cli/releases/latest',
                method: 'GET',
                headers: { 'User-Agent': 'AironeIDE/1.0' },
            };

            const req = https.request(options, res => {
                let data = '';
                res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
                res.on('end', () => {
                    try {
                        const release = JSON.parse(data);
                        const version = release.tag_name; // e.g., "v1.5.0"
                        // Find the matching asset
                        const assetPattern = `arduino-cli_${version.replace('v', '')}_${osLabel}.${ext}`;
                        const asset = (release.assets || []).find((a: { name: string; browser_download_url: string }) =>
                            a.name === assetPattern
                        );
                        if (asset) {
                            resolve(asset.browser_download_url);
                        } else {
                            // Fallback: construct URL directly
                            resolve(`https://github.com/arduino/arduino-cli/releases/download/${version}/arduino-cli_${version.replace('v', '')}_${osLabel}.${ext}`);
                        }
                    } catch {
                        resolve(undefined);
                    }
                });
            });

            req.on('error', () => resolve(undefined));
            req.setTimeout(10000, () => { req.destroy(); resolve(undefined); });
            req.end();
        });
    }

    /**
     * Download a file from a URL with proper redirect handling.
     */
    private downloadFile(url: string, destPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const followRedirect = (currentUrl: string, redirectCount = 0) => {
                if (redirectCount > 10) {
                    reject(new Error('Too many redirects'));
                    return;
                }

                const parsedUrl = new URL(currentUrl);
                const options: https.RequestOptions = {
                    hostname: parsedUrl.hostname,
                    path: parsedUrl.pathname + parsedUrl.search,
                    method: 'GET',
                    headers: { 'User-Agent': 'AironeIDE/1.0' },
                };

                const req = https.request(options, (res) => {
                    // Handle redirects
                    if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303 || res.statusCode === 307 || res.statusCode === 308) {
                        const location = res.headers.location;
                        if (location) {
                            followRedirect(location, redirectCount + 1);
                            return;
                        }
                    }

                    if (res.statusCode !== 200) {
                        reject(new Error(`Download failed with status ${res.statusCode}`));
                        return;
                    }

                    const destDir = path.dirname(destPath);
                    if (!fs.existsSync(destDir)) {
                        fs.mkdirSync(destDir, { recursive: true });
                    }

                    const file = fs.createWriteStream(destPath);
                    res.pipe(file);

                    file.on('finish', () => {
                        file.close();
                        resolve();
                    });

                    file.on('error', (err) => {
                        fs.unlinkSync(destPath);
                        reject(err);
                    });
                });

                req.on('error', reject);
                req.setTimeout(120000, () => {
                    req.destroy();
                    reject(new Error('Download timed out after 120 seconds'));
                });
                req.end();
            };

            followRedirect(url);
        });
    }

    /**
     * Extract a downloaded archive (.zip or .tar.gz) to the tools directory.
     */
    private extractArchive(archivePath: string, ext: string): void {
        const toolsDir = this.getToolsDir();

        if (ext === 'zip') {
            // Use built-in unzip on Windows, or unzip command on others
            if (process.platform === 'win32') {
                // PowerShell Expand-Archive is reliable on Windows
                try {
                    execSync(`powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${toolsDir}' -Force"`, {
                        timeout: 60000,
                    });
                } catch {
                    // Fallback: try tar (available on Windows 10+)
                    execSync(`tar -xf "${archivePath}" -C "${toolsDir}"`, { timeout: 60000 });
                }
            } else {
                // On Linux/macOS, use unzip command
                try {
                    execSync(`unzip -o "${archivePath}" -d "${toolsDir}"`, { timeout: 60000 });
                } catch {
                    // Fallback to tar if unzip is not available
                    execSync(`tar -xf "${archivePath}" -C "${toolsDir}"`, { timeout: 60000 });
                }
            }
        } else {
            // .tar.gz
            execSync(`tar -xzf "${archivePath}" -C "${toolsDir}"`, { timeout: 60000 });
        }
    }

    /**
     * Auto-download and install Arduino CLI to ~/.airone/tools/.
     */
    private async autoInstallArduinoCli(outputCb: (msg: string) => void): Promise<boolean> {
        const { url, ext, osLabel } = this.getArduinoCliDownloadInfo();
        const toolsDir = this.getToolsDir();

        outputCb(`  Downloading Arduino CLI for ${osLabel}...`);
        outputCb(`  URL: ${url}`);

        const archivePath = path.join(toolsDir, `arduino-cli-download.${ext}`);

        try {
            if (!fs.existsSync(toolsDir)) {
                fs.mkdirSync(toolsDir, { recursive: true });
            }

            // Download — try primary URL first, then GitHub fallback
            try {
                await this.downloadFile(url, archivePath);
                outputCb('  ✓ Download complete.');
            } catch (primaryErr: unknown) {
                const primaryMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
                outputCb(`  Primary URL failed: ${primaryMsg}`);
                outputCb('  Trying GitHub Releases fallback...');

                const githubUrl = await this.getArduinoCliGitHubUrl(osLabel, ext);
                if (githubUrl) {
                    outputCb(`  Fallback URL: ${githubUrl}`);
                    await this.downloadFile(githubUrl, archivePath);
                    outputCb('  ✓ Download complete (from GitHub).');
                } else {
                    throw new Error(`Download failed: ${primaryMsg}. GitHub fallback also failed.`);
                }
            }

            // Extract
            outputCb('  Extracting...');
            this.extractArchive(archivePath, ext);
            outputCb('  ✓ Extraction complete.');

            // Clean up archive
            try { fs.unlinkSync(archivePath); } catch { /* ignore */ }

            // Make executable on Unix
            const cliPath = this.getArduinoCliPath();
            if (process.platform !== 'win32' && fs.existsSync(cliPath)) {
                fs.chmodSync(cliPath, 0o755);
            }

            // Verify
            if (!fs.existsSync(cliPath)) {
                // The archive might extract to a different name — search for it
                const files = fs.readdirSync(toolsDir);
                const cliCandidate = files.find(f =>
                    f.startsWith('arduino-cli') && !f.includes('download')
                );
                if (cliCandidate) {
                    const candidatePath = path.join(toolsDir, cliCandidate);
                    if (fs.existsSync(candidatePath) && !fs.existsSync(cliPath)) {
                        fs.renameSync(candidatePath, cliPath);
                    }
                }
            }

            if (this.isArduinoCliInstalled()) {
                outputCb('  ✓ Arduino CLI installed successfully.');
                return true;
            } else {
                outputCb('  ✗ Arduino CLI binary not found after extraction.');
                return false;
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            outputCb(`  ✗ Arduino CLI auto-install failed: ${message}`);

            // Clean up partial download
            try { fs.unlinkSync(archivePath); } catch { /* ignore */ }

            return false;
        }
    }

    /**
     * Run an Arduino CLI command and return its output.
     */
    private runArduinoCli(args: string[], timeout = 120000): Promise<{ code: number | null; stdout: string; stderr: string }> {
        return new Promise(resolve => {
            const cliPath = this.getArduinoCliPath();
            const proc = spawn(cliPath, args, { timeout });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
            proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

            proc.on('close', (code: number | null) => {
                resolve({ code, stdout, stderr });
            });

            proc.on('error', (err: Error) => {
                resolve({ code: -1, stdout, stderr: err.message });
            });
        });
    }

    /**
     * Ensure the ESP32 core and required libraries are installed.
     */
    private async ensureArduinoSetup(outputCb: (msg: string) => void): Promise<boolean> {
        const cliPath = this.getArduinoCliPath();

        // Step 1: Initialize Arduino CLI config if not already done
        const configDir = path.join(os.homedir(), '.airone', 'arduino-cli');
        if (!fs.existsSync(path.join(configDir, 'arduino-cli.yaml'))) {
            outputCb('  Initializing Arduino CLI config...');
            const initResult = await this.runArduinoCli([
                'config', 'init',
                '--dest-dir', configDir,
            ], 30000);
            if (initResult.code !== 0) {
                outputCb(`  ⚠ Config init warning: ${initResult.stderr.trim()}`);
            }
        }

        // Step 2: Add ESP32 board URL
        outputCb('  Adding ESP32 board index...');
        await this.runArduinoCli([
            'config', 'add', 'board_manager.additional_urls',
            'https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json',
        ], 30000);

        // Step 3: Update board index
        outputCb('  Updating board index (this may take a moment)...');
        const updateResult = await this.runArduinoCli(['core', 'update-index'], 60000);
        if (updateResult.code !== 0) {
            outputCb(`  ⚠ Board index update warning: ${updateResult.stderr.trim()}`);
        }

        // Step 4: Install ESP32 core
        outputCb('  Installing ESP32 core (this may take a few minutes on first run)...');
        const coreResult = await this.runArduinoCli(['core', 'install', 'esp32:esp32'], 300000);
        if (coreResult.code !== 0) {
            outputCb(`  ⚠ ESP32 core install warning: ${coreResult.stderr.trim()}`);
        } else {
            outputCb('  ✓ ESP32 core installed.');
        }

        // Step 5: Install required libraries
        const libraries = ['WebSockets', 'ArduinoJson'];
        for (const lib of libraries) {
            outputCb(`  Installing library: ${lib}...`);
            const libResult = await this.runArduinoCli(['lib', 'install', lib], 120000);
            if (libResult.code !== 0) {
                outputCb(`  ⚠ Library ${lib} install warning: ${libResult.stderr.trim()}`);
                // Try without version constraint — some libraries might already be installed
                const alreadyInstalled = libResult.stderr.includes('already') || libResult.stderr.includes('Installed');
                if (!alreadyInstalled) {
                    // Library install failure is not fatal — ESP32 core includes some
                    outputCb(`  Continuing without ${lib} — it may be bundled with ESP32 core.`);
                }
            } else {
                outputCb(`  ✓ Library ${lib} installed.`);
            }
        }

        return true;
    }

    // ─── Main Compile Pipeline ────────────────────────────────────────────

    /**
     * Compile a .airo file through the full 4-step pipeline.
     */
    async compile(request: CompileRequest): Promise<CompileResult> {
        const outputLines: string[] = [];
        const outputCb = (msg: string) => { outputLines.push(msg); };

        // ─── Step 1: Built-in syntax check ─────────────────────────────
        outputCb(`\n--- Compiling ${path.basename(request.filePath)} ---`);
        outputCb(`Target: ESP32 DevKit (esp32)`);
        outputCb('Verifying syntax...');

        const builtInResult = await this.builtInCompiler.verify(request.filePath);

        if (!builtInResult.success) {
            return {
                success: false,
                output: outputLines.join('\n') + '\n\n' + builtInResult.output,
                error: builtInResult.error || builtInResult.errors?.map(e => e.message).join('\n'),
            };
        }

        outputCb('✓ Syntax verification successful!');

        // ─── Step 2: Python transpilation (.airo → C++) ───────────────
        outputCb('Transpiling .airo → C++...');

        const pythonResult = await this.tryPythonCompile(request);

        if (!pythonResult) {
            // Python not available — return built-in result only
            return {
                success: true,
                output: outputLines.join('\n') +
                    '\n\n⚠ Full compilation requires Python + airo_compiler module.\n' +
                    'Install with: pip install airo-compiler\n' +
                    'Syntax check passed — code structure is valid.',
            };
        }

        // Append Python output to our output
        outputCb(pythonResult.output);

        if (!pythonResult.success) {
            return {
                success: false,
                output: outputLines.join('\n'),
                error: pythonResult.error,
            };
        }

        outputCb('✓ Step 3 — Python airo_compiler succeeded.');

        // ─── Step 4: Arduino CLI compile (C++ → .bin firmware) ────────
        outputCb('');
        outputCb('⏳ Step 4 — Building firmware with Arduino CLI...');

        const firmwareResult = await this.arduinoCliBuild(request, outputCb, outputLines);

        // Include the original Python output + our step 4 output
        return firmwareResult;
    }

    /**
     * Step 4: Build firmware binary using Arduino CLI.
     *
     * Auto-downloads Arduino CLI if not found, installs ESP32 core
     * and libraries, then compiles the C++ output to a .bin file.
     */
    private async arduinoCliBuild(
        request: CompileRequest,
        outputCb: (msg: string) => void,
        collectedOutput: string[],
    ): Promise<CompileResult> {
        // ─── Check / Auto-install Arduino CLI ────────────────────────

        if (!this.isArduinoCliInstalled()) {
            outputCb('  Arduino CLI not found. Auto-installing...');
            const installed = await this.autoInstallArduinoCli(outputCb);

            if (!installed) {
                outputCb('');
                outputCb('⚠ Step 4 — Could not auto-install Arduino CLI.');
                outputCb('  Firmware binary (.bin) not produced.');
                outputCb('  Install manually: https://arduino.github.io/arduino-cli/latest/');
                outputCb('  Then: arduino-cli core install esp32:esp32');
                outputCb(`  Then: arduino-cli compile --fqbn esp32:esp32:esp32 "${request.outputDir}"`);

                return {
                    success: true, // Python compilation succeeded, just no firmware binary
                    output: collectedOutput.join('\n'),
                };
            }
        }

        // ─── Ensure ESP32 core + libraries ────────────────────────────

        await this.ensureArduinoSetup(outputCb);

        // ─── Prepare Arduino sketch ──────────────────────────────────
        // Arduino CLI expects a sketch directory with a .ino file.
        // The Python compiler outputs .cpp files — we need to create
        // a proper Arduino sketch structure.

        const sketchDir = request.outputDir;
        const sketchName = path.basename(request.filePath, '.airo');

        // Ensure the sketch directory exists
        if (!fs.existsSync(sketchDir)) {
            fs.mkdirSync(sketchDir, { recursive: true });
        }

        // Find and prepare the main sketch file
        // The Python compiler may output:
        // 1. <name>.ino.cpp (from the simple transpiler in __init__.py)
        // 2. main.cpp (from the Jinja2 template in cli.py)
        // We need to ensure there's a <name>.ino file for Arduino CLI

        const possibleCppFiles = [
            path.join(sketchDir, `${sketchName}.ino.cpp`),
            path.join(sketchDir, 'main.cpp'),
            path.join(sketchDir, `${sketchName}.cpp`),
        ];

        let mainCppFile: string | undefined;
        for (const f of possibleCppFiles) {
            if (fs.existsSync(f)) {
                mainCppFile = f;
                break;
            }
        }

        // Also check for any .cpp file in the sketch directory
        if (!mainCppFile) {
            try {
                const files = fs.readdirSync(sketchDir);
                const cppFile = files.find(f => f.endsWith('.cpp'));
                if (cppFile) {
                    mainCppFile = path.join(sketchDir, cppFile);
                }
            } catch { /* ignore */ }
        }

        if (mainCppFile) {
            const inoPath = path.join(sketchDir, `${sketchName}.ino`);

            // Copy the main C++ file as the .ino sketch file
            // Arduino CLI accepts .ino files that contain C++ code
            try {
                let content = fs.readFileSync(mainCppFile, { encoding: 'utf8' });

                // Add Arduino.h include if missing (Arduino CLI expects it)
                if (!content.includes('#include <Arduino.h>') && !content.includes('#include <arduino.h>')) {
                    content = '#include <Arduino.h>\n' + content;
                }

                // Only write the .ino file if it doesn't already exist or is different
                if (!fs.existsSync(inoPath) || fs.readFileSync(inoPath, { encoding: 'utf8' }) !== content) {
                    fs.writeFileSync(inoPath, content, { encoding: 'utf8' });
                }

                outputCb(`  ✓ Sketch prepared: ${inoPath}`);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                outputCb(`  ⚠ Could not prepare sketch: ${message}`);
            }
        }

        // ─── Compile with Arduino CLI ────────────────────────────────

        outputCb('  Compiling firmware...');
        outputCb(`  Sketch: ${sketchDir}`);
        outputCb('  FQBN: esp32:esp32:esp32');

        const compileResult = await this.runArduinoCli([
            'compile',
            '--fqbn', 'esp32:esp32:esp32',
            '--warnings', 'all',
            sketchDir,
        ], 180000); // 3 minute timeout for compilation

        if (compileResult.code === 0) {
            outputCb('  ✓ Compilation successful!');
            outputCb('');

            // Find the generated .bin file
            let binPath = '';
            try {
                const buildDir = path.join(sketchDir, 'build');
                if (fs.existsSync(buildDir)) {
                    const findBin = (dir: string): string => {
                        const entries = fs.readdirSync(dir, { withFileTypes: true });
                        for (const entry of entries) {
                            const fullPath = path.join(dir, entry.name);
                            if (entry.isDirectory()) {
                                const found = findBin(fullPath);
                                if (found) return found;
                            } else if (entry.name.endsWith('.bin')) {
                                return fullPath;
                            }
                        }
                        return '';
                    };
                    binPath = findBin(buildDir);
                }
            } catch { /* ignore */ }

            if (binPath) {
                outputCb(`✓ Step 4 — Firmware binary: ${binPath}`);
                outputCb('');
                outputCb('To flash to your ESP32 board:');
                outputCb(`  esptool --chip esp32 --port <PORT> --baud 921600 write_flash -z 0x10000 "${binPath}"`);
                outputCb('');
                outputCb('Or use the Upload button in Airone IDE.');
            } else {
                outputCb('✓ Step 4 — Firmware compiled successfully.');
                outputCb('  Binary should be in the build subdirectory.');
            }

            // Collect any useful output from Arduino CLI
            if (compileResult.stdout.trim()) {
                const lines = compileResult.stdout.trim().split('\n');
                const summary = lines.slice(-3).join('\n  ');
                if (summary) {
                    outputCb(`  ${summary}`);
                }
            }

            return {
                success: true,
                output: collectedOutput.join('\n'),
                generatedFiles: binPath ? [binPath] : undefined,
            };
        } else {
            outputCb('  ✗ Firmware compilation failed.');
            if (compileResult.stderr.trim()) {
                // Show last few lines of error
                const errorLines = compileResult.stderr.trim().split('\n');
                const relevantErrors = errorLines
                    .filter(l => l.includes('error:') || l.includes('Error'))
                    .slice(-5);
                for (const err of relevantErrors) {
                    outputCb(`  ${err.trim()}`);
                }
            }

            return {
                success: false,
                output: collectedOutput.join('\n'),
                error: compileResult.stderr.trim() || 'Firmware compilation failed',
            };
        }
    }

    // ─── Built-in Verification ────────────────────────────────────────────

    /**
     * Verify using the built-in TypeScript compiler (fast, no dependencies).
     */
    async verifyBuiltIn(filePath: string): Promise<import('../common/airo-protocol').VerifyResult> {
        return this.builtInCompiler.verify(filePath);
    }

    // ─── Python Transpilation ─────────────────────────────────────────────

    /**
     * Attempt to compile using the Python-based airo_compiler.
     * Returns undefined if Python or the module is not available.
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
                // Python not found or airo_compiler not installed
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

    // ─── Template ─────────────────────────────────────────────────────────

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
}
