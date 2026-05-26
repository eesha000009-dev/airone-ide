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
import { EditorManager } from '@theia/editor/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';
import { OpenerService } from '@theia/core/lib/browser/opener-service';
import { URI } from '@theia/core/lib/common/uri';

// ─── Menu Paths ──────────────────────────────────────────────────────────────

export const AIRONE_MENU: MenuPath = ['airone_menu'];

// ─── Commands ────────────────────────────────────────────────────────────────

export const AIRO_VERIFY_COMMAND: Command = {
    id: 'airo.verify',
    label: 'Verify',
};

export const AIRO_UPLOAD_COMMAND: Command = {
    id: 'airo.upload',
    label: 'Upload',
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

/**
 * Command contribution for the Airone menu and keybindings.
 *
 * The main UI for Verify/Upload/Board/Port/Serial is now in AiroSidebarWidget.
 * This contribution handles the menu entries and keyboard shortcuts only.
 */
@injectable()
export class AiroContribution implements CommandContribution, MenuContribution, KeybindingContribution {

    @inject(EditorManager) protected readonly editorManager!: EditorManager;
    @inject(MessageService) protected readonly messageService!: MessageService;
    @inject(OpenerService) protected readonly openerService!: OpenerService;

    // ─── Command Registration ────────────────────────────────────────────

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(AIRO_VERIFY_COMMAND, {
            execute: () => commands.executeCommand('airo.verify.fromSidebar'),
            isVisible: () => this.isAiroActive(),
            isEnabled: () => true
        });
        commands.registerCommand(AIRO_UPLOAD_COMMAND, {
            execute: () => commands.executeCommand('airo.upload.fromSidebar'),
            isVisible: () => this.isAiroActive(),
            isEnabled: () => true
        });
        commands.registerCommand(AIRO_NEW_SKETCH_COMMAND, {
            execute: () => commands.executeCommand('airo.newSketch.fromSidebar'),
            isVisible: () => true,
            isEnabled: () => true
        });
        commands.registerCommand(AIRO_EXAMPLES_COMMAND, {
            execute: () => commands.executeCommand('airo.examples.fromSidebar'),
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

    // ─── Helpers ─────────────────────────────────────────────────────────

    /** Open .airo language reference */
    protected async openLanguageReference(): Promise<void> {
        const referenceUrl = 'https://github.com/eesha000009-dev/airone-ide/wiki/Airo-Language-Reference';
        try {
            const opener = await this.openerService.getOpener(new URI(referenceUrl));
            await opener.open(new URI(referenceUrl));
        } catch {
            (window as any).open(referenceUrl, '_blank');
        }
    }

    /** Check if the currently active editor has a .airo file */
    protected isAiroActive(): boolean {
        const editor = this.editorManager.activeEditor;
        if (!editor) {
            return false;
        }
        const uri = editor.getResourceUri();
        return !!uri && uri.path.toString().endsWith('.airo');
    }
}
