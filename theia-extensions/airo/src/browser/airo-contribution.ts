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
import { CommonMenus } from '@theia/core/lib/browser/common-frontend-contribution';

// ─── Menu Paths ──────────────────────────────────────────────────────────────

export const AIRONE_MENU: MenuPath = ['airone_menu'];
export const AIRONE_COMPILE_MENU: MenuPath = [...CommonMenus.EDIT, '4_airone_compile'];
export const AIRONE_VERIFY_MENU: MenuPath = [...CommonMenus.EDIT, '5_airone_verify'];
export const AIRONE_UPLOAD_MENU: MenuPath = [...CommonMenus.EDIT, '6_airone_upload'];

// ─── Commands ────────────────────────────────────────────────────────────────

export const AIRO_COMPILE_COMMAND: Command = {
    id: 'airo.compile',
    label: 'Compile',
    category: 'Airone'
};

export const AIRO_VERIFY_COMMAND: Command = {
    id: 'airo.verify',
    label: 'Verify',
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

export const AIRO_LANGUAGE_REFERENCE_COMMAND: Command = {
    id: 'airo.languageReference',
    label: 'Language Reference',
    category: 'Airone'
};

/**
 * Command contribution for the Airone menu and keybindings.
 *
 * Adds Compile, Verify, Upload as top-level menus in the menu bar
 * alongside File, Edit, View.
 */
@injectable()
export class AiroContribution implements CommandContribution, MenuContribution, KeybindingContribution {

    @inject(EditorManager) protected readonly editorManager!: EditorManager;
    @inject(MessageService) protected readonly messageService!: MessageService;
    @inject(OpenerService) protected readonly openerService!: OpenerService;

    // ─── Command Registration ────────────────────────────────────────────

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(AIRO_COMPILE_COMMAND, {
            execute: () => commands.executeCommand('airo.verify.fromSidebar'),
            isEnabled: () => true
        });
        commands.registerCommand(AIRO_VERIFY_COMMAND, {
            execute: () => commands.executeCommand('airo.verify.fromSidebar'),
            isEnabled: () => true
        });
        commands.registerCommand(AIRO_UPLOAD_COMMAND, {
            execute: () => commands.executeCommand('airo.upload.fromSidebar'),
            isEnabled: () => true
        });
        commands.registerCommand(AIRO_NEW_SKETCH_COMMAND, {
            execute: () => commands.executeCommand('airo.newSketch.fromSidebar'),
            isEnabled: () => true
        });
        commands.registerCommand(AIRO_EXAMPLES_COMMAND, {
            execute: () => commands.executeCommand('airo.examples.fromSidebar'),
            isEnabled: () => true
        });
        commands.registerCommand(AIRO_LANGUAGE_REFERENCE_COMMAND, {
            execute: () => this.openLanguageReference(),
            isEnabled: () => true
        });
    }

    // ─── Menu Registration ───────────────────────────────────────────────

    registerMenus(menus: MenuModelRegistry): void {
        // ─── Top-level Compile menu ────────────────────────────────────
        menus.registerSubmenu(AIRONE_COMPILE_MENU, 'Compile');
        menus.registerMenuAction(AIRONE_COMPILE_MENU, {
            commandId: AIRO_COMPILE_COMMAND.id,
            label: 'Compile Sketch',
            order: 'a'
        });

        // ─── Top-level Verify menu ─────────────────────────────────────
        menus.registerSubmenu(AIRONE_VERIFY_MENU, 'Verify');
        menus.registerMenuAction(AIRONE_VERIFY_MENU, {
            commandId: AIRO_VERIFY_COMMAND.id,
            label: 'Verify Sketch (Ctrl+R)',
            order: 'a'
        });

        // ─── Top-level Upload menu ─────────────────────────────────────
        menus.registerSubmenu(AIRONE_UPLOAD_MENU, 'Upload');
        menus.registerMenuAction(AIRONE_UPLOAD_MENU, {
            commandId: AIRO_UPLOAD_COMMAND.id,
            label: 'Upload to Board (Ctrl+U)',
            order: 'a'
        });

        // ─── Airone submenu under File for new sketch / examples ───────
        menus.registerSubmenu(AIRONE_MENU, 'Airone');
        menus.registerMenuAction(AIRONE_MENU, {
            commandId: AIRO_NEW_SKETCH_COMMAND.id,
            label: 'New Sketch',
            order: 'a'
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
}
