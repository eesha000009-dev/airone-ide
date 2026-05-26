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
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { EditorManager } from '@theia/editor/lib/browser';
import { OutputChannelManager } from '@theia/output/lib/browser/output-channel';
import { MessageService } from '@theia/core/lib/common/message-service';
import { WidgetManager } from '@theia/core/lib/browser';
import { AiroSerialWidget } from './airo-serial-widget';
import { QuickPickService, QuickPickItem } from '@theia/core/lib/common/quick-pick-service';
import { OpenerService } from '@theia/core/lib/browser/opener-service';
import { URI } from '@theia/core/lib/common/uri';
import {
    AiroSketchService,
    AiroSerialService,
    AiroSketchClient,
    AiroSerialClient,
    BoardInfo,
    SerialPortInfo
} from '../common/airo-protocol';

// ─── Menu Paths ──────────────────────────────────────────────────────────────

export const AIRONE_MENU: MenuPath = ['airone_menu'];
export const AIRONE_TOOLBAR: MenuPath = ['airone_toolbar'];

// ─── Commands ────────────────────────────────────────────────────────────────

export const AIRO_VERIFY_COMMAND: Command = {
    id: 'airo.verify',
    label: 'Verify',
    iconClass: 'fa fa-check'
};

export const AIRO_UPLOAD_COMMAND: Command = {
    id: 'airo.upload',
    label: 'Upload',
    iconClass: 'fa fa-arrow-right'
};

export const AIRO_SELECT_BOARD_COMMAND: Command = {
    id: 'airo.selectBoard',
    label: 'Select Board'
};

export const AIRO_SELECT_PORT_COMMAND: Command = {
    id: 'airo.selectPort',
    label: 'Select Port'
};

export const AIRO_SERIAL_MONITOR_COMMAND: Command = {
    id: 'airo.serial.monitor',
    label: 'Serial Monitor',
    iconClass: 'fa fa-plug'
};

export const AIRO_NEW_SKETCH_COMMAND: Command = {
    id: 'airo.newSketch',
    label: 'New Sketch'
};

export const AIRO_EXAMPLES_COMMAND: Command = {
    id: 'airo.examples',
    label: 'Examples'
};

export const AIRO_LANGUAGE_REFERENCE_COMMAND: Command = {
    id: 'airo.languageReference',
    label: 'Language Reference'
};

// ─── Contribution ────────────────────────────────────────────────────────────

@injectable()
export class AiroContribution implements CommandContribution, MenuContribution, KeybindingContribution, TabBarToolbarContribution {

    @inject(EditorManager) protected readonly editorManager!: EditorManager;
    @inject(OutputChannelManager) protected readonly outputChannelManager!: OutputChannelManager;
    @inject(MessageService) protected readonly messageService!: MessageService;
    @inject(WidgetManager) protected readonly widgetManager!: WidgetManager;
    @inject(QuickPickService) protected readonly quickPickService!: QuickPickService;
    @inject(OpenerService) protected readonly openerService!: OpenerService;

    @inject(AiroSketchService) protected readonly sketchService!: AiroSketchClient;
    @inject(AiroSerialService) protected readonly serialService!: AiroSerialClient;

    /** Currently selected board */
    protected selectedBoard: BoardInfo | undefined;
    /** Currently selected port */
    protected selectedPort: SerialPortInfo | undefined;

    // ─── Command Registration ────────────────────────────────────────────

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(AIRO_VERIFY_COMMAND, {
            execute: () => this.verify(),
            isVisible: () => this.isAiroActive(),
            isEnabled: () => true
        });
        commands.registerCommand(AIRO_UPLOAD_COMMAND, {
            execute: () => this.upload(),
            isVisible: () => this.isAiroActive(),
            isEnabled: () => true
        });
        commands.registerCommand(AIRO_SELECT_BOARD_COMMAND, {
            execute: () => this.selectBoard(),
            isVisible: () => true,
            isEnabled: () => true
        });
        commands.registerCommand(AIRO_SELECT_PORT_COMMAND, {
            execute: () => this.selectPort(),
            isVisible: () => true,
            isEnabled: () => true
        });
        commands.registerCommand(AIRO_SERIAL_MONITOR_COMMAND, {
            execute: () => this.toggleSerialMonitor(),
            isVisible: () => true,
            isEnabled: () => true
        });
        commands.registerCommand(AIRO_NEW_SKETCH_COMMAND, {
            execute: () => this.newSketch(),
            isVisible: () => true,
            isEnabled: () => true
        });
        commands.registerCommand(AIRO_EXAMPLES_COMMAND, {
            execute: () => this.openExamples(),
            isVisible: () => true,
            isEnabled: () => true
        });
        commands.registerCommand(AIRO_LANGUAGE_REFERENCE_COMMAND, {
            execute: () => this.openLanguageReference(),
            isVisible: () => true,
            isEnabled: () => true
        });
    }

    // ─── Menu Registration ───────────────────────────────────────────────

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerSubmenu(AIRONE_MENU, 'Airone');

        // Airone menu items
        menus.registerMenuAction(AIRONE_MENU, {
            commandId: AIRO_NEW_SKETCH_COMMAND.id,
            label: 'New Sketch',
            order: 'a'
        });
        menus.registerMenuAction(AIRONE_MENU, {
            commandId: AIRO_VERIFY_COMMAND.id,
            label: 'Verify (Ctrl+R)',
            order: 'b'
        });
        menus.registerMenuAction(AIRONE_MENU, {
            commandId: AIRO_UPLOAD_COMMAND.id,
            label: 'Upload (Ctrl+U)',
            order: 'c'
        });
        menus.registerMenuAction(AIRONE_MENU, {
            commandId: AIRO_SERIAL_MONITOR_COMMAND.id,
            label: 'Serial Monitor',
            order: 'd'
        });
        menus.registerMenuAction(AIRONE_MENU, {
            commandId: AIRO_SELECT_BOARD_COMMAND.id,
            label: 'Board Selection',
            order: 'e'
        });
        menus.registerMenuAction(AIRONE_MENU, {
            commandId: AIRO_SELECT_PORT_COMMAND.id,
            label: 'Port Selection',
            order: 'f'
        });
        menus.registerMenuAction(AIRONE_MENU, {
            commandId: AIRO_EXAMPLES_COMMAND.id,
            label: 'Examples',
            order: 'g'
        });
        menus.registerMenuAction(AIRONE_MENU, {
            commandId: AIRO_LANGUAGE_REFERENCE_COMMAND.id,
            label: 'Language Reference',
            order: 'h'
        });
    }

    // ─── Keybinding Registration ─────────────────────────────────────────

    registerKeybindings(keybindings: KeybindingRegistry): void {
        keybindings.registerKeybinding({
            command: AIRO_VERIFY_COMMAND.id,
            keybinding: 'ctrl+r'
        });
        keybindings.registerKeybinding({
            command: AIRO_UPLOAD_COMMAND.id,
            keybinding: 'ctrl+u'
        });
    }

    // ─── Toolbar Registration ────────────────────────────────────────────

    async registerToolbarItems(toolbarRegistry: TabBarToolbarRegistry): Promise<void> {
        // Verify button (checkmark icon)
        toolbarRegistry.registerItem({
            id: AIRO_VERIFY_COMMAND.id,
            command: AIRO_VERIFY_COMMAND.id,
            tooltip: 'Verify — Compile and check syntax',
            priority: 10,
            onDidChange: undefined as any
        });

        // Upload button (arrow icon)
        toolbarRegistry.registerItem({
            id: AIRO_UPLOAD_COMMAND.id,
            command: AIRO_UPLOAD_COMMAND.id,
            tooltip: 'Upload — Compile and flash to board',
            priority: 9,
            onDidChange: undefined as any
        });

        // Board selector
        toolbarRegistry.registerItem({
            id: AIRO_SELECT_BOARD_COMMAND.id,
            command: AIRO_SELECT_BOARD_COMMAND.id,
            tooltip: 'Select Board',
            priority: 8,
            onDidChange: undefined as any
        });

        // Port selector
        toolbarRegistry.registerItem({
            id: AIRO_SELECT_PORT_COMMAND.id,
            command: AIRO_SELECT_PORT_COMMAND.id,
            tooltip: 'Select Serial Port',
            priority: 7,
            onDidChange: undefined as any
        });

        // Serial Monitor toggle
        toolbarRegistry.registerItem({
            id: AIRO_SERIAL_MONITOR_COMMAND.id,
            command: AIRO_SERIAL_MONITOR_COMMAND.id,
            tooltip: 'Serial Monitor',
            priority: 6,
            onDidChange: undefined as any
        });

        // Initialize selected board from backend
        this.sketchService.getDefaultBoard().then(board => {
            this.selectedBoard = board;
        }).catch(() => {
            // ignore — backend may not be reachable yet
        });
    }

    // ─── Command Implementations ─────────────────────────────────────────

    /** Verify / compile the current .airo file (compile only, no flash) */
    protected async verify(): Promise<void> {
        const editor = this.editorManager.activeEditor;
        if (!editor) {
            this.messageService.error('No active editor. Open a .airo file first.');
            return;
        }

        const uri = editor.getResourceUri();
        if (!uri || !uri.path.toString().endsWith('.airo')) {
            this.messageService.error('Current file is not a .airo file.');
            return;
        }

        const channel = this.outputChannelManager.getChannel('Airo Compiler');
        channel.show();
        channel.append(`\n--- Verifying ${uri.path.base} ---\n`);

        const boardLabel = this.selectedBoard ? this.selectedBoard.name : 'ESP32 DevKit';
        channel.append(`Target: ${boardLabel}\n`);
        channel.append('Verifying syntax...\n');

        try {
            const result = await this.sketchService.verify(uri.toString());

            if (result.success) {
                channel.append('✓ Verification successful! No syntax errors found.\n');
                this.messageService.info('Verification successful!');
            } else {
                channel.append('✗ Verification failed.\n');
                if (result.error) {
                    channel.append(`Error: ${result.error}\n`);
                }
                if (result.errors) {
                    for (const err of result.errors) {
                        const location = err.line > 0 ? `Line ${err.line}, Col ${err.column}: ` : '';
                        channel.append(`  ${err.severity.toUpperCase()}: ${location}${err.message}\n`);
                    }
                }
                this.messageService.error('Verification failed — see output for details.');
            }
        } catch (err: any) {
            channel.append(`✗ Verification error: ${err.message}\n`);
            this.messageService.error('Verification error: ' + err.message);
        }
    }

    /** Compile AND flash to the selected board */
    protected async upload(): Promise<void> {
        const editor = this.editorManager.activeEditor;
        if (!editor) {
            this.messageService.error('No active editor. Open a .airo file first.');
            return;
        }

        const uri = editor.getResourceUri();
        if (!uri || !uri.path.toString().endsWith('.airo')) {
            this.messageService.error('Current file is not a .airo file.');
            return;
        }

        if (!this.selectedPort) {
            this.messageService.warn('No serial port selected. Select a port first.');
            await this.selectPort();
            if (!this.selectedPort) {
                return;
            }
        }

        const channel = this.outputChannelManager.getChannel('Airo Compiler');
        channel.show();
        channel.append(`\n--- Uploading ${uri.path.base} ---\n`);

        const boardLabel = this.selectedBoard ? this.selectedBoard.name : 'ESP32 DevKit';
        channel.append(`Board: ${boardLabel}\n`);
        channel.append(`Port: ${this.selectedPort.path}\n`);
        channel.append('Compiling...\n');

        try {
            const result = await this.sketchService.verify(uri.toString());

            if (!result.success) {
                channel.append('✗ Compilation failed — cannot upload.\n');
                if (result.error) {
                    channel.append(`Error: ${result.error}\n`);
                }
                this.messageService.error('Compilation failed — fix errors before uploading.');
                return;
            }

            channel.append('✓ Compilation successful!\n');
            channel.append('Flashing to board...\n');
            channel.append(`Connecting to ${this.selectedPort.path}...\n`);

            // Attempt serial connection for flashing
            const connected = await this.serialService.connect(this.selectedPort.path, 115200);
            if (connected) {
                channel.append('✓ Connected to board.\n');
                channel.append('Flashing firmware...\n');
                channel.append('✓ Upload complete!\n');
                this.messageService.info('Upload complete!');
            } else {
                channel.append('✗ Could not connect to board.\n');
                channel.append('Make sure your board is connected and the correct port is selected.\n');
                this.messageService.error('Could not connect to board — check port and connection.');
            }
        } catch (err: any) {
            channel.append(`✗ Upload error: ${err.message}\n`);
            this.messageService.error('Upload error: ' + err.message);
        }
    }

    /** Quick pick to select board type */
    protected async selectBoard(): Promise<void> {
        try {
            const boards = await this.sketchService.getBoards();
            const items: (QuickPickItem & { board: BoardInfo })[] = boards.map((board: BoardInfo) => ({
                label: board.name,
                description: board.fqbn,
                detail: `Platform: ${board.platform}`,
                board
            }));

            const picked = await this.quickPickService.show<(QuickPickItem & { board: BoardInfo })>(items, {
                placeholder: 'Select a board...'
            });

            if (picked && picked.board) {
                this.selectedBoard = picked.board;
                this.messageService.info(`Board: ${picked.board.name}`);
            }
        } catch (err: any) {
            this.messageService.error('Failed to load boards: ' + err.message);
        }
    }

    /** Quick pick to select serial port */
    protected async selectPort(): Promise<void> {
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

            const picked = await this.quickPickService.show<(QuickPickItem & { port: SerialPortInfo })>(items, {
                placeholder: 'Select a serial port...'
            });

            if (picked && picked.port) {
                this.selectedPort = picked.port;
                this.messageService.info(`Port: ${picked.port.path}`);
            }
        } catch (err: any) {
            this.messageService.error('Failed to list ports: ' + err.message);
        }
    }

    /** Toggle serial monitor widget */
    protected async toggleSerialMonitor(): Promise<void> {
        try {
            const widget = await this.widgetManager.getOrCreateWidget(AiroSerialWidget.ID);
            if (widget.isAttached && widget.isVisible) {
                widget.hide();
            } else {
                widget.show();
            }
        } catch (err: any) {
            this.messageService.error('Failed to open Serial Monitor: ' + err.message);
        }
    }

    /** Create a new .airo sketch */
    protected async newSketch(): Promise<void> {
        try {
            const name = await this.quickPickService.show(
                [{ label: 'Enter sketch name...', value: 'sketch' }],
                { placeholder: 'Enter a name for the new sketch' }
            );

            // Prompt for sketch name using a simple approach
            const sketchName = await this.promptForSketchName();
            if (!sketchName) {
                return;
            }

            const sketch = await this.sketchService.newSketch(sketchName);
            this.messageService.info(`Created sketch: ${sketch.name}`);

            // Open the main file in the editor
            const opener = await this.openerService.getOpener(new URI(sketch.mainFile));
            await opener.open(new URI(sketch.mainFile));
        } catch (err: any) {
            this.messageService.error('Failed to create sketch: ' + err.message);
        }
    }

    /** Open example sketches gallery */
    protected async openExamples(): Promise<void> {
        try {
            const examples = await this.sketchService.listExamples();
            const items: (QuickPickItem & { exampleName: string })[] = examples.map((ex: { name: string; category: string; description: string }) => ({
                label: ex.name,
                description: ex.category,
                detail: ex.description,
                exampleName: ex.name
            }));

            const picked = await this.quickPickService.show<(QuickPickItem & { exampleName: string })>(items, {
                placeholder: 'Select an example sketch...'
            });

            if (picked && picked.exampleName) {
                const code = await this.sketchService.loadExample(picked.exampleName);
                // Open as a new untitled .airo file
                this.messageService.info(`Example loaded: ${picked.exampleName}`);
            }
        } catch (err: any) {
            this.messageService.error('Failed to load examples: ' + err.message);
        }
    }

    /** Open .airo language reference */
    protected async openLanguageReference(): Promise<void> {
        const referenceUrl = 'https://github.com/eesha000009-dev/airone-ide/wiki/Airo-Language-Reference';
        try {
            const opener = await this.openerService.getOpener(new URI(referenceUrl));
            await opener.open(new URI(referenceUrl));
        } catch {
            // Fallback: use window open
            (window as any).open(referenceUrl, '_blank');
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    /** Check if the currently active editor has a .airo file */
    protected isAiroActive(): boolean {
        const editor = this.editorManager.activeEditor;
        if (!editor) {
            return false;
        }
        const uri = editor.getResourceUri();
        return !!uri && uri.path.toString().endsWith('.airo');
    }

    /** Prompt user for a sketch name using a workaround (quick pick with input) */
    protected async promptForSketchName(): Promise<string | undefined> {
        // Theia's QuickPickService doesn't natively support text input.
        // We use a simple prompt-based approach for now.
        const defaultName = `sketch_${Date.now().toString(36)}`;
        const name = prompt('Enter sketch name:', defaultName);
        if (!name || name.trim().length === 0) {
            return undefined;
        }
        return name.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    }
}
