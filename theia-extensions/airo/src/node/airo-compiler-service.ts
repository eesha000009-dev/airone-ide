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
import { AiroTranspiler } from './airo-transpiler';

/**
 * Compiler service that provides a four-step TRUSTED compilation pipeline:
 *
 * **Step 1 – Built-in (TypeScript)**: Fast, no-dependency syntax checking.
 *
 * **Step 2 – Transpiler (TypeScript)**: Converts .airo code to C++ Arduino/ESP32 code.
 *
 * **Step 3 – Python (airo_compiler)**: Full compilation pipeline using Python.
 *    If Python is not installed, the TypeScript transpiler output is used.
 *
 * **Step 4 – Arduino CLI build**: Compiles the C++ into a .bin firmware file.
 *    Auto-downloads Arduino CLI to ~/.airone/tools/ if not found in PATH.
 *    Auto-installs ESP32 board support and required libraries.
 *    Produces <sketchName>.ino.bin in the build directory.
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
    private _arduinoCliInstalling: boolean = false;

    /** Directory where Airone stores tooling (Arduino CLI, esptool, etc.) */
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

        // Fallback
        return possibleLocations[0];
    }

    private resolvePythonPath(): string {
        return process.platform === 'win32' ? 'python' : 'python3';
    }

    /**
     * Compile a .airo file through the full TRUSTED pipeline.
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
                if (pythonResult.success) {
                    combinedOutput += '\n✓ Step 3 — Python airo_compiler succeeded.\n' + pythonResult.output;
                    if (pythonResult.generatedFiles) {
                        generatedFiles.push(...pythonResult.generatedFiles);
                    }
                } else {
                    combinedOutput +=
                        '\n⚠ Step 3 — Python airo_compiler failed (using TypeScript transpiler output as fallback):\n' +
                        `  ${pythonResult.error || pythonResult.output}\n` +
                        '  The C++ file from Step 2 is ready for Arduino CLI.\n';
                }
            } else {
                combinedOutput +=
                    '\n⚠ Step 3 — Python airo_compiler not available.\n' +
                    '  The TypeScript transpiler C++ output will be used (this is fine).\n';
            }

            // ─── Step 4: Arduino CLI build (auto-install if needed) ────
            const fqbn = request.target === 'esp8266'
                ? 'esp8266:esp8266:generic'
                : 'esp32:esp32:esp32';

            // Try to find or auto-install Arduino CLI
            let arduinoCli = this.findArduinoCli();

            if (!arduinoCli) {
                combinedOutput += '\n⏳ Step 4 — Arduino CLI not found. Auto-installing...\n';
                const installResult = await this.ensureArduinoCli(combinedOutput);
                combinedOutput = installResult.output;

                if (installResult.cliPath) {
                    arduinoCli = installResult.cliPath;
                } else {
                    combinedOutput +=
                        '\n⚠ Step 4 — Could not auto-install Arduino CLI.\n' +
                        '  Firmware binary (.bin) not produced.\n' +
                        '  Install manually: https://arduino.github.io/arduino-cli/latest/\n' +
                        '  Then: arduino-cli core install esp32:esp32\n' +
                        `  Then: arduino-cli compile --fqbn ${fqbn} "${outputDir}"\n`;

                    return {
                        success: true,
                        output: combinedOutput,
                        generatedFiles,
                    };
                }
            }

            // Ensure ESP32 board support is installed
            const coreCheck = await this.ensureEsp32Core(arduinoCli, fqbn, combinedOutput);
            combinedOutput = coreCheck.output;

            // Install required libraries
            if (transpileResult.requiredLibraries.length > 0) {
                const libResult = await this.installRequiredLibs(
                    arduinoCli, transpileResult.requiredLibraries, combinedOutput
                );
                combinedOutput = libResult.output;
            }

            // Now run the Arduino CLI build
            const arduinoResult = await this.tryArduinoBuildWithCli(arduinoCli, outputDir, sketchName, fqbn);

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
                `  ${arduinoResult.error || arduinoResult.output}\n`;

            return {
                success: true, // C++ was generated even if Arduino build failed
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
     * Check if arduino-cli is available — first in PATH, then in ~/.airone/tools/.
     * Returns the command/path string if found, or undefined.
     */
    findArduinoCli(): string | undefined {
        if (this.cachedArduinoCli !== undefined) {
            return this.cachedArduinoCli;
        }

        // 1. Check system PATH
        try {
            const isWin = process.platform === 'win32';
            const checkCmd = isWin ? 'where' : 'which';
            execSync(`${checkCmd} arduino-cli`, { stdio: 'ignore', timeout: 5000 });
            this.cachedArduinoCli = 'arduino-cli';
            return this.cachedArduinoCli;
        } catch {
            // not in PATH
        }

        // 2. Check local tools directory
        const localCliPath = this.getLocalArduinoCliPath();
        if (localCliPath && fs.existsSync(localCliPath)) {
            this.cachedArduinoCli = localCliPath;
            return this.cachedArduinoCli;
        }

        this.cachedArduinoCli = undefined;
        return undefined;
    }

    /**
     * Get the expected path for a locally-installed Arduino CLI.
     */
    private getLocalArduinoCliPath(): string {
        const isWin = process.platform === 'win32';
        return path.join(this.toolsDir, isWin ? 'arduino-cli.exe' : 'arduino-cli');
    }

    /**
     * Auto-download and install Arduino CLI to ~/.airone/tools/.
     *
     * Downloads the latest stable release from GitHub.
     * Returns the path to the installed binary, or undefined on failure.
     */
    async ensureArduinoCli(currentOutput: string): Promise<{ cliPath: string | undefined; output: string }> {
        let output = currentOutput;

        // Prevent concurrent installations
        if (this._arduinoCliInstalling) {
            output += '  Arduino CLI installation already in progress...\n';
            return { cliPath: undefined, output };
        }

        // Check if already installed locally
        const localPath = this.getLocalArduinoCliPath();
        if (fs.existsSync(localPath)) {
            this.cachedArduinoCli = localPath;
            output += `  ✓ Found local Arduino CLI: ${localPath}\n`;
            return { cliPath: localPath, output };
        }

        this._arduinoCliInstalling = true;

        try {
            // Create tools directory
            if (!fs.existsSync(this.toolsDir)) {
                fs.mkdirSync(this.toolsDir, { recursive: true });
            }

            // Determine platform-specific download URL
            const platform = this.getArduinoCliPlatform();
            const ext = platform.includes('windows') ? '.zip' : '.tar.gz';
            const fileName = `arduino-cli_${platform}${ext}`;
            const downloadUrl = `https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_${platform}${ext}`;

            output += `  Downloading Arduino CLI for ${platform}...\n`;
            output += `  URL: ${downloadUrl}\n`;

            // Download the archive
            const archivePath = path.join(this.toolsDir, fileName);
            await this.downloadFile(downloadUrl, archivePath);

            output += '  ✓ Download complete. Extracting...\n';

            // Extract the binary
            const extractedPath = await this.extractArchive(archivePath, localPath, platform.includes('windows'));

            if (extractedPath && fs.existsSync(extractedPath)) {
                // Make executable on Unix
                if (process.platform !== 'win32') {
                    try {
                        fs.chmodSync(extractedPath, 0o755);
                    } catch { /* ignore */ }
                }

                // Verify it works
                try {
                    const version = execSync(`"${extractedPath}" version`, { encoding: 'utf8', timeout: 10000 });
                    output += `  ✓ Arduino CLI installed: ${version.trim()}\n`;
                    output += `  Location: ${extractedPath}\n`;
                } catch {
                    output += `  ✓ Arduino CLI installed at: ${extractedPath}\n`;
                }

                this.cachedArduinoCli = extractedPath;

                // Clean up archive
                try { fs.unlinkSync(archivePath); } catch { /* ignore */ }

                return { cliPath: extractedPath, output };
            }

            output += '  ✗ Failed to extract Arduino CLI.\n';
            return { cliPath: undefined, output };

        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            output += `  ✗ Arduino CLI auto-install failed: ${message}\n`;
            return { cliPath: undefined, output };
        } finally {
            this._arduinoCliInstalling = false;
        }
    }

    /**
     * Ensure ESP32 core is installed for the given FQBN.
     */
    async ensureEsp32Core(
        arduinoCli: string,
        fqbn: string,
        currentOutput: string
    ): Promise<{ output: string }> {
        let output = currentOutput;

        try {
            // Check if the core is already installed
            const coreList = execSync(`"${arduinoCli}" core list`, {
                encoding: 'utf8',
                timeout: 15000,
            });

            if (coreList.includes('esp32:esp32') || coreList.includes('esp8266:esp8266')) {
                output += '  ✓ ESP32 board support already installed.\n';
                return { output };
            }
        } catch {
            // core list might fail, try installing anyway
        }

        output += '  ⏳ Installing ESP32 board support (first time, this may take a few minutes)...\n';

        try {
            // Add ESP32 board URL
            const configDir = path.join(os.homedir(), '.airone', 'arduino-cli');
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }

            // Initialize config if needed
            try {
                execSync(`"${arduinoCli}" config init --dest-dir "${configDir}"`, {
                    encoding: 'utf8',
                    timeout: 10000,
                });
            } catch { /* may already exist */ }

            // Add ESP32 board index URL
            const esp32Url = 'https://espressif.github.io/arduino-esp32/package_esp32_index.json';
            try {
                execSync(`"${arduinoCli}" config add board_manager.additional_urls ${esp32Url} --dest-dir "${configDir}"`, {
                    encoding: 'utf8',
                    timeout: 10000,
                });
            } catch { /* may already be added */ }

            // Update index
            output += '  Updating board index...\n';
            try {
                execSync(`"${arduinoCli}" core update-index --config-dir "${configDir}"`, {
                    encoding: 'utf8',
                    timeout: 60000,
                });
            } catch { /* ignore errors from update-index */ }

            // Install ESP32 core
            const coreName = fqbn.split(':').slice(0, 2).join(':'); // e.g. esp32:esp32
            output += `  Installing core: ${coreName}...\n`;
            const installOutput = execSync(
                `"${arduinoCli}" core install ${coreName} --config-dir "${configDir}"`,
                { encoding: 'utf8', timeout: 300_000 } // 5 min timeout
            );
            output += '  ✓ ESP32 board support installed successfully.\n';

            return { output };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            output += `  ⚠ Could not auto-install ESP32 board support: ${message}\n`;
            output += '  You may need to install it manually: arduino-cli core install esp32:esp32\n';
            return { output };
        }
    }

    /**
     * Install required Arduino libraries (e.g. WebSockets, ArduinoJson).
     */
    async installRequiredLibs(
        arduinoCli: string,
        libraries: string[],
        currentOutput: string
    ): Promise<{ output: string }> {
        let output = currentOutput;
        const configDir = path.join(os.homedir(), '.airone', 'arduino-cli');

        for (const lib of libraries) {
            try {
                // Check if already installed
                const listOutput = execSync(`"${arduinoCli}" lib list --config-dir "${configDir}"`, {
                    encoding: 'utf8',
                    timeout: 10000,
                });

                if (listOutput.toLowerCase().includes(lib.toLowerCase())) {
                    output += `  ✓ Library "${lib}" already installed.\n`;
                    continue;
                }
            } catch { /* ignore, try installing */ }

            output += `  ⏳ Installing library: ${lib}...\n`;
            try {
                execSync(`"${arduinoCli}" lib install "${lib}" --config-dir "${configDir}"`, {
                    encoding: 'utf8',
                    timeout: 120_000,
                });
                output += `  ✓ Library "${lib}" installed.\n`;
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                output += `  ⚠ Could not install library "${lib}": ${message}\n`;
            }
        }

        return { output };
    }

    /**
     * Attempt to compile C++ → .bin firmware using Arduino CLI.
     *
     * Uses the config-dir at ~/.airone/arduino-cli for board indexes and libraries.
     */
    async tryArduinoBuild(
        outputDir: string,
        sketchName: string,
        fqbn: string
    ): Promise<CompileResult | undefined> {
        const arduinoCli = this.findArduinoCli();
        if (!arduinoCli) {
            return undefined;
        }
        return this.tryArduinoBuildWithCli(arduinoCli, outputDir, sketchName, fqbn);
    }

    /**
     * Run the actual Arduino CLI build with a known CLI path.
     */
    private async tryArduinoBuildWithCli(
        arduinoCli: string,
        outputDir: string,
        sketchName: string,
        fqbn: string
    ): Promise<CompileResult> {
        const configDir = path.join(os.homedir(), '.airone', 'arduino-cli');

        return new Promise(resolve => {
            const args = [
                'compile',
                '--fqbn', fqbn,
                '--output-dir', outputDir,
            ];

            // Use our config directory if it exists
            if (fs.existsSync(configDir)) {
                args.push('--config-dir', configDir);
            }

            args.push(outputDir);

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
                            error: 'Arduino CLI reported success but no .bin file was found.',
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

            proc.on('error', () => {
                resolve({
                    success: false,
                    output: '',
                    error: 'Failed to start Arduino CLI.',
                });
            });

            // 180 second timeout — first builds can be very slow (compiling ESP32 core)
            setTimeout(() => {
                proc.kill();
                resolve({
                    success: false,
                    output: stdout,
                    error: 'Arduino CLI build timed out after 180 seconds.',
                });
            }, 180_000);
        });
    }

    /**
     * Search for a .bin file in the output directory if the expected name is not found.
     */
    private findBinaryInDir(outputDir: string, sketchName: string): string | undefined {
        try {
            const entries = fs.readdirSync(outputDir);
            const binFiles = entries.filter(e => e.endsWith('.bin'));
            if (binFiles.length === 0) {
                return undefined;
            }
            const preferred = binFiles.find(b => b.includes(sketchName));
            return path.join(outputDir, preferred || binFiles[0]);
        } catch {
            return undefined;
        }
    }

    /**
     * Attempt to compile using the Python-based airo_compiler.
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

    private fsPathFromUri(uri: string): string {
        const parsed = new URL(uri);
        let filePath = decodeURIComponent(parsed.pathname);
        if (process.platform === 'win32' && filePath.match(/^\/[A-Za-z]:/)) {
            filePath = filePath.substring(1);
        }
        return filePath;
    }

    // ─── Arduino CLI Download Helpers ────────────────────────────────────

    /**
     * Determine the Arduino CLI platform identifier for the current OS.
     */
    private getArduinoCliPlatform(): string {
        const platform = process.platform;
        const arch = process.arch;

        if (platform === 'win32') {
            return arch === 'x64' ? 'Windows_64bit' : 'Windows_32bit';
        }
        if (platform === 'darwin') {
            if (arch === 'arm64') return 'macOS_ARM64';
            return 'macOS_64bit';
        }
        // Linux
        if (arch === 'arm64' || arch === 'aarch64') return 'Linux_ARM64';
        if (arch === 'arm') return 'Linux_ARMv7';
        if (arch === 'x64') return 'Linux_64bit';
        return 'Linux_32bit';
    }

    /**
     * Download a file from a URL with redirect support.
     */
    private downloadFile(url: string, destPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const doDownload = (currentUrl: string, redirectCount = 0) => {
                if (redirectCount > 5) {
                    reject(new Error('Too many redirects'));
                    return;
                }

                const parsedUrl = new URL(currentUrl);
                const options: https.RequestOptions = {
                    hostname: parsedUrl.hostname,
                    path: parsedUrl.pathname + parsedUrl.search,
                    method: 'GET',
                    headers: { 'User-Agent': 'Airone-IDE/1.0' },
                };

                const req = https.request(options, (res) => {
                    // Handle redirects
                    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        doDownload(res.headers.location, redirectCount + 1);
                        return;
                    }

                    if (res.statusCode !== 200) {
                        reject(new Error(`Download failed with status ${res.statusCode}`));
                        return;
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
                req.setTimeout(120_000, () => {
                    req.destroy();
                    reject(new Error('Download timed out'));
                });
                req.end();
            };

            doDownload(url);
        });
    }

    /**
     * Extract Arduino CLI binary from a downloaded archive.
     */
    private async extractArchive(archivePath: string, targetBinaryPath: string, isWindows: boolean): Promise<string | undefined> {
        try {
            if (isWindows) {
                // Extract .zip on Windows using PowerShell
                const psCmd = `Expand-Archive -Path "${archivePath}" -DestinationPath "${path.dirname(archivePath)}" -Force`;
                execSync(`powershell -Command "${psCmd}"`, { timeout: 30000 });

                // Find the extracted binary
                const extractDir = path.dirname(archivePath);
                const possiblePaths = [
                    path.join(extractDir, 'arduino-cli.exe'),
                    path.join(extractDir, 'bin', 'arduino-cli.exe'),
                ];

                for (const p of possiblePaths) {
                    if (fs.existsSync(p)) {
                        // Move to target location
                        if (p !== targetBinaryPath) {
                            fs.copyFileSync(p, targetBinaryPath);
                        }
                        return targetBinaryPath;
                    }
                }

                // Search recursively
                return this.findFileRecursive(extractDir, 'arduino-cli.exe', targetBinaryPath);
            } else {
                // Extract .tar.gz on Unix
                const extractDir = path.dirname(archivePath);
                execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`, { timeout: 30000 });

                const possiblePaths = [
                    path.join(extractDir, 'arduino-cli'),
                    path.join(extractDir, 'bin', 'arduino-cli'),
                ];

                for (const p of possiblePaths) {
                    if (fs.existsSync(p)) {
                        if (p !== targetBinaryPath) {
                            fs.copyFileSync(p, targetBinaryPath);
                        }
                        try { fs.chmodSync(targetBinaryPath, 0o755); } catch { /* ignore */ }
                        return targetBinaryPath;
                    }
                }

                // Search recursively
                return this.findFileRecursive(extractDir, 'arduino-cli', targetBinaryPath);
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[AiroCompilerService] Archive extraction failed:', message);
            return undefined;
        }
    }

    /**
     * Search recursively for a file and copy it to target.
     */
    private findFileRecursive(dir: string, fileName: string, targetPath: string): string | undefined {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    const result = this.findFileRecursive(fullPath, fileName, targetPath);
                    if (result) return result;
                } else if (entry.name === fileName) {
                    fs.copyFileSync(fullPath, targetPath);
                    try { fs.chmodSync(targetPath, 0o755); } catch { /* ignore */ }
                    return targetPath;
                }
            }
        } catch { /* ignore */ }
        return undefined;
    }
}
