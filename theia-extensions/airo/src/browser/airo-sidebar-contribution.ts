/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { injectable, inject } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { AiroSidebarWidget } from './airo-sidebar-widget';
import { CommandContribution, CommandRegistry, Command } from '@theia/core/lib/common/command';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';

export const AIRO_SIDEBAR_COMMAND: Command = {
    id: 'airo.showSidebar',
    label: 'Show Airone Panel',
    category: 'Airone'
};

/**
 * Commands that the sidebar widget exposes for other contributions to call.
 * These are the "fromSidebar" variants that the menu contributions forward to.
 */
export const AIRO_VERIFY_FROM_SIDEBAR: Command = {
    id: 'airo.verify.fromSidebar',
    label: 'Verify',
    category: 'Airone'
};

export const AIRO_UPLOAD_FROM_SIDEBAR: Command = {
    id: 'airo.upload.fromSidebar',
    label: 'Upload',
    category: 'Airone'
};

export const AIRO_NEW_SKETCH_FROM_SIDEBAR: Command = {
    id: 'airo.newSketch.fromSidebar',
    label: 'New Sketch',
    category: 'Airone'
};

export const AIRO_EXAMPLES_FROM_SIDEBAR: Command = {
    id: 'airo.examples.fromSidebar',
    label: 'Examples',
    category: 'Airone'
};

/**
 * Contribution that registers the Airone sidebar widget in the activity bar
 * and handles keyboard shortcuts.
 *
 * The sidebar provides Arduino-like controls:
 * - ✓ Verify (compile & check syntax)
 * - → Upload (compile & flash to board)
 * - Board selector
 * - Port selector
 * - Serial Monitor toggle
 */
@injectable()
export class AiroSidebarContribution extends AbstractViewContribution<AiroSidebarWidget>
    implements CommandContribution, KeybindingContribution {

    constructor() {
        super({
            widgetId: AiroSidebarWidget.ID,
            widgetName: AiroSidebarWidget.LABEL,
            defaultWidgetOptions: {
                area: 'left' as const,
                rank: 0  // Top position — appears first in the activity bar
            }
        });
    }

    /**
     * On application startup, open the Airone sidebar by default
     */
    async initializeLayout(): Promise<void> {
        await this.openView({ activate: false, reveal: true });
    }

    registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand(AIRO_SIDEBAR_COMMAND, {
            execute: () => this.openView({ activate: true, reveal: true })
        });

        // Register the "fromSidebar" commands that other contributions can call
        // These delegate to the sidebar widget's methods
        registry.registerCommand(AIRO_VERIFY_FROM_SIDEBAR, {
            execute: async () => {
                const widget = await this.widget;
                if (widget) {
                    (widget as any).verify();
                }
            }
        });
        registry.registerCommand(AIRO_UPLOAD_FROM_SIDEBAR, {
            execute: async () => {
                const widget = await this.widget;
                if (widget) {
                    (widget as any).upload();
                }
            }
        });
        registry.registerCommand(AIRO_NEW_SKETCH_FROM_SIDEBAR, {
            execute: async () => {
                const widget = await this.widget;
                if (widget) {
                    (widget as any).newSketch();
                }
            }
        });
        registry.registerCommand(AIRO_EXAMPLES_FROM_SIDEBAR, {
            execute: async () => {
                const widget = await this.widget;
                if (widget) {
                    (widget as any).openExamples();
                }
            }
        });
    }

    registerKeybindings(registry: KeybindingRegistry): void {
        registry.registerKeybinding({
            command: AIRO_SIDEBAR_COMMAND.id,
            keybinding: 'ctrl+shift+a'
        });
    }
}
