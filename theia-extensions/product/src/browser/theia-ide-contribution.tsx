/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { inject, injectable } from '@theia/core/shared/inversify';
import { CommonMenus } from '@theia/core/lib/browser/common-frontend-contribution';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { MenuContribution, MenuModelRegistry, MenuPath } from '@theia/core/lib/common/menu';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { ViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application';
import { WidgetManager } from '@theia/core/lib/browser';

export namespace TheiaIDEMenus {
    export const THEIA_IDE_HELP: MenuPath = [...CommonMenus.HELP, 'airone-ide'];
}

export namespace TheiaIDECommands {
    export const CATEGORY = 'AironeIDE';
    export const REPORT_ISSUE: Command = {
        id: 'airone-ide:report-issue',
        category: CATEGORY,
        label: 'Report Issue'
    };
    export const DOCUMENTATION: Command = {
        id: 'airone-ide:documentation',
        category: CATEGORY,
        label: 'Documentation'
    };

    // Rename Extensions → Libraries
    export const OPEN_LIBRARIES: Command = {
        id: 'airone-ide:open-libraries',
        category: CATEGORY,
        label: 'Libraries'
    };
}

/**
 * Contribution that renames the VS Code Extensions view label to "Libraries"
 * and adds Airone-specific menu entries.
 */
@injectable()
export class TheiaIDEContribution implements CommandContribution, MenuContribution, FrontendApplicationContribution {

    @inject(WindowService)
    protected readonly windowService: WindowService;

    static REPORT_ISSUE_URL = 'https://github.com/eesha000009-dev/airone-ide/issues/new';
    static DOCUMENTATION_URL = 'https://github.com/eesha000009-dev/airone-ide#readme';

    onStart(): void {
        // Rename "Extensions" label to "Libraries" in the sidebar
        this.renameExtensionsToLibraries();
    }

    /**
     * Rename the VS Code Extensions view title from "Extensions" to "Libraries".
     * This is done by patching the DOM after the application starts, because
     * the Extensions view label is contributed by @theia/plugin-ext and not
     * easily overridable via DI.
     */
    protected renameExtensionsToLibraries(): void {
        const observer = new MutationObserver(() => {
            // Look for the Extensions tab in the sidebar
            const extensionTabs = document.querySelectorAll(
                '.p-TabBar-tabLabel, .theia-sidepanel-tab, .p-TabBar-tab'
            );
            extensionTabs.forEach(tab => {
                if (tab.textContent?.trim() === 'Extensions') {
                    tab.textContent = 'Libraries';
                }
            });

            // Also rename the view container label
            const viewLabels = document.querySelectorAll(
                '.theia-header, .theia-TreeView .theia-TreeViewHeader'
            );
            viewLabels.forEach(label => {
                if (label.textContent?.trim() === 'EXTENSIONS') {
                    label.textContent = 'LIBRARIES';
                }
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    registerCommands(commandRegistry: CommandRegistry): void {
        commandRegistry.registerCommand(TheiaIDECommands.REPORT_ISSUE, {
            execute: () => this.windowService.openNewWindow(TheiaIDEContribution.REPORT_ISSUE_URL, { external: true })
        });
        commandRegistry.registerCommand(TheiaIDECommands.DOCUMENTATION, {
            execute: () => this.windowService.openNewWindow(TheiaIDEContribution.DOCUMENTATION_URL, { external: true })
        });
        commandRegistry.registerCommand(TheiaIDECommands.OPEN_LIBRARIES, {
            execute: () => {
                // Open the Extensions/Libraries view via command
                commandRegistry.executeCommand('workbench.view.extensions');
            }
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(TheiaIDEMenus.THEIA_IDE_HELP, {
            commandId: TheiaIDECommands.REPORT_ISSUE.id,
            label: TheiaIDECommands.REPORT_ISSUE.label,
            order: '1'
        });
        menus.registerMenuAction(TheiaIDEMenus.THEIA_IDE_HELP, {
            commandId: TheiaIDECommands.DOCUMENTATION.id,
            label: TheiaIDECommands.DOCUMENTATION.label,
            order: '2'
        });

        // Add Libraries entry in View menu
        menus.registerMenuAction([...CommonMenus.VIEW, 'libraries'], {
            commandId: TheiaIDECommands.OPEN_LIBRARIES.id,
            label: 'Libraries',
            order: 'z'
        });
    }
}
