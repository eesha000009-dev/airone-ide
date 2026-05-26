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
 * Contribution that renames the VS Code Extensions view label to "Libraries",
 * adds Airone-specific menu entries, and hides unwanted menus/sidebar items.
 */
@injectable()
export class TheiaIDEContribution implements CommandContribution, MenuContribution {

    @inject(WindowService)
    protected readonly windowService: WindowService;

    static REPORT_ISSUE_URL = 'https://github.com/eesha000009-dev/airone-ide/issues/new';
    static DOCUMENTATION_URL = 'https://github.com/eesha000009-dev/airone-ide#readme';

    private renameObserver: MutationObserver | null = null;
    private menuHideObserver: MutationObserver | null = null;

    constructor() {
        // Rename "Extensions" label to "Libraries" in the sidebar on startup
        // Use MutationObserver to catch dynamic changes
        this.startRenaming();
        this.startHidingMenus();
    }

    protected startRenaming(): void {
        // Try immediately in case the DOM is already ready
        this.renameExtensionsToLibraries();

        // Also observe DOM changes to catch dynamic rendering
        this.renameObserver = new MutationObserver((mutations) => {
            let shouldRename = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' || mutation.type === 'characterData') {
                    shouldRename = true;
                    break;
                }
            }
            if (shouldRename) {
                this.renameExtensionsToLibraries();
            }
        });

        // Wait for document body to be available
        const startObserving = () => {
            if (document.body) {
                this.renameObserver!.observe(document.body, {
                    childList: true,
                    subtree: true,
                    characterData: true
                });
            } else {
                setTimeout(startObserving, 100);
            }
        };
        startObserving();
    }

    /**
     * Hide unwanted menus from the menu bar using DOM manipulation.
     * We only want: File, Edit, View, Compile, Verify, Upload
     * Remove: Selection, Go, Run, Help
     */
    protected startHidingMenus(): void {
        this.hideUnwantedMenus();

        this.menuHideObserver = new MutationObserver(() => {
            this.hideUnwantedMenus();
        });

        const startObserving = () => {
            if (document.body) {
                this.menuHideObserver!.observe(document.body, {
                    childList: true,
                    subtree: true
                });
            } else {
                setTimeout(startObserving, 100);
            }
        };
        startObserving();
    }

    /**
     * Hide unwanted menus: Selection, Go, Run, Help
     * Keep: File, Edit, View, Compile, Verify, Upload
     */
    protected hideUnwantedMenus(): void {
        const menuItems = document.querySelectorAll('.p-MenuBar-item, .theia-MenuBar-item, [class*="MenuBar-item"]');
        const hiddenLabels = ['Selection', 'Go', 'Run', 'Help'];

        menuItems.forEach(item => {
            const label = item.textContent?.trim();
            if (label && hiddenLabels.includes(label)) {
                if (item instanceof HTMLElement) {
                    item.style.display = 'none';
                }
            }
        });

        // Also hide via the Theia-specific selectors
        const allMenuBarChildren = document.querySelectorAll('.theia-menubar, .p-MenuBar');
        allMenuBarChildren.forEach(menuBar => {
            const children = menuBar.children;
            for (let i = 0; i < children.length; i++) {
                const child = children[i] as HTMLElement;
                const label = child.textContent?.trim();
                if (label && hiddenLabels.includes(label)) {
                    child.style.display = 'none';
                }
            }
        });
    }

    /**
     * Rename all instances of "Extensions" to "Libraries" in the UI.
     * This patches the DOM because the Extensions view label is contributed
     * by @theia/plugin-ext and not easily overridable via DI.
     */
    protected renameExtensionsToLibraries(): void {
        // ─── 1. Activity bar tab labels ──────────────────────────────────
        const tabLabels = document.querySelectorAll('.p-TabBar-tabLabel');
        tabLabels.forEach(tab => {
            if (tab.textContent?.trim() === 'Extensions') {
                tab.textContent = 'Libraries';
            }
        });

        // ─── 2. Sidebar panel titles ─────────────────────────────────────
        const panelTitles = document.querySelectorAll('.theia-sidepanel-title');
        panelTitles.forEach(title => {
            if (title.textContent?.trim() === 'Extensions') {
                title.textContent = 'Libraries';
            }
        });

        // ─── 3. View container headers ───────────────────────────────────
        const headers = document.querySelectorAll('.theia-header');
        headers.forEach(header => {
            if (header.textContent?.trim() === 'EXTENSIONS') {
                header.textContent = 'LIBRARIES';
            }
            if (header.textContent?.trim() === 'Extensions') {
                header.textContent = 'Libraries';
            }
        });

        // ─── 4. Tree view headers ────────────────────────────────────────
        const treeHeaders = document.querySelectorAll('.theia-TreeView .theia-TreeViewHeader');
        treeHeaders.forEach(header => {
            if (header.textContent?.trim() === 'EXTENSIONS') {
                header.textContent = 'LIBRARIES';
            }
        });

        // ─── 5. Widget title captions ────────────────────────────────────
        const titleCaptions = document.querySelectorAll('.p-TabBar-tab .p-TabBar-tabCaption');
        titleCaptions.forEach(caption => {
            if (caption.textContent?.trim() === 'Extensions') {
                caption.textContent = 'Libraries';
            }
        });

        // ─── 6. Tab bar tab captions with different selectors ────────────
        const allTabs = document.querySelectorAll('[class*="TabBar"][class*="tab"]');
        allTabs.forEach(tab => {
            const label = tab.querySelector('.p-TabBar-tabLabel, .theia-tabBar-tabLabel');
            if (label && label.textContent?.trim() === 'Extensions') {
                label.textContent = 'Libraries';
            }
        });

        // ─── 7. Title area of widgets ────────────────────────────────────
        const titleAreas = document.querySelectorAll('.theia-widget-title, .p-Widget .title');
        titleAreas.forEach(area => {
            if (area.textContent?.trim() === 'Extensions') {
                area.textContent = 'Libraries';
            }
        });

        // ─── 8. Tooltip text for activity bar icons ─────────────────────
        const tooltips = document.querySelectorAll('[title="Extensions"]');
        tooltips.forEach(el => {
            el.setAttribute('title', 'Libraries');
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

    dispose(): void {
        if (this.renameObserver) {
            this.renameObserver.disconnect();
            this.renameObserver = null;
        }
        if (this.menuHideObserver) {
            this.menuHideObserver.disconnect();
            this.menuHideObserver = null;
        }
    }
}
