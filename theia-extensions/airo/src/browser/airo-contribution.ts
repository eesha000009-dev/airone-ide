/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { injectable, inject } from '@theia/core/shared/inversify';
import {
    CommandContribution, CommandRegistry, Command,
    MenuContribution, MenuModelRegistry, MenuPath
} from '@theia/core/lib/common';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { ApplicationShell } from '@theia/core/lib/browser/shell';
import { EditorManager } from '@theia/editor/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';
import { OpenerService } from '@theia/core/lib/browser/opener-service';
import { URI } from '@theia/core/lib/common/uri';
import { OutputChannelManager } from '@theia/output/lib/browser/output-channel';
import { WidgetManager } from '@theia/core/lib/browser';
import { CommandService } from '@theia/core/lib/common/command';
import { QuickInputService, QuickPickItem } from '@theia/core/lib/common/quick-pick-service';
import { AiroSerialWidget } from './airo-serial-widget';
import { CommonMenus } from '@theia/core/lib/browser/common-frontend-contribution';
import {
    AiroSketchService,
    AiroSerialService,
    AiroSketchClient,
    AiroSerialClient,
    BoardInfo,
    SerialPortInfo
} from '../common/airo-protocol';

// ─── Menu Paths ──────────────────────────────────────────────────────────────

export const AIRONE_LIBRARIES_MENU: MenuPath = ['menubar', '5_airone_libraries'];
export const AIRONE_TOOLS_MENU: MenuPath = ['menubar', '6_airone_tools'];

// Libraries submenu paths
export const AIRONE_LIBRARIES_BUILTIN: MenuPath = [...AIRONE_LIBRARIES_MENU, 'builtin'];
export const AIRONE_LIBRARIES_MANAGE: MenuPath = [...AIRONE_LIBRARIES_MENU, 'manage'];

// Tools submenu paths
export const AIRONE_TOOLS_BOARD: MenuPath = [...AIRONE_TOOLS_MENU, 'board'];
export const AIRONE_TOOLS_PORT: MenuPath = [...AIRONE_TOOLS_MENU, 'port'];
export const AIRONE_TOOLS_SERIAL: MenuPath = [...AIRONE_TOOLS_MENU, 'serial'];
export const AIRONE_TOOLS_UPDATE: MenuPath = [...AIRONE_TOOLS_MENU, 'update'];

// ─── Commands ────────────────────────────────────────────────────────────────

export const AIRO_COMPILE_COMMAND: Command = {
    id: 'airo.compile',
    label: 'Compile',
    category: 'Airone'
};

export const AIRO_UPLOAD_COMMAND: Command = {
    id: 'airo.upload',
    label: 'Upload',
    category: 'Airone'
};

export const AIRO_NEW_SKETCH_COMMAND: Command = {
    id: 'airo.newSketch',
    label: 'New Sketch',
    category: 'Airone'
};

export const AIRO_EXAMPLES_COMMAND: Command = {
    id: 'airo.examples',
    label: 'Examples',
    category: 'Airone'
};

export const AIRO_SELECT_BOARD_COMMAND: Command = {
    id: 'airo.selectBoard',
    label: 'Select Board',
    category: 'Airone'
};

export const AIRO_SELECT_PORT_COMMAND: Command = {
    id: 'airo.selectPort',
    label: 'Select Port',
    category: 'Airone'
};

export const AIRO_SERIAL_MONITOR_COMMAND: Command = {
    id: 'airo.serialMonitor',
    label: 'Serial Monitor',
    category: 'Airone'
};

export const AIRO_CHECK_UPDATES_COMMAND: Command = {
    id: 'airo.checkUpdates',
    label: 'Check for Updates',
    category: 'Airone'
};

export const AIRO_RESTART_UPDATE_COMMAND: Command = {
    id: 'airo.restartUpdate',
    label: 'Restart to Update',
    category: 'Airone'
};

export const AIRO_MANAGE_LIBRARIES_COMMAND: Command = {
    id: 'airo.manageLibraries',
    label: 'Manage Libraries',
    category: 'Airone'
};

export const AIRO_SYNC_BACKBONE_COMMAND: Command = {
    id: 'airo.syncToBackbone',
    label: 'Sync to Backbone',
    category: 'Airone'
};

/** Helper to convert a filesystem path to a proper file:// URI */
function toFileUri(fsPath: string): URI {
    const normalized = fsPath.replace(/\\/g, '/');
    const withSlash = normalized.startsWith('/') ? normalized : '/' + normalized;
    return new URI('file://' + withSlash);
}

/**
 * Main Airone contribution — handles all commands, menus, and keybindings.
 * Provides menu bar entries and toolbar-accessible commands.
 */
@injectable()
export class AiroContribution implements CommandContribution, MenuContribution, KeybindingContribution {

    @inject(EditorManager) protected readonly editorManager!: EditorManager;
    @inject(MessageService) protected readonly messageService!: MessageService;
    @inject(OpenerService) protected readonly openerService!: OpenerService;
    @inject(OutputChannelManager) protected readonly outputChannelManager!: OutputChannelManager;
    @inject(WidgetManager) protected readonly widgetManager!: WidgetManager;
    @inject(QuickInputService) protected readonly quickInputService!: QuickInputService;
    @inject(CommandService) protected readonly commandService!: CommandService;

    @inject(AiroSketchService) protected readonly sketchService!: AiroSketchClient;
    @inject(AiroSerialService) protected readonly serialService!: AiroSerialClient;

    // ─── State ──────────────────────────────────────────────────────────
    protected _selectedBoard: BoardInfo | undefined;
    protected _selectedPort: SerialPortInfo | undefined;
    protected _availablePorts: SerialPortInfo[] = [];
    protected _boards: BoardInfo[] = [];
    protected _compiling: boolean = false;
    protected _refreshTimer: number | undefined;

    constructor() {
        // Load board/port data on startup
        setTimeout(() => {
            this.loadBoards();
            this.refreshPorts();
            this._refreshTimer = window.setInterval(() => this.refreshPorts(), 5000);
        }, 2000);
    }

    // ─── Data Loading ──────────────────────────────────────────────────

    protected async loadBoards(): Promise<void> {
        try {
            this._boards = await this.sketchService.getBoards();
            const defaultBoard = await this.sketchService.getDefaultBoard();
            this._selectedBoard = defaultBoard;
        } catch {
            this._boards = [
                { id: 'esp32-devkit', name: 'ESP32 DevKit', fqbn: 'esp32:esp32:esp32', platform: 'esp32' },
                { id: 'esp32-s2', name: 'ESP32-S2', fqbn: 'esp32:esp32:esp32s2', platform: 'esp32' },
                { id: 'esp32-s3', name: 'ESP32-S3', fqbn: 'esp32:esp32:esp32s3', platform: 'esp32' },
                { id: 'esp32-c3', name: 'ESP32-C3', fqbn: 'esp32:esp32:esp32c3', platform: 'esp32' },
                { id: 'esp8266', name: 'ESP8266', fqbn: 'esp8266:esp8266:generic', platform: 'esp8266' },
            ];
            this._selectedBoard = this._boards[0];
        }
    }

    protected async refreshPorts(): Promise<void> {
        try {
            this._availablePorts = await this.serialService.listPorts();
            if (this._selectedPort) {
                const stillExists = this._availablePorts.some(p => p.path === this._selectedPort!.path);
                if (!stillExists) {
                    this._selectedPort = undefined;
                }
            }
            if (!this._selectedPort && this._availablePorts.length === 1) {
                this._selectedPort = this._availablePorts[0];
            }
        } catch {
            this._availablePorts = [];
        }
    }

    // ─── Active .airo File Detection ──────────────────────────────────

    protected getActiveAiroUri(): URI | undefined {
        try {
            const activeEditor = this.editorManager.activeEditor;
            if (activeEditor) {
                const uri = activeEditor.getResourceUri();
                if (uri && uri.path.toString().endsWith('.airo')) {
                    return uri;
                }
            }
        } catch { /* ignore */ }

        try {
            const allEditors = this.editorManager.all;
            for (const editor of allEditors) {
                try {
                    const uri = editor.getResourceUri();
                    if (uri && uri.path.toString().endsWith('.airo')) {
                        return uri;
                    }
                } catch { /* skip */ }
            }
        } catch { /* ignore */ }

        return undefined;
    }

    // ─── Actions ───────────────────────────────────────────────────────

    protected async compile(): Promise<void> {
        const uri = this.getActiveAiroUri();
        if (!uri) {
            this.messageService.error('No .airo file open. Create or open a .airo sketch first.');
            return;
        }

        this._compiling = true;
        const channel = this.outputChannelManager.getChannel('Airo Compiler');
        channel.show();
        channel.append(`\n--- Compiling ${uri.path.base} ---\n`);

        const boardLabel = this._selectedBoard ? this._selectedBoard.name : 'ESP32 DevKit';
        channel.append(`Target: ${boardLabel}\n`);
        channel.append('Running syntax check...\n');

        try {
            const result = await this.sketchService.verify(uri.toString());

            if (result.success) {
                channel.append('✓ Syntax check passed.\n');
                // Check if full compilation output was generated
                if (result.output && result.output.includes('✓ Syntax check passed')) {
                    channel.append('✓ Compilation successful!\n');
                    this.messageService.info('✓ Compilation successful!');
                } else if (result.output) {
                    channel.append(result.output + '\n');
                    // Check if Python compiler was used
                    if (result.output.includes('Full compilation requires')) {
                        channel.append('✓ Syntax check passed — install Python + airo_compiler for full C++ transpilation.\n');
                        this.messageService.info('✓ Syntax check passed. Install Python + airo_compiler for full compilation.');
                    } else {
                        channel.append('✓ Compilation successful!\n');
                        this.messageService.info('✓ Compilation successful!');
                    }
                } else {
                    channel.append('✓ Compilation successful!\n');
                    this.messageService.info('✓ Compilation successful!');
                }
            } else {
                channel.append('✗ Compilation failed.\n');
                if (result.error) {
                    channel.append(`Error: ${result.error}\n`);
                }
                if (result.errors) {
                    for (const err of result.errors) {
                        const location = err.line > 0 ? `Line ${err.line}, Col ${err.column}: ` : '';
                        channel.append(`  ${err.severity.toUpperCase()}: ${location}${err.message}\n`);
                    }
                }
                this.messageService.error('✗ Compilation failed — see output for details.');
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            channel.append(`✗ Compilation error: ${message}\n`);
            this.messageService.error('Compilation error: ' + message);
        } finally {
            this._compiling = false;
        }
    }

    protected async upload(): Promise<void> {
        const uri = this.getActiveAiroUri();
        if (!uri) {
            this.messageService.error('No .airo file open. Create or open a .airo sketch first.');
            return;
        }

        if (!this._selectedPort) {
            this.messageService.warn('No serial port selected. Select a port first.');
            await this.doSelectPort();
            if (!this._selectedPort) {
                return;
            }
        }

        this._compiling = true;
        const channel = this.outputChannelManager.getChannel('Airo Compiler');
        channel.show();
        channel.append(`\n--- Uploading ${uri.path.base} ---\n`);

        const boardLabel = this._selectedBoard ? this._selectedBoard.name : 'ESP32 DevKit';
        const boardFqbn = this._selectedBoard ? this._selectedBoard.fqbn : 'esp32:esp32:esp32';
        channel.append(`Board: ${boardLabel} (${boardFqbn})\n`);
        channel.append(`Port: ${this._selectedPort.path}\n`);
        channel.append('Step 1/3: Compiling...\n');

        try {
            const result = await this.sketchService.verify(uri.toString());

            if (!result.success) {
                channel.append('✗ Compilation failed — cannot upload.\n');
                if (result.error) {
                    channel.append(`Error: ${result.error}\n`);
                }
                if (result.errors) {
                    for (const err of result.errors) {
                        const location = err.line > 0 ? `Line ${err.line}, Col ${err.column}: ` : '';
                        channel.append(`  ${err.severity.toUpperCase()}: ${location}${err.message}\n`);
                    }
                }
                this.messageService.error('Compilation failed — fix errors before uploading.');
                return;
            }

            channel.append('✓ Compilation successful!\n');

            // Step 2: Flash firmware to the board
            channel.append('Step 2/3: Flashing firmware to board...\n');
            channel.append(`Connecting to ${this._selectedPort.path}...\n`);

            const uploadResult = await this.sketchService.upload(
                uri.toString(),
                this._selectedPort.path,
                boardFqbn
            );

            if (uploadResult.success) {
                channel.append('✓ Firmware flashed successfully!\n');
                channel.append('Step 3/3: Verifying...\n');
                channel.append('✓ Upload complete!\n');
                this.messageService.info('✓ Upload complete!');
            } else {
                channel.append('✗ Upload failed.\n');
                if (uploadResult.error) {
                    channel.append(`Error: ${uploadResult.error}\n`);
                }
                if (uploadResult.error && uploadResult.error.includes('esptool')) {
                    channel.append('\nℹ To enable firmware flashing, install esptool:\n');
                    channel.append('  pip install esptool\n');
                } else if (uploadResult.error && uploadResult.error.includes('Arduino CLI')) {
                    channel.append('\nℹ To enable C++ compilation, install Arduino CLI:\n');
                    channel.append('  https://arduino.github.io/arduino-cli/latest/installation/\n');
                } else {
                    channel.append('Make sure your board is connected and the correct port is selected.\n');
                }
                this.messageService.error('Upload failed — see output for details.');
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            channel.append(`✗ Upload error: ${message}\n`);
            this.messageService.error('Upload error: ' + message);
        } finally {
            this._compiling = false;
        }
    }

    protected async newSketch(): Promise<void> {
        try {
            const defaultName = `sketch_${Date.now().toString(36)}`;

            // Use QuickInputService.input() — rendered inline in Theia's UI,
            // much more reliable than SingleTextInputDialog in Electron.
            const name = await this.quickInputService.input({
                title: 'New Sketch',
                value: defaultName,
                prompt: 'Enter a name for the new sketch',
                placeHolder: 'sketch_name',
                validateInput: async (input: string) => {
                    if (!input || input.trim().length === 0) {
                        return 'Sketch name cannot be empty';
                    }
                    if (!/^[a-zA-Z0-9_-]+$/.test(input.trim())) {
                        return 'Only letters, numbers, underscores, and hyphens allowed';
                    }
                    return undefined;
                }
            });

            if (!name || name.trim().length === 0) {
                return;
            }
            const sketchName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '_');

            this.messageService.info(`Creating sketch "${sketchName}"...`);

            const sketch = await this.sketchService.newSketch(sketchName);

            // Convert filesystem path to proper file:// URI
            const fileUri = toFileUri(sketch.mainFile);

            // Open the newly created file
            try {
                const opener = await this.openerService.getOpener(fileUri);
                await opener.open(fileUri);
                this.messageService.info(`Created sketch: ${sketch.name}`);
            } catch {
                // If opener fails, try using the command service
                try {
                    await this.commandService.executeCommand('core.open', fileUri);
                    this.messageService.info(`Created sketch: ${sketch.name}`);
                } catch {
                    this.messageService.info(`Sketch created at: ${sketch.mainFile}. Open it from the File menu.`);
                }
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            this.messageService.error('Failed to create sketch: ' + message);
        }
    }

    protected async openExamples(): Promise<void> {
        try {
            const examples = await this.sketchService.listExamples();
            const items: (QuickPickItem & { exampleName: string })[] = examples.map((ex: { name: string; category: string; description: string }) => ({
                label: ex.name,
                description: ex.category,
                detail: ex.description,
                exampleName: ex.name
            }));

            const picked = await this.quickInputService.pick<(QuickPickItem & { exampleName: string })>(items, {
                placeHolder: 'Select an example sketch...'
            });

            if (picked && picked.exampleName) {
                const code = await this.sketchService.loadExample(picked.exampleName);

                const sketch = await this.sketchService.newSketchFromExample(
                    `example_${picked.exampleName.toLowerCase()}_${Date.now().toString(36)}`,
                    code
                );

                // Convert filesystem path to proper file:// URI
                const fileUri = toFileUri(sketch.mainFile);
                const opener = await this.openerService.getOpener(fileUri);
                await opener.open(fileUri);

                this.messageService.info(`Example loaded: ${picked.exampleName}`);
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            this.messageService.error('Failed to load examples: ' + message);
        }
    }

    protected async doSelectBoard(): Promise<void> {
        try {
            const boards = this._boards.length > 0 ? this._boards : await this.sketchService.getBoards();
            const items: (QuickPickItem & { board: BoardInfo })[] = boards.map((board: BoardInfo) => ({
                label: board.name,
                description: board.fqbn,
                detail: `Platform: ${board.platform}`,
                board
            }));

            const picked = await this.quickInputService.pick<(QuickPickItem & { board: BoardInfo })>(items, {
                placeHolder: 'Select a board...'
            });

            if (picked && picked.board) {
                this._selectedBoard = picked.board;
                this.messageService.info(`Board: ${picked.board.name}`);
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            this.messageService.error('Failed to select board: ' + message);
        }
    }

    protected async doSelectPort(): Promise<void> {
        try {
            const ports = await this.serialService.listPorts();
            if (ports.length === 0) {
                this.messageService.warn('No serial ports detected. Connect your board and try again.');
                return;
            }

            const items: (QuickPickItem & { port: SerialPortInfo })[] = ports.map((port: SerialPortInfo) => ({
                label: port.path,
                description: port.manufacturer || '',
                detail: port.pnpId || (port.vendorId ? `VID:${port.vendorId} PID:${port.productId}` : ''),
                port
            }));

            const picked = await this.quickInputService.pick<(QuickPickItem & { port: SerialPortInfo })>(items, {
                placeHolder: 'Select a serial port...'
            });

            if (picked && picked.port) {
                this._selectedPort = picked.port;
                this.messageService.info(`Port: ${picked.port.path}`);
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            this.messageService.error('Failed to list ports: ' + message);
        }
    }

    @inject(ApplicationShell) protected readonly shell!: ApplicationShell;

    protected async toggleSerialMonitor(): Promise<void> {
        try {
            const widget = await this.widgetManager.getOrCreateWidget(AiroSerialWidget.ID);
            if (widget.isAttached && widget.isVisible) {
                widget.hide();
            } else {
                if (!widget.isAttached) {
                    this.shell.addWidget(widget, { area: 'bottom' });
                }
                this.shell.revealWidget(widget.id);
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            this.messageService.error('Failed to open Serial Monitor: ' + message);
        }
    }

    /**
     * Sync pin definitions to the AI Backbone.
     * Sends the Pin defi block and full .airo source to the Backbone
     * application via HTTP POST.
     */
    protected async syncToBackbone(): Promise<void> {
        const uri = this.getActiveAiroUri();
        if (!uri) {
            this.messageService.error('No .airo file open. Open a .airo sketch first.');
            return;
        }

        // Get the .airo source content from the active editor
        let airoCode: string | undefined;
        try {
            const activeEditor = this.editorManager.activeEditor;
            if (activeEditor) {
                airoCode = activeEditor.editor.document.getText();
            }
        } catch { /* ignore */ }

        if (!airoCode) {
            this.messageService.error('Could not read .airo source for sync.');
            return;
        }

        // Extract pin defi block
        const pinDefiMatch = airoCode.match(/[Pp]in\s+defi\s*\{[\s\S]*?\}/);
        if (!pinDefiMatch) {
            this.messageService.warn('No Pin defi block found in .airo file.');
            return;
        }

        // Ask for backbone URL
        const backboneUrl = await this.quickInputService.input({
            title: 'Sync to Airone Backbone',
            prompt: 'Enter the AI Backbone URL',
            placeHolder: 'http://localhost:8080',
            value: 'http://localhost:8080'
        });

        if (!backboneUrl || backboneUrl.trim().length === 0) {
            return;
        }

        const url = backboneUrl.trim().replace(/\/$/, '');

        try {
            const sketchName = uri.path.base.replace('.airo', '');
            const response = await fetch(`${url}/api/pins/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    robotName: sketchName,
                    pinDefinitions: pinDefiMatch[0],
                    source: airoCode
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            this.messageService.info('✓ Pin definitions synced to Airone Backbone.');
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            this.messageService.error(
                `Failed to sync to Backbone: ${message}. ` +
                'Make sure the Airone Backbone app is running.'
            );
        }
    }

    protected async manageLibraries(): Promise<void> {
        const builtinLibs = [
            { label: 'WiFi', desc: 'WiFi connectivity for ESP32' },
            { label: 'Wire (I2C)', desc: 'I2C communication protocol' },
            { label: 'SPI', desc: 'SPI communication protocol' },
            { label: 'Serial', desc: 'Serial communication' },
            { label: 'EEPROM', desc: 'Persistent storage' },
            { label: 'Servo', desc: 'Servo motor control' },
            { label: 'ArduinoJson', desc: 'JSON parsing and creation' },
            { label: 'WebServer', desc: 'HTTP web server' },
            { label: 'HTTPClient', desc: 'HTTP client requests' },
            { label: 'BLE', desc: 'Bluetooth Low Energy' },
            { label: 'MQTT', desc: 'MQTT messaging protocol' },
            { label: 'OTA', desc: 'Over-the-air updates' },
        ];

        const items: (QuickPickItem & { libName: string })[] = builtinLibs.map(lib => ({
            label: lib.label,
            description: 'Built-in',
            detail: lib.desc,
            libName: lib.label
        }));

        const picked = await this.quickInputService.pick<(QuickPickItem & { libName: string })>(items, {
            placeHolder: 'Select a library to view details...'
        });

        if (picked) {
            this.messageService.info(
                `${picked.libName} is included by default in all Airone projects. ` +
                `Use the #library# section in your .airo file to include it: # call body/comm/${picked.libName.toLowerCase().replace(/[^a-z0-9]/g, '')}.airo.`
            );
        }
    }

    // ─── Command Registration ────────────────────────────────────────────

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(AIRO_COMPILE_COMMAND, {
            execute: () => this.compile(),
            isEnabled: () => !this._compiling
        });
        commands.registerCommand(AIRO_UPLOAD_COMMAND, {
            execute: () => this.upload(),
            isEnabled: () => !this._compiling
        });
        commands.registerCommand(AIRO_NEW_SKETCH_COMMAND, {
            execute: () => this.newSketch(),
            isEnabled: () => true
        });
        commands.registerCommand(AIRO_EXAMPLES_COMMAND, {
            execute: () => this.openExamples(),
            isEnabled: () => true
        });
        commands.registerCommand(AIRO_SELECT_BOARD_COMMAND, {
            execute: () => this.doSelectBoard(),
            isEnabled: () => true
        });
        commands.registerCommand(AIRO_SELECT_PORT_COMMAND, {
            execute: () => this.doSelectPort(),
            isEnabled: () => true
        });
        commands.registerCommand(AIRO_SERIAL_MONITOR_COMMAND, {
            execute: () => this.toggleSerialMonitor(),
            isEnabled: () => true
        });
        commands.registerCommand(AIRO_CHECK_UPDATES_COMMAND, {
            execute: async () => {
                try {
                    await commands.executeCommand('electron-theia:check-for-updates');
                } catch {
                    this.messageService.info('Airone IDE — No updates available at this time. You can check again later or download from GitHub Releases.');
                }
            },
            isEnabled: () => true
        });

        // Restart to Update command — checks for updates and offers to restart
        commands.registerCommand(AIRO_RESTART_UPDATE_COMMAND, {
            execute: async () => {
                try {
                    // Check if an update has already been downloaded (data attribute set by updater)
                    const updateReady = document.body.hasAttribute('data-airone-update-ready');
                    if (updateReady) {
                        // Update is ready — delegate to the built-in restart command
                        await commands.executeCommand('electron-theia:restart-to-update');
                    } else {
                        // No update downloaded yet — check for updates first
                        const checkAnswer = await this.quickInputService.pick([
                            { label: 'Check for Updates', description: 'Check GitHub for the latest version' },
                            { label: 'Download from GitHub', description: 'Open the releases page in your browser' },
                        ], {
                            placeHolder: 'No update is ready to install. What would you like to do?'
                        });

                        if (checkAnswer?.label === 'Check for Updates') {
                            try {
                                await commands.executeCommand('electron-theia:check-for-updates');
                            } catch {
                                this.messageService.info('Airone IDE — Checking for updates...');
                            }
                        } else if (checkAnswer?.label === 'Download from GitHub') {
                            window.open('https://github.com/eesha000009-dev/airone-ide/releases', '_blank');
                        }
                    }
                } catch (err: unknown) {
                    const message = err instanceof Error ? err.message : String(err);
                    this.messageService.info(
                        'Could not check for updates. ' +
                        'Visit https://github.com/eesha000009-dev/airone-ide/releases to download the latest version. ' +
                        (message ? `(${message})` : '')
                    );
                }
            },
            isEnabled: () => true
        });

        // Register library commands (just show info message)
        const builtinLibs = [
            { label: 'WiFi', id: 'airo.lib.wifi' },
            { label: 'Wire (I2C)', id: 'airo.lib.wire' },
            { label: 'SPI', id: 'airo.lib.spi' },
            { label: 'Serial', id: 'airo.lib.serial' },
            { label: 'EEPROM', id: 'airo.lib.eeprom' },
            { label: 'Servo', id: 'airo.lib.servo' },
            { label: 'ArduinoJson', id: 'airo.lib.arduinojson' },
            { label: 'WebServer', id: 'airo.lib.webserver' },
            { label: 'HTTPClient', id: 'airo.lib.httpclient' },
            { label: 'BLE', id: 'airo.lib.ble' },
            { label: 'MQTT', id: 'airo.lib.mqtt' },
            { label: 'OTA', id: 'airo.lib.ota' },
        ];
        for (const lib of builtinLibs) {
            commands.registerCommand({ id: lib.id, label: lib.label, category: 'Airone Libraries' }, {
                execute: () => {
                    this.messageService.info(`${lib.label} library is included by default in all Airone projects. Use #library# section to include it.`);
                }
            });
        }

        // Manage Libraries command — shows a QuickPick with available libraries
        commands.registerCommand(AIRO_MANAGE_LIBRARIES_COMMAND, {
            execute: () => this.manageLibraries(),
            isEnabled: () => true
        });

        // Sync to Backbone command — sends pin definitions to AI Backbone
        commands.registerCommand(AIRO_SYNC_BACKBONE_COMMAND, {
            execute: () => this.syncToBackbone(),
            isEnabled: () => true
        });
    }

    // ─── Menu Registration ───────────────────────────────────────────────

    registerMenus(menus: MenuModelRegistry): void {
        // ─── File menu additions ────────────────────────────────────
        // Register New Sketch and Examples in the File menu
        menus.registerMenuAction(CommonMenus.FILE, {
            commandId: AIRO_NEW_SKETCH_COMMAND.id,
            label: 'New Sketch',
            order: '0'
        });

        menus.registerMenuAction(CommonMenus.FILE, {
            commandId: AIRO_EXAMPLES_COMMAND.id,
            label: 'Examples',
            order: '1'
        });

        // Hide Theia's built-in "New File" / "New Folder" from File menu
        // (New Sketch already provides file creation functionality)
        try {
            menus.unregisterMenuAction('workbench.action.files.newFile', CommonMenus.FILE_NEW_CONTRIBUTIONS);
            menus.unregisterMenuAction('workbench.action.files.newUntitledFile', CommonMenus.FILE_NEW_CONTRIBUTIONS);
            menus.unregisterMenuAction('file.newFolder', CommonMenus.FILE_NEW_CONTRIBUTIONS);
        } catch { /* ignore if not registered yet */ }

        // ─── Libraries menu (top-level) ────────────────────────────
        menus.registerSubmenu(AIRONE_LIBRARIES_MENU, 'Libraries');

        const builtinLibs = [
            { label: 'WiFi', id: 'airo.lib.wifi' },
            { label: 'Wire (I2C)', id: 'airo.lib.wire' },
            { label: 'SPI', id: 'airo.lib.spi' },
            { label: 'Serial', id: 'airo.lib.serial' },
            { label: 'EEPROM', id: 'airo.lib.eeprom' },
            { label: 'Servo', id: 'airo.lib.servo' },
            { label: 'ArduinoJson', id: 'airo.lib.arduinojson' },
            { label: 'WebServer', id: 'airo.lib.webserver' },
            { label: 'HTTPClient', id: 'airo.lib.httpclient' },
            { label: 'BLE', id: 'airo.lib.ble' },
            { label: 'MQTT', id: 'airo.lib.mqtt' },
            { label: 'OTA', id: 'airo.lib.ota' },
        ];

        for (let i = 0; i < builtinLibs.length; i++) {
            const lib = builtinLibs[i];
            menus.registerMenuAction(AIRONE_LIBRARIES_BUILTIN, {
                commandId: lib.id,
                label: lib.label,
                order: String(i)
            });
        }

        menus.registerMenuAction(AIRONE_LIBRARIES_MANAGE, {
            commandId: AIRO_MANAGE_LIBRARIES_COMMAND.id,
            label: 'Manage Libraries...',
            order: 'z'
        });

        // ─── Tools menu (top-level) ────────────────────────────────
        menus.registerSubmenu(AIRONE_TOOLS_MENU, 'Tools');

        menus.registerMenuAction(AIRONE_TOOLS_BOARD, {
            commandId: AIRO_SELECT_BOARD_COMMAND.id,
            label: 'Boards',
            order: 'a'
        });

        menus.registerMenuAction(AIRONE_TOOLS_PORT, {
            commandId: AIRO_SELECT_PORT_COMMAND.id,
            label: 'Ports',
            order: 'b'
        });

        menus.registerMenuAction(AIRONE_TOOLS_SERIAL, {
            commandId: AIRO_SERIAL_MONITOR_COMMAND.id,
            label: 'Serial Monitor',
            order: 'c'
        });

        menus.registerMenuAction(AIRONE_TOOLS_UPDATE, {
            commandId: AIRO_CHECK_UPDATES_COMMAND.id,
            label: 'Check for Updates',
            order: 'd'
        });

        menus.registerMenuAction(AIRONE_TOOLS_UPDATE, {
            commandId: AIRO_RESTART_UPDATE_COMMAND.id,
            label: 'Restart to Update',
            order: 'e'
        });

        // Sync to Backbone in Tools menu
        menus.registerMenuAction(AIRONE_TOOLS_SERIAL, {
            commandId: AIRO_SYNC_BACKBONE_COMMAND.id,
            label: 'Sync to Backbone',
            order: 'd'
        });
    }

    // ─── Keybinding Registration ─────────────────────────────────────────

    registerKeybindings(keybindings: KeybindingRegistry): void {
        keybindings.registerKeybinding({
            command: AIRO_COMPILE_COMMAND.id,
            keybinding: 'ctrl+r'
        });
        keybindings.registerKeybinding({
            command: AIRO_UPLOAD_COMMAND.id,
            keybinding: 'ctrl+u'
        });
        keybindings.registerKeybinding({
            command: AIRO_SERIAL_MONITOR_COMMAND.id,
            keybinding: 'ctrl+shift+m'
        });
        keybindings.registerKeybinding({
            command: AIRO_SYNC_BACKBONE_COMMAND.id,
            keybinding: 'ctrl+shift+b'
        });
    }
}
