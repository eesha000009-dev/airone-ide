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
import { CompileRequest, CompileResult, TARGET_TO_PIO_BOARD, PIO_BOARD_TO_CHIP, CHIP_TO_PIO_PLATFORM, DEFAULT_FLASH_BAUD_RATE, DEFAULT_MONITOR_BAUD_RATE } from '../common/airo-protocol';
import { AiroBuiltInCompiler } from './airo-built-in-compiler';
import { AiroTranspiler } from './airo-transpiler';
import { Esp32BuildService } from './esp32-build-service';

// ─── Configurable Constants ──────────────────────────────────────────────────

/** Default PlatformIO board identifier for ESP32 */
const DEFAULT_PIO_BOARD = TARGET_TO_PIO_BOARD['esp32'];

/** Default ESP32 chip family for flash operations */
const DEFAULT_CHIP_FAMILY = PIO_BOARD_TO_CHIP[DEFAULT_PIO_BOARD];

/** PlatformIO build directory relative to project */
const PIO_BUILD_DIR = '.pio';

/**
 * Find a working Python executable on the system.
 *
 * On Windows, this tries: py, python, python3, and common install paths.
 * On Unix, this tries: python3, python.
 * Returns the command that successfully runs, or 'python' as fallback.
 */
/** Minimum Python version required by PlatformIO */
const MIN_PYTHON_MAJOR = 3;
const MIN_PYTHON_MINOR = 8;

/** Diagnostic info collected during PlatformIO detection */
let pioDetectionDiagnostics: string[] = [];

/**
 * Build a shell-safe command string for execSync.
 *
 * - For file paths that contain spaces, wraps in double quotes
 * - For multi-word commands (like 'py -3'), uses as-is (the shell will parse them correctly)
 * - For simple commands, uses as-is
 *
 * CRITICAL: Never wrap multi-word commands like 'py -3' in quotes —
 * that makes Windows cmd try to execute a program literally named "py -3"
 * instead of 'py' with argument '-3'.
 */
function shellEscape(cmd: string): string {
    // If it looks like a file path (contains path separators) and has spaces, quote it
    if ((cmd.includes('\\') || cmd.includes('/')) && cmd.includes(' ')) {
        return `"${cmd}"`;
    }
    return cmd;
}

/**
 * Find a working Python 3.8+ executable on the system.
 *
 * On Windows, this tries: py -3, python, python3, py, and common install paths.
 * On Unix, this tries: python3, python.
 * Returns the command that successfully runs Python 3.8+, or 'python3' as fallback.
 *
 * IMPORTANT: PlatformIO requires Python 3.8+. The `py` launcher on Windows
 * may default to Python 2.7 if it's installed, so we check the version.
 */
function findWorkingPython(): string {
    // On Windows, try `py -3` FIRST — it's the most reliable way to get Python 3
    // via the launcher. Plain `py` might default to Python 2.7.
    const candidates = process.platform === 'win32'
        ? ['py -3', 'python', 'python3', 'py']
        : ['python3', 'python'];

    // Also check common Windows install paths
    if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA;
        const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
        const userHome = os.homedir();

        // Python from Microsoft Store or python.org
        const windowsPaths = [
            path.join(userHome, 'AppData', 'Local', 'Microsoft', 'WindowsApps', 'python3.exe'),
            path.join(userHome, 'AppData', 'Local', 'Microsoft', 'WindowsApps', 'python.exe'),
            path.join(userHome, 'AppData', 'Local', 'Programs', 'Python', 'Python313', 'python.exe'),
            path.join(userHome, 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe'),
            path.join(userHome, 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'python.exe'),
            path.join(userHome, 'AppData', 'Local', 'Programs', 'Python', 'Python310', 'python.exe'),
            path.join(programFiles, 'Python313', 'python.exe'),
            path.join(programFiles, 'Python312', 'python.exe'),
            path.join(programFiles, 'Python311', 'python.exe'),
        ];

        // Also check LOCALAPPDATA if available (more reliable than hardcoding)
        if (localAppData) {
            windowsPaths.unshift(
                path.join(localAppData, 'Programs', 'Python', 'Python313', 'python.exe'),
                path.join(localAppData, 'Programs', 'Python', 'Python312', 'python.exe'),
                path.join(localAppData, 'Programs', 'Python', 'Python311', 'python.exe'),
                path.join(localAppData, 'Programs', 'Python', 'Python310', 'python.exe'),
            );
        }

        for (const p of windowsPaths) {
            if (fs.existsSync(p)) {
                candidates.push(p); // Don't quote here — shellEscape() handles quoting at point of use
            }
        }
    }

    for (const cmd of candidates) {
        try {
            // Use shellEscape for file paths with spaces; multi-word commands like
            // 'py -3' must NOT be quoted or Windows treats "py -3" as a single program name
            const shellCmd = shellEscape(cmd);
            const versionOutput = execSync(`${shellCmd} --version`, { stdio: 'pipe', timeout: 8000, encoding: 'utf8' }).trim();
            // Verify it's Python 3.8+
            const match = versionOutput.match(/Python (\d+)\.(\d+)/);
            if (match) {
                const major = parseInt(match[1], 10);
                const minor = parseInt(match[2], 10);
                if (major > MIN_PYTHON_MAJOR || (major === MIN_PYTHON_MAJOR && minor >= MIN_PYTHON_MINOR)) {
                    // IMPORTANT: Resolve multi-word commands (like 'py -3') to the actual
                    // python.exe path. If we return 'py -3', then any code that wraps it in
                    // quotes like `"${pythonPath}"` produces `"py -3"` which Windows cmd
                    // interprets as trying to run a program literally named "py -3".
                    try {
                        const executable = execSync(`${shellCmd} -c "import sys; print(sys.executable)"`, {
                            stdio: 'pipe', timeout: 8000, encoding: 'utf8'
                        }).trim();
                        if (executable && fs.existsSync(executable)) {
                            return executable; // e.g., C:\Users\Hp\...\python.exe
                        }
                    } catch {
                        // sys.executable resolution failed — fall through to return cmd
                    }
                    return cmd;
                }
                // Python found but too old — skip
            }
            // If we can't parse the version, try it anyway
            return cmd;
        } catch {
            // this candidate doesn't work
        }
    }

    // Fallback
    return process.platform === 'win32' ? 'python' : 'python3';
}

/** Get the Python version string for the current pythonPath */
function getPythonVersion(pythonPath: string): string {
    try {
        return execSync(`${shellEscape(pythonPath)} --version`, { stdio: 'pipe', timeout: 8000, encoding: 'utf8' }).trim();
    } catch {
        return 'unknown';
    }
}

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

/** Resolve the directory containing bundled PlatformIO Core Python packages */
function resolvePlatformioPackagesDir(): string {
    const vendorDir = resolveVendorDir();
    return path.join(vendorDir, 'platformio_packages');
}

/** Check if PlatformIO Core Python packages are bundled in vendor/ */
function isPlatformioBundled(): boolean {
    const packagesDir = resolvePlatformioPackagesDir();
    return fs.existsSync(path.join(packagesDir, 'platformio', '__init__.py'));
}

/** Resolve the PlatformIO Core directory (bundled or user-installed) */
function resolvePlatformioCoreDir(): string {
    const vendorDir = resolveVendorDir();
    const bundledCore = path.join(vendorDir, 'platformio_cache');
    if (fs.existsSync(bundledCore)) return bundledCore;

    // Fallback: user's default PlatformIO Core dir
    return path.join(os.homedir(), '.platformio');
}

/** Resolve the directory containing bundled Arduino libraries */
function resolveBundledLibsDir(): string {
    const vendorDir = resolveVendorDir();
    return path.join(vendorDir, 'platformio_cache', 'lib');
}

/** Check if bundled Arduino libraries are available */
function hasBundledLibs(): boolean {
    const libsDir = resolveBundledLibsDir();
    return fs.existsSync(libsDir) && fs.readdirSync(libsDir).some(f => f !== '.gitkeep');
}

/** Check if the ESP32 toolchain (compiler, framework, build tools) is bundled */
function hasBundledToolchain(): boolean {
    const coreDir = path.join(resolveVendorDir(), 'platformio_cache');
    const packagesDir = path.join(coreDir, 'packages');
    const platformsDir = path.join(coreDir, 'platforms');
    if (!fs.existsSync(packagesDir)) return false;
    const packages = fs.readdirSync(packagesDir);
    // Check for at least one toolchain package (e.g. toolchain-xtensa-esp32)
    const hasToolchain = packages.some(d => d.startsWith('toolchain-'));
    // Check for tool-scons (the build tool — CRITICAL, PlatformIO cannot build without it)
    const hasScons = packages.some(d => d === 'tool-scons');
    // Check for at least the espressif32 platform
    const hasPlatform = fs.existsSync(platformsDir) &&
        fs.readdirSync(platformsDir).some(d => d.startsWith('espressif'));
    return hasToolchain && hasScons && hasPlatform;
}

// Chip→board and board→chip mappings imported from airo-protocol.ts

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

    @inject(Esp32BuildService)
    protected readonly esp32BuildService!: Esp32BuildService;

    private pythonPath: string;
    private compilerDir: string;
    private cachedPioPath: string | undefined;

    /** Whether PlatformIO should be invoked as `python -m platformio` (vs direct `pio` command) */
    private pioUsePythonModule: boolean = true;

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

        // Find a working Python on the system (tries py, python, python3, common paths)
        return findWorkingPython();
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
                output: `✗ Step 1 — Syntax check failed.\n${builtInResult.output}`,
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
            let combinedOutput = `✓ Step 1 — ${builtInResult.output}\n` +
                `✓ Step 2 — Transpiled to C++: ${cppPath}\n` +
                `  Board: ${pioBoard}\n` +
                `  Required libraries: ${transpileResult.requiredLibraries.join(', ') || 'none'}\n` +
                (transpileResult.errors.length > 0 ? `  Warnings: ${transpileResult.errors.join('; ')}\n` : '');

            // ─── Step 3: Native ESP32 Build (CMake + Ninja + xtensa-gcc) ──
            // Uses bundled native toolchain — NO Python, NO PlatformIO needed.
            combinedOutput += '  Build mode: Native (CMake + Ninja + xtensa-gcc)\n';

            const buildResult = await this.esp32BuildService.compileProject(
                cppPath,
                outputDir,
                request.target || 'esp32',
                (line) => { /* output listener — captured in buildResult.output */ }
            );

            if (buildResult.success) {
                combinedOutput += '\n✓ Step 3 — Native build succeeded.\n' + buildResult.output;
                if (buildResult.binaryPath) generatedFiles.push(buildResult.binaryPath);
                if (buildResult.bootloaderPath) generatedFiles.push(buildResult.bootloaderPath);
                if (buildResult.partitionsPath) generatedFiles.push(buildResult.partitionsPath);
                return {
                    success: true,
                    output: combinedOutput,
                    generatedFiles,
                    binaryPath: buildResult.binaryPath,
                };
            }

            // Native build failed — show full output for diagnostics
            combinedOutput +=
                '\n✗ Step 3 — Native build failed:\n' +
                `  ${buildResult.error}\n`;
            if (buildResult.output && buildResult.output !== buildResult.error) {
                combinedOutput += '\n  Build output:\n';
                for (const line of buildResult.output.split('\n')) {
                    combinedOutput += `    ${line}\n`;
                }
            }

            return {
                success: true, // C++ was generated even if build failed
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

    // ─── PlatformIO Detection ───────────────────────────────────────────

    /**
     * Find PlatformIO CLI — checks multiple locations (bundled first, no auto-install):
     *  1. Bundled PlatformIO Core packages (PRIMARY — no pip install needed)
     *  2. Python module (python -m platformio) — in case user has it installed
     *  3. System PATH (pio command)
     *  4. Python Scripts directory (pip installs pio.exe here on Windows)
     *  5. PlatformIO's own isolated env (penv) in user's .platformio directory
     */
    findPlatformIO(): string | undefined {
        if (this.cachedPioPath !== undefined) {
            return this.cachedPioPath;
        }

        // Reset diagnostics for this detection attempt
        pioDetectionDiagnostics = [];
        pioDetectionDiagnostics.push(`Python: ${this.pythonPath} (${getPythonVersion(this.pythonPath)})`);
        pioDetectionDiagnostics.push(`Bundled packages: ${resolvePlatformioPackagesDir()} (exists: ${isPlatformioBundled()})`);
        pioDetectionDiagnostics.push(`Vendor dir: ${resolveVendorDir()} (exists: ${fs.existsSync(resolveVendorDir())})`);

        // 1. Bundled PlatformIO Core packages (PRIMARY — no pip install needed)
        if (isPlatformioBundled()) {
            const packagesDir = resolvePlatformioPackagesDir();
            try {
                const testEnv: NodeJS.ProcessEnv = { ...process.env };
                const existingPythonPath = testEnv.PYTHONPATH || '';
                testEnv.PYTHONPATH = existingPythonPath
                    ? `${packagesDir}${path.delimiter}${existingPythonPath}`
                    : packagesDir;

                pioDetectionDiagnostics.push(`Test 1 (bundled): PYTHONPATH="${testEnv.PYTHONPATH}"`);

                const result = execSync(`${shellEscape(this.pythonPath)} -m platformio --version`, {
                    stdio: 'pipe',
                    encoding: 'utf8',
                    timeout: 10000,
                    env: testEnv,
                }).trim();
                pioDetectionDiagnostics.push(`Test 1 (bundled): SUCCESS — ${result}`);
                this.pioUsePythonModule = true;
                this.cachedPioPath = `${this.pythonPath} -m platformio`;
                return this.cachedPioPath;
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                // Extract the useful part of the error
                let errorDetail = msg;
                if (err instanceof Error && 'stderr' in err) {
                    const stderr = (err as Error & { stderr?: string | Buffer }).stderr;
                    if (stderr) {
                        errorDetail = typeof stderr === 'string' ? stderr : stderr.toString('utf8');
                    }
                }
                pioDetectionDiagnostics.push(`Test 1 (bundled): FAILED — ${errorDetail.substring(0, 300)}`);

                // Also try to import platformio directly to get a better error message
                try {
                    const importTest = execSync(`${shellEscape(this.pythonPath)} -c "import sys; sys.path.insert(0, '${packagesDir.replace(/'/g, "\\'")}'); import platformio; print(platformio.__version__)"`, {
                        stdio: 'pipe',
                        encoding: 'utf8',
                        timeout: 10000,
                        env: { ...process.env, PYTHONPATH: packagesDir },
                    }).trim();
                    pioDetectionDiagnostics.push(`Test 1 (direct import): import works — ${importTest}`);
                } catch (importErr: unknown) {
                    const importMsg = importErr instanceof Error ? importErr.message : String(importErr);
                    pioDetectionDiagnostics.push(`Test 1 (direct import): FAILED — ${importMsg.substring(0, 300)}`);
                }
            }
        } else {
            pioDetectionDiagnostics.push('Test 1 (bundled): SKIPPED — platformio/__init__.py not found');
            // Check what IS in the packages dir
            const packagesDir = resolvePlatformioPackagesDir();
            if (fs.existsSync(packagesDir)) {
                try {
                    const contents = fs.readdirSync(packagesDir);
                    pioDetectionDiagnostics.push(`  packages dir contents: [${contents.slice(0, 10).join(', ')}]`);
                } catch { /* ignore */ }
            }
        }

        // 2. Python module — in case user has PlatformIO installed via pip
        try {
            const result = execSync(`${shellEscape(this.pythonPath)} -m platformio --version`, {
                stdio: 'pipe',
                encoding: 'utf8',
                timeout: 10000,
            }).trim();
            pioDetectionDiagnostics.push(`Test 2 (pip module): SUCCESS — ${result}`);
            this.pioUsePythonModule = true;
            this.cachedPioPath = `${this.pythonPath} -m platformio`;
            return this.cachedPioPath;
        } catch {
            pioDetectionDiagnostics.push('Test 2 (pip module): FAILED — platformio not installed as Python module');
        }

        // 3. System PATH
        try {
            const isWin = process.platform === 'win32';
            const checkCmd = isWin ? 'where' : 'which';
            execSync(`${checkCmd} pio`, { stdio: 'ignore', timeout: 5000 });
            pioDetectionDiagnostics.push('Test 3 (system PATH): SUCCESS — pio found');
            this.pioUsePythonModule = false;
            this.cachedPioPath = 'pio';
            return this.cachedPioPath;
        } catch {
            pioDetectionDiagnostics.push('Test 3 (system PATH): FAILED — pio not in PATH');
        }

        // 4. Python Scripts directory — pip installs pio.exe/python.exe here
        //    On Windows: C:\Users\<user>\AppData\Local\Programs\Python\Python3x\Scripts\pio.exe
        //    On Unix: ~/.local/bin/pio
        const pythonScriptsPio = this.findPioInPythonScripts();
        if (pythonScriptsPio) {
            pioDetectionDiagnostics.push(`Test 4 (Python Scripts): SUCCESS — ${pythonScriptsPio}`);
            this.pioUsePythonModule = false;
            this.cachedPioPath = pythonScriptsPio;
            return this.cachedPioPath;
        } else {
            pioDetectionDiagnostics.push('Test 4 (Python Scripts): FAILED — pio not in Python Scripts directory');
        }

        // 5. PlatformIO's own isolated virtualenv (penv) in ~/.platformio
        const pioCoreDir = resolvePlatformioCoreDir();
        const penvPio = process.platform === 'win32'
            ? path.join(pioCoreDir, 'penv', 'Scripts', 'pio.exe')
            : path.join(pioCoreDir, 'penv', 'bin', 'pio');
        if (fs.existsSync(penvPio)) {
            pioDetectionDiagnostics.push(`Test 5 (penv): SUCCESS — ${penvPio}`);
            this.pioUsePythonModule = false;
            this.cachedPioPath = penvPio;
            return this.cachedPioPath;
        } else {
            pioDetectionDiagnostics.push('Test 5 (penv): FAILED — penv not found');
        }

        this.cachedPioPath = undefined;
        return undefined;
    }

    /** Get the PlatformIO detection diagnostics from the last findPlatformIO() call */
    getDetectionDiagnostics(): string[] {
        return pioDetectionDiagnostics;
    }

    /**
     * Find pio executable in Python's Scripts directory.
     * On Windows, pip installs executables to the same directory as python.exe\..\Scripts\
     * On Unix, they go to ~/.local/bin/
     */
    private findPioInPythonScripts(): string | undefined {
        try {
            // Get the directory containing the Python executable
            const pythonDirOutput = execSync(`${shellEscape(this.pythonPath)} -c "import sys, os; print(os.path.dirname(sys.executable))"`, {
                stdio: 'pipe',
                encoding: 'utf8',
                timeout: 10000,
            }).trim();

            if (!pythonDirOutput) return undefined;

            if (process.platform === 'win32') {
                // Windows: Scripts subdirectory of Python's directory
                const scriptsDir = path.join(pythonDirOutput, 'Scripts');
                const pioExe = path.join(scriptsDir, 'pio.exe');
                if (fs.existsSync(pioExe)) return pioExe;
                // Also check platformio.exe (some installations)
                const platformioExe = path.join(scriptsDir, 'platformio.exe');
                if (fs.existsSync(platformioExe)) return platformioExe;
            } else {
                // Unix: ~/.local/bin/pio
                const localBin = path.join(os.homedir(), '.local', 'bin', 'pio');
                if (fs.existsSync(localBin)) return localBin;
                // Also check Python's own bin directory
                const binPio = path.join(pythonDirOutput, 'pio');
                if (fs.existsSync(binPio)) return binPio;
            }
        } catch {
            // Could not determine Python directory
        }
        return undefined;
    }

    /**
     * Build environment variables for running PlatformIO with bundled packages.
     *
     * Strategy:
     * - When BOTH toolchain AND libraries are bundled → FORCE_OFFLINE=true.
     *   PlatformIO finds everything locally via PLATFORMIO_CORE_DIR and
     *   lib_extra_dirs (no network needed). lib_deps is NOT included in
     *   platformio.ini, so PlatformIO won't try registry lookups at all.
     *
     * - When only toolchain is bundled (no bundled libs) → no FORCE_OFFLINE.
     *   PlatformIO may need to download libraries from the registry, so
     *   we allow HTTP requests. lib_deps is included in platformio.ini.
     *
     * - When nothing is bundled → same as toolchain-only (allow HTTP).
     *
     * CRITICAL: The toolchain's bin/ directory MUST be added to PATH so that
     * Windows can find the DLLs (libwinpthread-1.dll, libgcc_s_seh-1.dll, etc.)
     * that xtensa-esp32-elf-g++.exe depends on. Without these DLLs in PATH,
     * CreateProcess fails with "No such file or directory".
     */
    private buildPlatformioEnv(): NodeJS.ProcessEnv {
        const env: NodeJS.ProcessEnv = { ...process.env };

        // If bundled PlatformIO Core packages exist, set PYTHONPATH
        if (isPlatformioBundled()) {
            const packagesDir = resolvePlatformioPackagesDir();
            const existingPythonPath = env.PYTHONPATH || '';
            env.PYTHONPATH = existingPythonPath
                ? `${packagesDir}${path.delimiter}${existingPythonPath}`
                : packagesDir;
        }

        // Set PLATFORMIO_CORE_DIR to the bundled toolchain cache
        const coreDir = resolvePlatformioCoreDir();
        env.PLATFORMIO_CORE_DIR = coreDir;

        // CRITICAL: Add package bin/ directories to PATH.
        // On Windows, xtensa-esp32-elf-g++.exe depends on DLLs in the same
        // bin/ directory (libwinpthread-1.dll, libgcc_s_seh-1.dll, etc.).
        // Without these DLLs in PATH, CreateProcess fails with:
        //   xtensa-esp32-elf-g++: error: CreateProcess: No such file or directory
        //
        // We add bin/ dirs for ALL packages that have them (not just toolchain-*)
        // because tools like tool-esptoolpy also have executables that need PATH access.
        const pkgDir = path.join(coreDir, 'packages');
        if (fs.existsSync(pkgDir)) {
            try {
                const pathAdditions: string[] = [];
                for (const pkgName of fs.readdirSync(pkgDir)) {
                    const binDir = path.join(pkgDir, pkgName, 'bin');
                    if (fs.existsSync(binDir)) {
                        pathAdditions.push(binDir);
                    }
                }
                if (pathAdditions.length > 0) {
                    const existingPath = env.PATH || '';
                    env.PATH = pathAdditions.join(path.delimiter) +
                        (existingPath ? `${path.delimiter}${existingPath}` : '');
                }
            } catch { /* ignore — PATH injection is best-effort */ }
        }

        // Disable ALL update checks — prevents unnecessary HTTP requests
        env.PLATFORMIO_SETTING_CHECK_PLATFORMIO_INTERVAL = '0';
        env.PLATFORMIO_SETTING_CHECK_PLATFORMIO_UPDATE = 'no';
        env.PLATFORMIO_SETTING_CHECK_LIBRARIES_INTERVAL = '0';
        env.PLATFORMIO_SETTING_CHECK_PRUNE_SYSTEM_INTERVAL = '0';

        // Disable telemetry
        env.PLATFORMIO_SETTING_ENABLE_TELEMETRY = 'no';

        // When BOTH toolchain AND libraries are bundled, force fully offline mode.
        // This is safe because: lib_deps is NOT included in platformio.ini when
        // libraries are bundled, so PlatformIO won't attempt any registry lookups.
        // It finds everything it needs locally via PLATFORMIO_CORE_DIR + lib_extra_dirs.
        const toolchainBundled = hasBundledToolchain();
        const libsBundled = hasBundledLibs();
        if (toolchainBundled && libsBundled) {
            env.PLATFORMIO_SETTING_FORCE_OFFLINE = 'yes';
        }

        return env;
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

        // Derive platform name from board (ESP32 vs ESP8266)
        const chipFamily = PIO_BOARD_TO_CHIP[board] || DEFAULT_CHIP_FAMILY;
        const platform = CHIP_TO_PIO_PLATFORM[chipFamily] || 'espressif32';

        lines.push('; PlatformIO Project Configuration File');
        lines.push('; Generated by Airone IDE');
        lines.push('');
        lines.push('[env:' + board + ']');

        // Board and platform (dynamic: espressif32 for ESP32, espressif8266 for ESP8266)
        lines.push(`platform = ${platform}`);
        lines.push(`board = ${board}`);
        lines.push(`framework = arduino`);

        // Serial monitor speed
        lines.push(`monitor_speed = ${DEFAULT_MONITOR_BAUD_RATE}`);
        lines.push(`monitor_filters = direct`);

        // Build flags for proper Arduino compatibility
        // CORE_DEBUG_LEVEL=0 disables Arduino HAL logging — this is CRITICAL
        // for esp32-camera library which uses ESP_LOGE(TAG, ...) but doesn't
        // always define TAG when the Arduino logging path is active. With
        // debug level 0, the log_e/log_w/log_i macros become no-ops so TAG
        // is never evaluated, preventing "undeclared TAG" compile errors.
        // NOTE: We do NOT define -DARDUINO — the Arduino framework sets it
        // automatically, and redefining it causes "ARDUINO redefined" warnings.
        lines.push(`build_flags =`);
        lines.push(`    -DBOARD_HAS_WIFI`);
        lines.push(`    -DCORE_DEBUG_LEVEL=0`);
        lines.push(`    -DCONFIG_ARDUHAL_LOG_DEFAULT_LEVEL=0`);

        // Upload speed for faster flashing
        lines.push(`upload_speed = ${DEFAULT_FLASH_BAUD_RATE}`);

        // If bundled libraries exist, add lib_extra_dirs so PlatformIO finds them
        // locally without any network requests. When libraries are bundled, we
        // deliberately skip lib_deps to prevent PlatformIO from making registry
        // lookups (which cause HTTPClientError in offline environments).
        // PlatformIO will discover all bundled libraries via lib_extra_dirs + LDF.
        if (hasBundledLibs()) {
            const libsDir = resolveBundledLibsDir();
            lines.push('');
            lines.push(`lib_extra_dirs = ${libsDir}`);
            // Use deep LDF mode so PlatformIO scans #include directives
            // and finds all transitive dependencies from lib_extra_dirs
            lines.push('lib_ldf_mode = deep+');
            // Disable library compatibility mode — some bundled libraries
            // (e.g. esp32-camera) report themselves as framework-incompatible
            // even though they work fine on ESP32 Arduino. Setting this to
            // "off" skips the compatibility check and includes all libraries.
            lines.push('lib_compat_mode = off');
            // Do NOT include lib_deps — libraries are already available locally
            // via lib_extra_dirs. Including lib_deps would trigger registry
            // lookups, causing HTTPClientError when offline.
        } else if (libraries.length > 0) {
            // Libraries NOT bundled — include lib_deps so PlatformIO downloads
            // them from the registry (requires internet)
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
            // Build environment variables for bundled PlatformIO packages + offline mode
            const env = this.buildPlatformioEnv();

            // Determine how to invoke PlatformIO based on detection mode
            // Using the pioUsePythonModule flag is safer than string parsing —
            // it correctly handles python paths with spaces (e.g., "C:\Program Files\Python312\python.exe")
            let command: string;
            let args: string[];

            if (this.pioUsePythonModule) {
                // PlatformIO is available as a Python module: python -m platformio run ...
                command = this.pythonPath;
                args = ['-m', 'platformio', 'run', '-v', '-d', projectDir, '-e', board];
            } else {
                // PlatformIO is available as a direct command: pio run ...
                command = pioCmd;
                args = ['run', '-v', '-d', projectDir, '-e', board];
            }

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
                    // Build failed — include full output for debugging
                    // PlatformIO puts most useful info on stdout, errors on stderr
                    const fullOutput = (stdout + '\n' + stderr).trim();
                    // Extract the most relevant error line for the summary
                    const errorSummary = stderr.trim() || `PlatformIO exited with code ${code}`;
                    resolve({
                        success: false,
                        output: fullOutput || errorSummary,
                        error: errorSummary,
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
