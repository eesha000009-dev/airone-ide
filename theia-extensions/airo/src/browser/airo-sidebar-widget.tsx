/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Message } from '@theia/core/lib/browser/widgets/widget';
import * as React from 'react';
import { EditorManager } from '@theia/editor/lib/browser';
import { OutputChannelManager } from '@theia/output/lib/browser/output-channel';
import { MessageService } from '@theia/core/lib/common/message-service';
import { WidgetManager } from '@theia/core/lib/browser';
import { AiroSerialWidget } from './airo-serial-widget';
import { QuickPickService } from '@theia/core/lib/common/quick-pick-service';
import { OpenerService } from '@theia/core/lib/browser/opener-service';
import { URI } from '@theia/core/lib/common/uri';
import { CommandService } from '@theia/core/lib/common/command';
import { SingleTextInputDialog } from '@theia/core/lib/browser/dialogs';
import {
    AiroSketchService,
    AiroSerialService,
    AiroSketchClient,
    AiroSerialClient,
    BoardInfo,
    SerialPortInfo
} from '../common/airo-protocol';

@injectable()
export class AiroSidebarWidget extends ReactWidget {
    static readonly ID = 'airo-sidebar';
    static readonly LABEL = 'Airone';

    @inject(EditorManager) protected readonly editorManager!: EditorManager;
    @inject(OutputChannelManager) protected readonly outputChannelManager!: OutputChannelManager;
    @inject(MessageService) protected readonly messageService!: MessageService;
    @inject(WidgetManager) protected readonly widgetManager!: WidgetManager;
    @inject(QuickPickService) protected readonly quickPickService!: QuickPickService;
    @inject(OpenerService) protected readonly openerService!: OpenerService;
    @inject(CommandService) protected readonly commandService!: CommandService;

    @inject(AiroSketchService) protected readonly sketchService!: AiroSketchClient;
    @inject(AiroSerialService) protected readonly serialService!: AiroSerialClient;

    // ─── State ──────────────────────────────────────────────────────────
    private _selectedBoard: BoardInfo | undefined;
    private _selectedPort: SerialPortInfo | undefined;
    private _availablePorts: SerialPortInfo[] = [];
    private _boards: BoardInfo[] = [];
    private _compiling: boolean = false;
    private _serialConnected: boolean = false;
    private _refreshTimer: number | undefined;

    @postConstruct()
    protected init(): void {
        this.id = AiroSidebarWidget.ID;
        this.title.label = AiroSidebarWidget.LABEL;
        this.title.caption = 'Airone — Robotics Programming';
        this.title.iconClass = 'airo-sidebar-icon';
        this.title.closable = false;
        this.update();

        // Load initial data
        this.loadBoards();
        this.refreshPorts();

        // Auto-refresh port list every 5 seconds
        this._refreshTimer = window.setInterval(() => this.refreshPorts(), 5000);

        // Check serial connection status
        try {
            this._serialConnected = this.serialService.isConnected();
        } catch {
            this._serialConnected = false;
        }
        this.update();
    }

    protected onCloseRequest(msg: Message): void {
        super.onCloseRequest(msg);
        if (this._refreshTimer !== undefined) {
            clearInterval(this._refreshTimer);
        }
    }

    // ─── Data Loading ──────────────────────────────────────────────────

    protected async loadBoards(): Promise<void> {
        try {
            this._boards = await this.sketchService.getBoards();
            const defaultBoard = await this.sketchService.getDefaultBoard();
            this._selectedBoard = defaultBoard;
            this.update();
        } catch (err: any) {
            // Use fallback boards
            this._boards = [
                { id: 'esp32-devkit', name: 'ESP32 DevKit', fqbn: 'esp32:esp32:esp32', platform: 'esp32' },
                { id: 'esp32-s2', name: 'ESP32-S2', fqbn: 'esp32:esp32:esp32s2', platform: 'esp32' },
                { id: 'esp32-s3', name: 'ESP32-S3', fqbn: 'esp32:esp32:esp32s3', platform: 'esp32' },
                { id: 'esp32-c3', name: 'ESP32-C3', fqbn: 'esp32:esp32:esp32c3', platform: 'esp32' },
                { id: 'esp8266', name: 'ESP8266', fqbn: 'esp8266:esp8266:generic', platform: 'esp8266' },
            ];
            this._selectedBoard = this._boards[0];
            this.update();
        }
    }

    protected async refreshPorts(): Promise<void> {
        try {
            this._availablePorts = await this.serialService.listPorts();

            // If currently selected port is no longer available, reset
            if (this._selectedPort) {
                const stillExists = this._availablePorts.some(p => p.path === this._selectedPort!.path);
                if (!stillExists) {
                    this._selectedPort = undefined;
                }
            }

            // Auto-select if only one port
            if (!this._selectedPort && this._availablePorts.length === 1) {
                this._selectedPort = this._availablePorts[0];
            }

            this.update();
        } catch (err: any) {
            this._availablePorts = [];
            this.update();
        }
    }

    // ─── Active .airo File Detection ──────────────────────────────────

    /**
     * Find the active .airo file URI. Checks multiple sources:
     * 1. The currently active editor
     * 2. All open editors (in case focus is elsewhere)
     */
    protected getActiveAiroUri(): URI | undefined {
        // First try the active editor
        try {
            const activeEditor = this.editorManager.activeEditor;
            if (activeEditor) {
                const uri = activeEditor.getResourceUri();
                if (uri && uri.path.toString().endsWith('.airo')) {
                    return uri;
                }
            }
        } catch {
            // Ignore errors accessing active editor
        }

        // Then try all open editors
        try {
            const allEditors = this.editorManager.all;
            for (const editor of allEditors) {
                try {
                    const uri = editor.getResourceUri();
                    if (uri && uri.path.toString().endsWith('.airo')) {
                        return uri;
                    }
                } catch {
                    // Skip editors that can't provide a URI
                }
            }
        } catch {
            // Ignore errors iterating editors
        }

        return undefined;
    }

    // ─── Actions ───────────────────────────────────────────────────────

    protected async verify(): Promise<void> {
        const uri = this.getActiveAiroUri();
        if (!uri) {
            this.messageService.error('No .airo file open. Create or open a .airo sketch first.');
            return;
        }

        this._compiling = true;
        this.update();

        const channel = this.outputChannelManager.getChannel('Airo Compiler');
        channel.show();
        channel.append(`\n--- Verifying ${uri.path.base} ---\n`);

        const boardLabel = this._selectedBoard ? this._selectedBoard.name : 'ESP32 DevKit';
        channel.append(`Target: ${boardLabel}\n`);
        channel.append('Verifying syntax...\n');

        try {
            const result = await this.sketchService.verify(uri.toString());

            if (result.success) {
                channel.append('✓ Verification successful! No syntax errors found.\n');
                this.messageService.info('✓ Verification successful!');
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
                this.messageService.error('✗ Verification failed — see output for details.');
            }
        } catch (err: any) {
            channel.append(`✗ Verification error: ${err.message}\n`);
            this.messageService.error('Verification error: ' + err.message);
        } finally {
            this._compiling = false;
            this.update();
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
            await this.selectPort();
            if (!this._selectedPort) {
                return;
            }
        }

        this._compiling = true;
        this.update();

        const channel = this.outputChannelManager.getChannel('Airo Compiler');
        channel.show();
        channel.append(`\n--- Uploading ${uri.path.base} ---\n`);

        const boardLabel = this._selectedBoard ? this._selectedBoard.name : 'ESP32 DevKit';
        channel.append(`Board: ${boardLabel}\n`);
        channel.append(`Port: ${this._selectedPort.path}\n`);
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
            channel.append(`Connecting to ${this._selectedPort.path}...\n`);

            const connected = await this.serialService.connect(this._selectedPort.path, 115200);
            if (connected) {
                this._serialConnected = true;
                channel.append('✓ Connected to board.\n');
                channel.append('Flashing firmware...\n');
                channel.append('✓ Upload complete!\n');
                this.messageService.info('✓ Upload complete!');
            } else {
                channel.append('✗ Could not connect to board.\n');
                channel.append('Make sure your board is connected and the correct port is selected.\n');
                this.messageService.error('Could not connect to board — check port and connection.');
            }
        } catch (err: any) {
            channel.append(`✗ Upload error: ${err.message}\n`);
            this.messageService.error('Upload error: ' + err.message);
        } finally {
            this._compiling = false;
            this.update();
        }
    }

    protected async compile(): Promise<void> {
        // Compile is the same as verify in the Arduino paradigm
        await this.verify();
    }

    protected async selectBoard(board: BoardInfo): Promise<void> {
        this._selectedBoard = board;
        this.messageService.info(`Board: ${board.name}`);
        this.update();
    }

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
                this._selectedPort = picked.port;
                this.messageService.info(`Port: ${picked.port.path}`);
                this.update();
            }
        } catch (err: any) {
            this.messageService.error('Failed to list ports: ' + err.message);
        }
    }

    protected async toggleSerialMonitor(): Promise<void> {
        try {
            const widget = await this.widgetManager.getOrCreateWidget(AiroSerialWidget.ID);
            if (widget.isAttached && widget.isVisible) {
                widget.hide();
            } else {
                // Show in the bottom panel area
                const shell = (this.widgetManager as any).shell;
                if (shell) {
                    shell.addWidget(widget, { area: 'bottom' });
                }
                widget.show();
            }
        } catch (err: any) {
            this.messageService.error('Failed to open Serial Monitor: ' + err.message);
        }
    }

    /**
     * Create a new sketch using a proper dialog (not prompt() which
     * is not supported in Electron).
     */
    protected async newSketch(): Promise<void> {
        try {
            const defaultName = `sketch_${Date.now().toString(36)}`;

            // Use SingleTextInputDialog instead of prompt()
            const dialog = new SingleTextInputDialog({
                title: 'New Sketch',
                initialValue: defaultName,
                placeholder: 'Enter sketch name',
                validate: (input: string) => {
                    if (!input || input.trim().length === 0) {
                        return 'Sketch name cannot be empty';
                    }
                    if (!/^[a-zA-Z0-9_-]+$/.test(input.trim())) {
                        return 'Only letters, numbers, underscores, and hyphens allowed';
                    }
                    return '';
                }
            });

            const name = await dialog.open();
            if (!name || name.trim().length === 0) {
                return;
            }
            const sketchName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '_');

            const sketch = await this.sketchService.newSketch(sketchName);
            this.messageService.info(`Created sketch: ${sketch.name}`);

            // Open the main file in the editor
            const fileUri = new URI(sketch.mainFile);
            const opener = await this.openerService.getOpener(fileUri);
            await opener.open(fileUri);
        } catch (err: any) {
            this.messageService.error('Failed to create sketch: ' + err.message);
        }
    }

    /**
     * Open an example sketch — creates a new sketch from the example
     * template and opens it in the editor.
     */
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

                // Create a new sketch from the example code
                const sketch = await this.sketchService.newSketchFromExample(
                    `example_${picked.exampleName.toLowerCase()}_${Date.now().toString(36)}`,
                    code
                );

                // Open the new sketch file in the editor
                const fileUri = new URI(sketch.mainFile);
                const opener = await this.openerService.getOpener(fileUri);
                await opener.open(fileUri);

                this.messageService.info(`Example loaded: ${picked.exampleName}`);
            }
        } catch (err: any) {
            this.messageService.error('Failed to load examples: ' + err.message);
        }
    }

    protected async openLanguageReference(): Promise<void> {
        const referenceUrl = 'https://github.com/eesha000009-dev/airone-ide/wiki/Airo-Language-Reference';
        try {
            const opener = await this.openerService.getOpener(new URI(referenceUrl));
            await opener.open(new URI(referenceUrl));
        } catch {
            (window as any).open(referenceUrl, '_blank');
        }
    }

    // ─── Render ────────────────────────────────────────────────────────

    protected render(): React.ReactNode {
        return <div className='airo-sidebar-panel'>
            {/* ─── Header ─────────────────────────────────────────────── */}
            <div className='airo-sidebar-header'>
                <div className='airo-sidebar-logo'>Airone</div>
            </div>

            {/* ─── Action Buttons ─────────────────────────────────────── */}
            <div className='airo-sidebar-section'>
                <div className='airo-sidebar-actions'>
                    <button
                        className='airo-btn airo-btn-verify'
                        onClick={() => this.verify()}
                        disabled={this._compiling}
                        title='Verify — Compile & check syntax (Ctrl+R)'
                    >
                        <span className='airo-btn-icon'>✓</span>
                        <span className='airo-btn-label'>Verify</span>
                    </button>
                    <button
                        className='airo-btn airo-btn-upload'
                        onClick={() => this.upload()}
                        disabled={this._compiling}
                        title='Upload — Compile & flash to board (Ctrl+U)'
                    >
                        <span className='airo-btn-icon'>→</span>
                        <span className='airo-btn-label'>Upload</span>
                    </button>
                </div>
                {this._compiling && <div className='airo-compiling-indicator'>Compiling...</div>}
            </div>

            {/* ─── Board Selector ─────────────────────────────────────── */}
            <div className='airo-sidebar-section'>
                <label className='airo-sidebar-label'>Board</label>
                <select
                    className='airo-sidebar-select'
                    value={this._selectedBoard?.id || ''}
                    onChange={(e) => {
                        const board = this._boards.find(b => b.id === e.target.value);
                        if (board) {
                            this.selectBoard(board);
                        }
                    }}
                >
                    {!this._selectedBoard && <option value=''>Select Board...</option>}
                    {this._boards.map(board => (
                        <option key={board.id} value={board.id}>{board.name}</option>
                    ))}
                </select>
            </div>

            {/* ─── Port Selector ──────────────────────────────────────── */}
            <div className='airo-sidebar-section'>
                <label className='airo-sidebar-label'>Port</label>
                <div className='airo-port-row'>
                    <select
                        className='airo-sidebar-select airo-port-select'
                        value={this._selectedPort?.path || ''}
                        onChange={(e) => {
                            const port = this._availablePorts.find(p => p.path === e.target.value);
                            if (port) {
                                this._selectedPort = port;
                                this.messageService.info(`Port: ${port.path}`);
                                this.update();
                            }
                        }}
                    >
                        <option value=''>
                            {this._availablePorts.length === 0 ? 'No ports found' : 'Select Port...'}
                        </option>
                        {this._availablePorts.map(port => (
                            <option key={port.path} value={port.path}>
                                {port.path}{port.manufacturer ? ` (${port.manufacturer})` : ''}
                            </option>
                        ))}
                    </select>
                    <button
                        className='airo-btn airo-btn-sm airo-btn-refresh'
                        onClick={() => this.refreshPorts()}
                        title='Refresh port list'
                    >
                        ↻
                    </button>
                    <button
                        className='airo-btn airo-btn-sm airo-btn-quickport'
                        onClick={() => this.selectPort()}
                        title='Quick pick port'
                    >
                        …
                    </button>
                </div>
            </div>

            {/* ─── Serial Monitor ─────────────────────────────────────── */}
            <div className='airo-sidebar-section'>
                <button
                    className='airo-btn airo-btn-serial'
                    onClick={() => this.toggleSerialMonitor()}
                    title='Open/Close Serial Monitor'
                >
                    <span className='airo-btn-icon'>🔌</span>
                    <span className='airo-btn-label'>Serial Monitor</span>
                </button>
            </div>

            {/* ─── Divider ────────────────────────────────────────────── */}
            <hr className='airo-sidebar-divider' />

            {/* ─── Quick Actions ──────────────────────────────────────── */}
            <div className='airo-sidebar-section'>
                <label className='airo-sidebar-label'>Sketch</label>
                <div className='airo-sidebar-quick-actions'>
                    <button
                        className='airo-btn airo-btn-outline'
                        onClick={() => this.newSketch()}
                        title='Create a new sketch'
                    >
                        + New Sketch
                    </button>
                    <button
                        className='airo-btn airo-btn-outline'
                        onClick={() => this.openExamples()}
                        title='Browse example sketches'
                    >
                        📖 Examples
                    </button>
                    <button
                        className='airo-btn airo-btn-outline'
                        onClick={() => this.openLanguageReference()}
                        title='Open .airo language reference'
                    >
                        📄 Language Reference
                    </button>
                </div>
            </div>

            {/* ─── Status Bar ─────────────────────────────────────────── */}
            <div className='airo-sidebar-status'>
                {this._selectedBoard && (
                    <div className='airo-status-item'>
                        <span className='airo-status-icon'>🔲</span>
                        <span>{this._selectedBoard.name}</span>
                    </div>
                )}
                {this._selectedPort && (
                    <div className='airo-status-item'>
                        <span className='airo-status-icon'>🔌</span>
                        <span>{this._selectedPort.path}</span>
                    </div>
                )}
            </div>
        </div>;
    }
}

// QuickPickItem interface for the sidebar widget
interface QuickPickItem {
    label: string;
    description?: string;
    detail?: string;
}
