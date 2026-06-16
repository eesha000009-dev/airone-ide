/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Airone Proprietary License, which is available in the project root.
 *
 * SPDX-License-Identifier: Proprietary
 ********************************************************************************/

import { injectable } from '@theia/core/shared/inversify';
import { exec, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/**
 * Result of a compilation operation.
 */
export interface Esp32CompileResult {
    success: boolean;
    output: string;
    error?: string;
    binaryPath?: string;
    bootloaderPath?: string;
    partitionsPath?: string;
}

/**
 * Result of a flash operation.
 */
export interface Esp32FlashResult {
    success: boolean;
    output: string;
    error?: string;
    portUsed?: string;
}

/**
 * Esp32BuildService — Native, self-contained ESP32 compilation and flashing.
 *
 * This service eliminates ALL external dependencies:
 *   ✗ No Python required
 *   ✗ No PlatformIO required
 *   ✗ No Arduino CLI required
 *   ✗ No pip install required
 *
 * Instead, it uses bundled native binaries:
 *   ✓ xtensa-esp32-elf GCC toolchain (bundled in resources/tools/{platform}/)
 *   ✓ CMake build generator (bundled)
 *   ✓ Ninja build tool (bundled)
 *   ✓ esptool standalone executable (bundled — no Python needed)
 *
 * Pipeline:
 *   1. Copy CMakeLists.txt template to build directory
 *   2. Run `cmake -G Ninja` to configure the build
 *   3. Run `ninja` to compile firmware.elf → firmware.bin
 *   4. (Optional) Run `esptool write_flash` to flash to the board
 */
@injectable()
export class Esp32BuildService {

    /** Build directory name inside the project */
    private static readonly BUILD_DIR = '.airone_build';

    /** Default flash baud rate */
    private static readonly FLASH_BAUD_RATE = 921600;

    /** Default firmware flash offset for ESP32 */
    private static readonly FIRMWARE_OFFSET = '0x10000';

    /** Bootloader flash offset */
    private static readonly BOOTLOADER_OFFSET = '0x1000';

    /** Partitions flash offset */
    private static readonly PARTITIONS_OFFSET = '0x8000';

    /**
     * Resolve the platform-specific tools directory.
     *
     * In a packaged Electron app: process.resourcesPath/tools/{platform}/
     * In dev mode: resources/tools/{platform}/ relative to project root
     */
    private getToolsBasePath(): string {
        // Packaged Electron app
        if (typeof __dirname !== 'undefined' && __dirname.includes('.asar')) {
            return path.join(process.resourcesPath!, 'tools', this.getPlatformDir());
        }
        // Dev mode — look for resources/tools/ in project root
        const devLocations = [
            path.resolve(__dirname, '../../../../../../resources/tools', this.getPlatformDir()),
            path.resolve(process.cwd(), 'resources/tools', this.getPlatformDir()),
        ];
        for (const loc of devLocations) {
            if (fs.existsSync(loc)) return loc;
        }
        return devLocations[devLocations.length - 1];
    }

    /**
     * Get the platform directory name for the current OS.
     */
    private getPlatformDir(): string {
        switch (process.platform) {
            case 'win32': return 'win32';
            case 'darwin': return 'darwin';
            case 'linux': return 'linux';
            default: return 'linux';
        }
    }

    /**
     * Resolve paths to all bundled native binaries.
     */
    private getBinaryPaths() {
        const basePath = this.getToolsBasePath();
        const isWin = process.platform === 'win32';
        const exe = isWin ? '.exe' : '';

        return {
            compiler: path.join(basePath, 'xtensa-esp32-elf'),
            cmake: path.join(basePath, 'cmake', 'bin', `cmake${exe}`),
            ninja: path.join(basePath, `ninja${exe}`),
            esptool: path.join(basePath, `esptool${exe}`),
            framework: this.getFrameworkPath(),
        };
    }

    /**
     * Resolve the Arduino-ESP32 framework directory.
     *
     * This is bundled alongside the tools in resources/framework/
     * or in the vendor/ directory from the PlatformIO cache.
     */
    private getFrameworkPath(): string {
        const candidates: string[] = [];

        // Packaged app — resources/framework/
        if (typeof __dirname !== 'undefined' && __dirname.includes('.asar')) {
            candidates.push(path.join(process.resourcesPath!, 'framework'));
            // Also check vendor/platformio_cache for backward compatibility
            candidates.push(path.join(process.resourcesPath!, 'vendor', 'platformio_cache', 'packages', 'framework-arduinoespressif32'));
        }

        // Dev mode
        candidates.push(path.resolve(__dirname, '../../../../../../resources/framework'));
        candidates.push(path.resolve(process.cwd(), 'resources/framework'));
        candidates.push(path.resolve(process.cwd(), 'vendor/platformio_cache/packages/framework-arduinoespressif32'));

        for (const c of candidates) {
            if (fs.existsSync(path.join(c, 'cores', 'esp32'))) return c;
        }

        return candidates[0];
    }

    /**
     * Check if the native toolchain is available (bundled).
     */
    isToolchainAvailable(): boolean {
        const tools = this.getBinaryPaths();
        try {
            return fs.existsSync(tools.cmake) &&
                   fs.existsSync(tools.ninja) &&
                   fs.existsSync(tools.esptool) &&
                   fs.existsSync(path.join(tools.compiler, 'bin'));
        } catch {
            return false;
        }
    }

    /**
     * Compile a C++ project into firmware.bin using bundled native tools.
     *
     * @param sketchPath Absolute path to the main .cpp file
     * @param projectDir Project directory (where .airone_build/ will be created)
     * @param board      Board name (esp32, esp32s2, esp32s3, esp32c3)
     * @param outputListener Callback for build output lines
     * @returns CompileResult with firmware.bin path on success
     */
    public async compileProject(
        sketchPath: string,
        projectDir: string,
        board: string = 'esp32',
        outputListener?: (data: string) => void
    ): Promise<Esp32CompileResult> {
        const output: string[] = [];
        const log = (msg: string) => {
            output.push(msg);
            outputListener?.(msg);
        };

        // ─── Validate toolchain ──────────────────────────────────────────
        if (!this.isToolchainAvailable()) {
            const tools = this.getBinaryPaths();
            log('✗ Native toolchain not found.');
            log(`  Expected at: ${this.getToolsBasePath()}`);
            log(`  cmake: ${tools.cmake} (${fs.existsSync(tools.cmake) ? 'found' : 'MISSING'})`);
            log(`  ninja: ${tools.ninja} (${fs.existsSync(tools.ninja) ? 'found' : 'MISSING'})`);
            log(`  esptool: ${tools.esptool} (${fs.existsSync(tools.esptool) ? 'found' : 'MISSING'})`);
            log(`  compiler: ${path.join(tools.compiler, 'bin')} (${fs.existsSync(path.join(tools.compiler, 'bin')) ? 'found' : 'MISSING'})`);
            return {
                success: false,
                output: output.join('\n'),
                error: 'Native toolchain is not bundled. Please reinstall Airone IDE.',
            };
        }

        const tools = this.getBinaryPaths();
        const buildDirectory = path.join(projectDir, Esp32BuildService.BUILD_DIR);

        // ─── Prepare build directory ─────────────────────────────────────
        log(`┌─ Native ESP32 Build Pipeline`);
        log(`│ Board: ${board}`);
        log(`│ Sketch: ${sketchPath}`);
        log(`│ Build dir: ${buildDirectory}`);
        log(`│ Compiler: ${tools.compiler}`);
        log(`│ Framework: ${tools.framework}`);

        try {
            if (!fs.existsSync(buildDirectory)) {
                fs.mkdirSync(buildDirectory, { recursive: true });
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            log(`│ ✗ Failed to create build directory: ${msg}`);
            return { success: false, output: output.join('\n'), error: msg };
        }

        // ─── Copy CMakeLists.txt template ────────────────────────────────
        const templatePath = this.getCMakeTemplatePath();
        const cmakeListPath = path.join(buildDirectory, 'CMakeLists.txt');
        try {
            const templateContent = fs.readFileSync(templatePath, 'utf8');
            fs.writeFileSync(cmakeListPath, templateContent, 'utf8');
            log(`│ ✓ CMakeLists.txt copied`);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            log(`│ ✗ Failed to copy CMakeLists.txt: ${msg}`);
            return { success: false, output: output.join('\n'), error: msg };
        }

        // ─── Step 1: CMake Configure ─────────────────────────────────────
        log(`│`);
        log(`│ Step 1: CMake configuration...`);

        const cmakeArgs = [
            '-G', 'Ninja',
            `-DCMAKE_MAKE_PROGRAM=${tools.ninja}`,
            `-DAIRONE_COMPILER_DIR=${tools.compiler}`,
            `-DAIRONE_FRAMEWORK_DIR=${tools.framework}`,
            `-DAIRONE_ESPTOOL=${tools.esptool}`,
            `-DAIRONE_SKETCH=${sketchPath}`,
            `-DAIRONE_BOARD=${board}`,
            '-B', buildDirectory,
            '-S', buildDirectory,
        ];

        const cmakeResult = await this.runProcess(tools.cmake, cmakeArgs, buildDirectory, log);
        if (!cmakeResult.success) {
            log(`│ ✗ CMake configuration failed (exit code ${cmakeResult.code})`);
            return {
                success: false,
                output: output.join('\n'),
                error: `CMake configuration failed: ${cmakeResult.error || 'unknown error'}`,
            };
        }
        log(`│ ✓ CMake configuration succeeded`);

        // ─── Step 2: Ninja Build ──────────────────────────────────────────
        log(`│`);
        log(`│ Step 2: Compiling firmware...`);

        const ninjaArgs = ['-C', buildDirectory];
        const ninjaResult = await this.runProcess(tools.ninja, ninjaArgs, buildDirectory, log);
        if (!ninjaResult.success) {
            log(`│ ✗ Compilation failed (exit code ${ninjaResult.code})`);
            return {
                success: false,
                output: output.join('\n'),
                error: `Compilation failed: ${ninjaResult.error || 'unknown error'}`,
            };
        }

        // ─── Locate output binaries ──────────────────────────────────────
        const firmwareBin = path.join(buildDirectory, 'firmware.bin');
        const bootloaderBin = path.join(buildDirectory, 'bootloader.bin');
        const partitionsBin = path.join(buildDirectory, 'partitions.bin');

        if (!fs.existsSync(firmwareBin)) {
            log(`│ ✗ firmware.bin not found after build`);
            return {
                success: false,
                output: output.join('\n'),
                error: 'Build completed but firmware.bin was not generated.',
            };
        }

        const firmwareSize = fs.statSync(firmwareBin).size;
        log(`│`);
        log(`│ ✓ Build successful!`);
        log(`│   firmware.bin: ${(firmwareSize / 1024).toFixed(1)} KB`);
        if (fs.existsSync(bootloaderBin)) {
            log(`│   bootloader.bin: ${(fs.statSync(bootloaderBin).size / 1024).toFixed(1)} KB`);
        }
        if (fs.existsSync(partitionsBin)) {
            log(`│   partitions.bin: ${(fs.statSync(partitionsBin).size / 1024).toFixed(1)} KB`);
        }
        log(`└${'─'.repeat(60)}`);

        return {
            success: true,
            output: output.join('\n'),
            binaryPath: firmwareBin,
            bootloaderPath: fs.existsSync(bootloaderBin) ? bootloaderBin : undefined,
            partitionsPath: fs.existsSync(partitionsBin) ? partitionsBin : undefined,
        };
    }

    /**
     * Flash firmware to an ESP32 board using the bundled esptool executable.
     *
     * @param port       Serial port (e.g. COM4, /dev/ttyUSB0)
     * @param binaryPath Path to firmware.bin
     * @param bootloaderPath Optional path to bootloader.bin
     * @param partitionsPath Optional path to partitions.bin
     * @param outputListener Callback for flash output
     */
    public async flashDevice(
        port: string,
        binaryPath: string,
        outputListener?: (data: string) => void,
        bootloaderPath?: string,
        partitionsPath?: string
    ): Promise<Esp32FlashResult> {
        const output: string[] = [];
        const log = (msg: string) => {
            output.push(msg);
            outputListener?.(msg);
        };

        const tools = this.getBinaryPaths();

        // Validate esptool exists
        if (!fs.existsSync(tools.esptool)) {
            log(`✗ esptool not found at: ${tools.esptool}`);
            return {
                success: false,
                output: output.join('\n'),
                error: 'Bundled esptool is missing. Please reinstall Airone IDE.',
            };
        }

        // Validate firmware exists
        if (!fs.existsSync(binaryPath)) {
            log(`✗ Firmware not found: ${binaryPath}`);
            return {
                success: false,
                output: output.join('\n'),
                error: `Firmware file not found: ${binaryPath}`,
            };
        }

        log(`┌─ Native ESP32 Flash`);
        log(`│ Port: ${port}`);
        log(`│ Firmware: ${binaryPath}`);
        if (bootloaderPath) log(`│ Bootloader: ${bootloaderPath}`);
        if (partitionsPath) log(`│ Partitions: ${partitionsPath}`);
        log(`│`);

        // Build flash arguments
        // Order: bootloader (0x1000) → partitions (0x8000) → firmware (0x10000)
        const flashArgs: string[] = [
            '--chip', 'esp32',
            '--port', port,
            '--baud', String(Esp32BuildService.FLASH_BAUD_RATE),
            '--before', 'default_reset',
            '--after', 'hard_reset',
            'write_flash', '-z',
        ];

        if (bootloaderPath && fs.existsSync(bootloaderPath)) {
            flashArgs.push(Esp32BuildService.BOOTLOADER_OFFSET, bootloaderPath);
        }
        if (partitionsPath && fs.existsSync(partitionsPath)) {
            flashArgs.push(Esp32BuildService.PARTITIONS_OFFSET, partitionsPath);
        }
        flashArgs.push(Esp32BuildService.FIRMWARE_OFFSET, binaryPath);

        log(`│ Flashing...`);

        const result = await this.runProcess(tools.esptool, flashArgs, undefined, log);

        if (result.success) {
            log(`│`);
            log(`│ ✓ Flash complete! Your hardware is running.`);
            log(`└${'─'.repeat(60)}`);
            return {
                success: true,
                output: output.join('\n'),
                portUsed: port,
            };
        } else {
            log(`│`);
            log(`│ ✗ Flashing failed (exit code ${result.code})`);
            log(`└${'─'.repeat(60)}`);

            // Classify the error for user-friendly messages
            let errorMsg = result.error || `esptool exited with code ${result.code}`;
            const lowerError = errorMsg.toLowerCase();

            if (lowerError.includes('failed to connect') || lowerError.includes('no serial data')) {
                errorMsg = 'Could not connect to the ESP32 board. Please ensure:\n' +
                    '  • The board is connected via USB\n' +
                    '  • The correct port is selected\n' +
                    '  • Try pressing and holding the BOOT button while connecting\n' +
                    '  • No other program is using the serial port';
            } else if (lowerError.includes('permission') || lowerError.includes('access denied') || lowerError.includes('could not open port')) {
                errorMsg = 'Serial port access denied. You may need to:\n' +
                    '  • Add your user to the dialout group (Linux): sudo usermod -aG dialout $USER\n' +
                    '  • Close other programs using the port\n' +
                    '  • Run the IDE as administrator (Windows)';
            }

            return {
                success: false,
                output: output.join('\n'),
                error: errorMsg,
                portUsed: port,
            };
        }
    }

    /**
     * Resolve the CMakeLists.txt template path.
     */
    private getCMakeTemplatePath(): string {
        // Packaged app
        if (typeof __dirname !== 'undefined' && __dirname.includes('.asar')) {
            return path.join(process.resourcesPath!, 'templates', 'CMakeLists.txt');
        }
        // Dev mode
        const devLocations = [
            path.resolve(__dirname, '../../../../../../resources/templates/CMakeLists.txt'),
            path.resolve(process.cwd(), 'resources/templates/CMakeLists.txt'),
        ];
        for (const loc of devLocations) {
            if (fs.existsSync(loc)) return loc;
        }
        return devLocations[0];
    }

    /**
     * Run a process and capture its output.
     */
    private runProcess(
        command: string,
        args: string[],
        cwd: string | undefined,
        log: (msg: string) => void
    ): Promise<{ success: boolean; code: number | null; error?: string }> {
        return new Promise(resolve => {
            const proc = spawn(command, args, {
                cwd,
                stdio: 'pipe',
                env: { ...process.env },
            });

            let stderr = '';

            proc.stdout?.on('data', (data: Buffer) => {
                const text = data.toString();
                for (const line of text.split('\n')) {
                    if (line.trim()) log(`│   ${line}`);
                }
            });

            proc.stderr?.on('data', (data: Buffer) => {
                const text = data.toString();
                stderr += text;
                for (const line of text.split('\n')) {
                    if (line.trim()) log(`│   ${line}`);
                }
            });

            proc.on('close', (code: number | null) => {
                resolve({
                    success: code === 0,
                    code,
                    error: code !== 0 ? stderr.trim() : undefined,
                });
            });

            proc.on('error', (err: Error) => {
                resolve({
                    success: false,
                    code: -1,
                    error: `Failed to start ${path.basename(command)}: ${err.message}`,
                });
            });

            // 10-minute timeout for builds
            setTimeout(() => {
                proc.kill();
                resolve({
                    success: false,
                    code: -1,
                    error: 'Process timed out after 600 seconds.',
                });
            }, 600_000);
        });
    }
}
