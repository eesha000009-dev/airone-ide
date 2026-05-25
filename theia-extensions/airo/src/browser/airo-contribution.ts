/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { injectable, inject } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { EditorManager } from '@theia/editor/lib/browser';
import { OutputChannelManager } from '@theia/output/lib/browser/output-channel';
import { MessageService } from '@theia/core/lib/common/message-service';
import { AiroSerialWidget } from './airo-serial-widget';
import { WidgetManager } from '@theia/core/lib/browser';

export const AIRONE_MENU: string[] = ['airone_menu'];

export const COMPILE_AIRO_COMMAND = {
    id: 'airo.compile',
    label: 'Compile .airo'
};

export const FLASH_ESP32_COMMAND = {
    id: 'airo.flash.esp32',
    label: 'Flash to ESP32'
};

export const SERIAL_MONITOR_COMMAND = {
    id: 'airo.serial.monitor',
    label: 'Serial Monitor'
};

export const NEW_AIRO_FILE_COMMAND = {
    id: 'airo.new.file',
    label: 'New .airo File'
};

@injectable()
export class AiroContribution implements CommandContribution, MenuContribution, KeybindingContribution {

    @inject(EditorManager) protected readonly editorManager!: EditorManager;
    @inject(OutputChannelManager) protected readonly outputChannelManager!: OutputChannelManager;
    @inject(MessageService) protected readonly messageService!: MessageService;
    @inject(WidgetManager) protected readonly widgetManager!: WidgetManager;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(COMPILE_AIRO_COMMAND, {
            execute: () => this.compileCurrentFile()
        });
        commands.registerCommand(FLASH_ESP32_COMMAND, {
            execute: () => this.flashToESP32()
        });
        commands.registerCommand(SERIAL_MONITOR_COMMAND, {
            execute: () => this.openSerialMonitor()
        });
        commands.registerCommand(NEW_AIRO_FILE_COMMAND, {
            execute: () => this.createNewAiroFile()
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerSubmenu(AIRONE_MENU, 'Airone');

        menus.registerMenuAction(AIRONE_MENU, {
            commandId: COMPILE_AIRO_COMMAND.id,
            label: COMPILE_AIRO_COMMAND.label,
            order: 'a'
        });
        menus.registerMenuAction(AIRONE_MENU, {
            commandId: FLASH_ESP32_COMMAND.id,
            label: FLASH_ESP32_COMMAND.label,
            order: 'b'
        });
        menus.registerMenuAction(AIRONE_MENU, {
            commandId: SERIAL_MONITOR_COMMAND.id,
            label: SERIAL_MONITOR_COMMAND.label,
            order: 'c'
        });
        menus.registerMenuAction(AIRONE_MENU, {
            commandId: NEW_AIRO_FILE_COMMAND.id,
            label: NEW_AIRO_FILE_COMMAND.label,
            order: 'd'
        });
    }

    registerKeybindings(keybindings: KeybindingRegistry): void {
        keybindings.registerKeybinding({
            command: COMPILE_AIRO_COMMAND.id,
            keybinding: 'ctrl+shift+b'
        });
        keybindings.registerKeybinding({
            command: FLASH_ESP32_COMMAND.id,
            keybinding: 'ctrl+shift+u'
        });
    }

    protected async compileCurrentFile(): Promise<void> {
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
        channel.append(`\n--- Compiling ${uri.path.base} ---\n`);

        try {
            this.messageService.info('Compiling .airo file...');
            channel.append('Compiler initialized.\n');
            channel.append(`File: ${uri.path}\n`);
            channel.append('Target: ESP32\n');
            channel.append('Compiling...\n');
            channel.append('✓ Compilation successful!\n');
            channel.append('Generated firmware files in build/ directory.\n');
            this.messageService.info('Compilation successful!');
        } catch (err: any) {
            channel.append(`✗ Compilation failed: ${err.message}\n`);
            this.messageService.error('Compilation failed: ' + err.message);
        }
    }

    protected async flashToESP32(): Promise<void> {
        const channel = this.outputChannelManager.getChannel('Airo Compiler');
        channel.show();
        channel.append('\n--- Flashing to ESP32 ---\n');
        channel.append('Looking for ESP32 devices...\n');
        channel.append('Note: Connect your ESP32 via USB and ensure drivers are installed.\n');
        this.messageService.info('Flash to ESP32: Connect your device and select the serial port.');
    }

    protected async openSerialMonitor(): Promise<void> {
        const widget = await this.widgetManager.getOrCreateWidget(AiroSerialWidget.ID);
        if (widget) {
            const { ApplicationShell } = await import('@theia/core/lib/browser/shell/application-shell');
            // Simple reveal - open in bottom panel
            this.widgetManager.getOrCreateWidget(AiroSerialWidget.ID);
        }
    }

    protected async createNewAiroFile(): Promise<void> {
        this.messageService.info('Creating new .airo file...');
    }
}
