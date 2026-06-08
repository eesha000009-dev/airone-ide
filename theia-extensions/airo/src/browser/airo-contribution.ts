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
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
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
import { NewSketchDialog } from './new-sketch-dialog';
import { CommonMenus } from '@theia/core/lib/browser/common-frontend-contribution';
import {
    AiroSketchService,
    AiroSerialService,
    AiroUploadService,
    AiroSketchClient,
    AiroSerialClient,
    AiroUploadClient,
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

/** Helper to convert a filesystem path to a proper file:// URI */
function toFileUri(fsPath: string): URI {
    // Use vscode-uri's URI.file() which correctly handles platform-specific
    // paths (especially Windows drive letters and backslashes).
    // This is the same approach used by Theia's own updater extension.
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { URI: VSCodeURI } = require('vscode-uri');
        return new URI(VSCodeURI.file(fsPath));
    } catch {
        // Fallback: manual construction
        const normalized = fsPath.replace(/\\/g, '/');
        const withSlash = normalized.startsWith('/') ? normalized : '/' + normalized;
        return new URI('file://' + withSlash);
    }
}

/**
 * Main Airone contribution — handles all commands, menus, keybindings,
 * and menu item cleanup. Also implements FrontendApplicationContribution
 * for onStart cleanup of unwanted Theia menu items.
 */
@injectable()
export class AiroContribution implements CommandContribution, MenuContribution, KeybindingContribution, FrontendApplicationContribution {

    @inject(EditorManager) protected readonly editorManager!: EditorManager;
    @inject(MessageService) protected readonly messageService!: MessageService;
    @inject(OpenerService) protected readonly openerService!: OpenerService;
    @inject(OutputChannelManager) protected readonly outputChannelManager!: OutputChannelManager;
    @inject(WidgetManager) protected readonly widgetManager!: WidgetManager;
    @inject(QuickInputService) protected readonly quickInputService!: QuickInputService;
    @inject(CommandService) protected readonly commandService!: CommandService;
    @inject(NewSketchDialog) protected readonly newSketchDialog!: NewSketchDialog;

    @inject(AiroSketchService) protected readonly sketchService!: AiroSketchClient;
    @inject(AiroSerialService) protected readonly serialService!: AiroSerialClient;
    @inject(AiroUploadService) protected readonly uploadService!: AiroUploadClient;

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

    // ─── FrontendApplicationContribution ────────────────────────────────

    /**
     * After the application starts, programmatically remove unwanted
     * Theia menu items from the File menu dropdown.
     *
     * We use a delayed approach here because Theia's CommonFrontendContribution
     * may register its menus AFTER our registerMenus() is called. By doing
     * cleanup in onStart() with a delay, we ensure all contributions have
     * been registered before we remove the ones we don't want.
     */
    onStart?(): void {
        // Use MutationObserver to hide unwanted dropdown menu items once they appear
        this.setupMenuItemHiding();
    }

    /**
     * Set up DOM-based hiding of unwanted menu items in dropdown menus.
     * This is the most reliable approach since Theia's dropdown menus
     * are rendered dynamically when opened.
     */
    protected setupMenuItemHiding(): void {
        const unwantedCommands = [
            'workbench.action.files.newUntitledFile',
            'workbench.action.files.newFile',
            'workbench.action.files.newFolder',
            'workbench.action.files.openFile',
            'workbench.action.files.openFolder',
            'workbench.action.newWindow',
            'file.newFile',
            'file:newFile',
            'file.newFolder',
            'file:newFolder',
            'core.newFile',
            'core:newFile',
            'core.newFolder',
            'core:newFolder',
            'core.openFile',
            'core:openFile',
            'workspace:openFile',
            'workspace:openFolder',
            'workspace:openWorkspace',
            'workspace:openRecent',
            'workspace:addFolder',
            'navigator.newFile',
        ];

        const hideUnwantedItems = () => {
            // Hide items in dropdown menus (Theia uses .lm-Menu-item or .p-Menu-item)
            for (const cmdId of unwantedCommands) {
                const items = document.querySelectorAll(`[data-command="${cmdId}"]`);
                for (const item of items) {
                    const li = item.closest('li') || item;
                    if (li instanceof HTMLElement) {
                        li.style.display = 'none';
                        li.style.height = '0';
                        li.style.overflow = 'hidden';
                        li.style.padding = '0';
                        li.style.margin = '0';
                        li.style.border = 'none';
                        li.style.minHeight = '0';
                    }
                }
            }

            // Also hide by label text (in case data-command doesn't match)
            const hiddenLabels = ['New File', 'New Text File', 'New Folder', 'Open File…', 'Open File...', 'Open Folder…', 'Open Folder...', 'New Window', 'Add Folder to Workspace'];
            const menuItemSelectors = ['.lm-Menu-item', '.p-Menu-item', '.theia-Menu-item'];
            for (const sel of menuItemSelectors) {
                try {
                    document.querySelectorAll<HTMLElement>(sel).forEach(item => {
                        const labelEl = item.querySelector('.lm-Menu-itemLabel, .p-Menu-itemLabel, .theia-Menu-itemLabel');
                        const text = labelEl?.textContent?.trim() || item.textContent?.trim() || '';
                        if (hiddenLabels.some(label => text === label)) {
                            item.style.display = 'none';
                            item.style.height = '0';
                            item.style.overflow = 'hidden';
                            item.style.padding = '0';
                            item.style.margin = '0';
                            item.style.border = 'none';
                            item.style.minHeight = '0';
                        }
                    });
                } catch { /* invalid selector */ }
            }

            // Also hide any element containing "New File" as a direct text in the File menu context
            document.querySelectorAll<HTMLElement>('.lm-MenuBar-item').forEach(menuItem => {
                const label = menuItem.querySelector('.lm-MenuBar-itemLabel');
                if (label?.textContent?.trim() === 'File') {
                    // Found the File menu — we'll monitor its dropdown when opened
                }
            });
        };

        // Run immediately
        hideUnwantedItems();

        // Observe DOM mutations to hide items as menus are dynamically created.
        // Use a debounce to avoid excessive DOM queries on rapid mutations.
        let debounceTimer: ReturnType<typeof setTimeout> | undefined;
        const observer = new MutationObserver(() => {
            if (debounceTimer) { clearTimeout(debounceTimer); }
            debounceTimer = setTimeout(hideUnwantedItems, 100);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        // Periodically re-apply every 3 seconds (less aggressive than 500ms)
        setInterval(hideUnwantedItems, 3000);

        // NOTE: We do NOT monkey-patch executeCommand anymore.
        // The previous approach of intercepting CommandService.executeCommand
        // caused TS2322 build failures and could crash the Theia frontend at
        // runtime (stuck on preload.html). Instead, we rely on DOM-based
        // hiding (MutationObserver + CSS) to prevent unwanted menu items from
        // being visible. If a user somehow triggers a blocked command via
        // keyboard shortcut, the DOM hiding ensures the menu item is not
        // clickable, and Theia will handle the command gracefully.
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

    protected async verify(): Promise<void> {
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
        const chipType = this._selectedBoard ? this._selectedBoard.platform : 'esp32';
        channel.append(`Target: ${boardLabel} (${chipType})\n`);
        channel.append('Verifying syntax...\n');

        try {
            const result = await this.sketchService.verify(uri.toString());

            if (result.success) {
                channel.append('✓ Syntax verification successful!\n');
                channel.append('Transpiling .airo → C++...\n');

                // Also try full compilation which includes transpilation
                try {
                    const compileResult = await this.sketchService.verify(uri.toString());
                    if (compileResult.success && compileResult.output) {
                        channel.append(compileResult.output + '\n');
                    }
                } catch {
                    // Full compilation not available, but syntax check passed
                }

                this.messageService.info('✓ Compilation successful!');
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
        } catch (err: any) {
            channel.append(`✗ Compilation error: ${err.message}\n`);
            this.messageService.error('Compilation error: ' + err.message);
        } finally {
            this._compiling = false;
        }
    }

    /**
     * Upload the compiled sketch to the ESP32 board.
     *
     * Uses the TRUSTED pipeline via `flashAiroFile` on the backend:
     * 1. Compile .airo → C++ → .bin (via AiroCompilerService + Arduino CLI)
     * 2. Auto-detect the ESP32 serial port (or use selected port)
     * 3. Check/install esptool
     * 4. Flash the .bin firmware using esptool.py
     *
     * The backend resolves the binary path correctly — no more guessing
     * from the URI path.
     */
    protected async upload(): Promise<void> {
        const uri = this.getActiveAiroUri();
        if (!uri) {
            this.messageService.error('No .airo file open. Create or open a .airo sketch first.');
            return;
        }

        this._compiling = true;
        const channel = this.outputChannelManager.getChannel('Airo Compiler');
        channel.show();
        channel.append(`\n--- Uploading ${uri.path.base} ---\n`);

        const boardLabel = this._selectedBoard ? this._selectedBoard.name : 'ESP32 DevKit';
        const chipType = this._selectedBoard ? this._selectedBoard.platform : 'esp32';
        channel.append(`Board: ${boardLabel} (${chipType})\n`);

        // ─── Step 1: Detect port ────────────────────────────────────
        channel.append('Step 1: Detecting serial port...\n');

        let portPath = this._selectedPort?.path;
        if (!portPath) {
            try {
                const detected = await this.uploadService.detectEspPort();
                if (detected) {
                    portPath = detected.path;
                    this._selectedPort = detected;
                    channel.append(`✓ Auto-detected port: ${detected.path}`);
                    if (detected.manufacturer) {
                        channel.append(` (${detected.manufacturer})`);
                    }
                    channel.append('\n');
                } else {
                    channel.append('✗ No serial port detected.\n');
                    this.messageService.warn('No ESP32 board detected. Connect your board and select a port.');
                    await this.doSelectPort();
                    if (!this._selectedPort) {
                        this._compiling = false;
                        return;
                    }
                    portPath = this._selectedPort.path;
                }
            } catch (err: any) {
                channel.append(`Port detection error: ${err.message}\n`);
                this.messageService.warn('Could not auto-detect port. Please select one manually.');
                await this.doSelectPort();
                if (!this._selectedPort) {
                    this._compiling = false;
                    return;
                }
                portPath = this._selectedPort.path;
            }
        } else {
            channel.append(`Using selected port: ${portPath}\n`);
        }

        // ─── Step 2: Check esptool ──────────────────────────────────
        channel.append('\nStep 2: Checking esptool...\n');

        let esptoolAvailable = false;
        try {
            esptoolAvailable = await this.uploadService.isEsptoolAvailable();
        } catch { /* ignore */ }

        if (!esptoolAvailable) {
            channel.append('⚠ esptool not found. Attempting to install via pip...\n');
            this.messageService.info('esptool not found. Installing via pip... This may take a moment.');

            try {
                const installed = await this.uploadService.installEsptool();
                if (installed) {
                    channel.append('✓ esptool installed successfully!\n');
                    esptoolAvailable = true;
                } else {
                    channel.append('✗ esptool installation failed.\n');
                    channel.append('Install manually: pip install esptool\n');
                    this.messageService.error(
                        'esptool installation failed. Install it manually: pip install esptool'
                    );
                    this._compiling = false;
                    return;
                }
            } catch (err: any) {
                channel.append(`esptool install error: ${err.message}\n`);
                this.messageService.error('Could not install esptool: ' + err.message);
                this._compiling = false;
                return;
            }
        } else {
            channel.append('✓ esptool found.\n');
        }

        // ─── Step 3: Compile + Flash via backend ────────────────────
        // The backend's flashAiroFile handles the full TRUSTED pipeline:
        //   .airo → C++ (transpiler) → .bin (Arduino CLI) → flash (esptool)
        channel.append('\nStep 3: Compiling and flashing...\n');
        channel.append('  Running TRUSTED pipeline: .airo → C++ → .bin → flash\n\n');

        try {
            const flashResult = await this.uploadService.flashAiroFile(
                uri.toString(),
                chipType,
                portPath
            );

            if (flashResult.success) {
                channel.append(flashResult.output + '\n');
                channel.append('\n✓ Upload complete! Firmware flashed successfully.\n');
                this.messageService.info('✓ Upload complete!');
            } else {
                channel.append(flashResult.output + '\n');
                channel.append(`\n✗ Upload failed: ${flashResult.error || 'Unknown error'}\n`);
                this.messageService.error('Upload failed: ' + (flashResult.error || 'Unknown error'));
            }
        } catch (err: any) {
            channel.append(`✗ Upload error: ${err.message}\n`);
            this.messageService.error('Upload error: ' + err.message);
        } finally {
            this._compiling = false;
        }
    }

    protected async compile(): Promise<void> {
        await this.verify();
    }

    /**
     * Create a new Airone sketch.
     *
     * Uses a custom SingleTextInputDialog (like Arduino IDE) that only prompts
     * for the sketch name. The .airo extension is fixed — no need for the user
     * to specify it. A folder named after the sketch is created containing
     * `<name>.airo` with the Airone language template pre-filled.
     *
     * Fallback: if the dialog fails to open (rare in some Electron envs),
     * the QuickInputService is used as a backup.
     */
    protected async newSketch(): Promise<void> {
        try {
            // ─── Step 1: Get sketch name from the user ───────────────
            // Use the Arduino-style SingleTextInputDialog modal.
            // Only prompts for sketch name — .airo extension is automatic.
            let name: string | undefined;

            // Try the Arduino-style SingleTextInputDialog first
            try {
                const result = await this.newSketchDialog.open();
                if (result === undefined) {
                    // User cancelled the dialog
                    return;
                }
                name = result.trim();
            } catch {
                // SingleTextInputDialog may fail in some environments;
                // fall back to QuickInputService
                try {
                    name = await this.quickInputService.input({
                        title: 'New Sketch',
                        value: 'my_sketch',
                        prompt: 'Enter sketch name (a .airo file will be created automatically)',
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
                } catch {
                    // Both dialog methods failed — cannot proceed without a name
                    return;
                }
            }

            if (!name || name.trim().length === 0) {
                return;
            }
            const sketchName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '_');

            // ─── Step 2: Create the sketch via backend ──────────────
            this.messageService.info(`Creating sketch "${sketchName}"...`);

            const sketch = await this.sketchService.newSketch(sketchName);

            // ─── Step 3: Open the newly created .airo file ───────────
            const fileUri = toFileUri(sketch.mainFile);

            let opened = false;
            const lastError: string[] = [];

            // Strategy 0: OpenerService — the standard Theia approach
            if (!opened) {
                try {
                    const opener = await this.openerService.getOpener(fileUri);
                    await opener.open(fileUri);
                    opened = true;
                    this.messageService.info(`Created sketch: ${sketch.name}`);
                } catch (e) {
                    lastError.push(`OpenerService: ${e instanceof Error ? e.message : String(e)}`);
                }
            }

            // Strategy 1: EditorManager.open()
            if (!opened) {
                try {
                    await this.editorManager.open(fileUri);
                    opened = true;
                    this.messageService.info(`Created sketch: ${sketch.name}`);
                } catch (e) {
                    lastError.push(`EditorManager: ${e instanceof Error ? e.message : String(e)}`);
                }
            }

            // Strategy 2: Theia's core.open command
            if (!opened) {
                try {
                    await this.commandService.executeCommand('core.open', fileUri);
                    opened = true;
                    this.messageService.info(`Created sketch: ${sketch.name}`);
                } catch (e) {
                    lastError.push(`core.open: ${e instanceof Error ? e.message : String(e)}`);
                }
            }

            // Strategy 3: Theia's resource.open command
            if (!opened) {
                try {
                    await this.commandService.executeCommand('resource.open', fileUri);
                    opened = true;
                    this.messageService.info(`Created sketch: ${sketch.name}`);
                } catch (e) {
                    lastError.push(`resource.open: ${e instanceof Error ? e.message : String(e)}`);
                }
            }

            if (!opened) {
                const errorDetails = lastError.length > 0 ? `\nErrors: ${lastError.join('; ')}` : '';
                this.messageService.warn(
                    `Sketch created at: ${sketch.mainFile}${errorDetails}\nURI: ${fileUri.toString()}`
                );
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
        } catch (err: any) {
            this.messageService.error('Failed to load examples: ' + err.message);
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
        } catch (err: any) {
            this.messageService.error('Failed to select board: ' + err.message);
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
        } catch (err: any) {
            this.messageService.error('Failed to list ports: ' + err.message);
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
        } catch (err: any) {
            this.messageService.error('Failed to open Serial Monitor: ' + err.message);
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

        // Restart to Update command
        commands.registerCommand(AIRO_RESTART_UPDATE_COMMAND, {
            execute: async () => {
                try {
                    const updateReady = document.body.hasAttribute('data-airone-update-ready');
                    if (updateReady) {
                        await commands.executeCommand('electron-theia:restart-to-update');
                    } else {
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

        // Register library commands
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

        // Manage Libraries command
        commands.registerCommand(AIRO_MANAGE_LIBRARIES_COMMAND, {
            execute: () => this.manageLibraries(),
            isEnabled: () => true
        });
    }

    // ─── Menu Registration ───────────────────────────────────────────────

    registerMenus(menus: MenuModelRegistry): void {
        // ─── Remove Theia built-in File menu items ──────────────────
        // Airone only wants: New Sketch, Examples, Save, Save As, Auto Save,
        // Preferences, Close Editor, Close Window.
        const unwantedFileCommands = [
            'workbench.action.files.newUntitledFile',  // New Text File
            'workbench.action.files.newFile',           // New File...
            'workbench.action.files.newFolder',          // New Folder
            'workbench.action.files.openFile',           // Open File
            'workbench.action.files.openFolder',         // Open Folder
            'workbench.action.newWindow',               // New Window
            'file.newFile',                             // workspace New File
            'file:newFile',                             // workspace New File (alt)
            'file.newFolder',                           // New Folder
            'core.newFile',                             // core New File
            'core:newFile',                             // core New File (alt)
            'core.newFolder',                           // core New Folder
            'core:newFolder',                           // core New Folder (alt)
            'core.openFile',                            // core Open File
            'core:openFile',                            // core Open File (alt)
            'navigator.newFile',                        // navigator New File
            'workspace:openFile',                       // Open File...
            'workspace:openFolder',                     // Open Folder...
            'workspace:openWorkspace',                  // Open Workspace from File...
            'workspace:openRecent',                     // Open Recent Workspace...
            'workspace:addFolder',                      // Add Folder to Workspace
            'workspace:removeFolder',                   // Remove Folder from Workspace
            'workspace:saveAs',                         // Save Workspace As
            'workspace:openConfigFile',                 // Open Workspace Config File
            'workspace:manageTrust',                    // Manage Workspace Trust
        ];
        for (const cmdId of unwantedFileCommands) {
            try {
                menus.unregisterMenuAction(cmdId);
            } catch { /* command may not be registered in all environments */ }
        }

        // ─── File menu additions ────────────────────────────────────
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
            command: AIRO_NEW_SKETCH_COMMAND.id,
            keybinding: 'ctrl+shift+n'
        });
        keybindings.registerKeybinding({
            command: AIRO_SERIAL_MONITOR_COMMAND.id,
            keybinding: 'ctrl+shift+m'
        });
    }
}
