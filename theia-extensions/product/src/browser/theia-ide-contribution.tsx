/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { inject, injectable } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { MenuContribution, MenuModelRegistry, MenuPath } from '@theia/core/lib/common/menu';
import { WindowService } from '@theia/core/lib/browser/window/window-service';

export namespace TheiaIDEMenus {
    export const THEIA_IDE_HELP: MenuPath = ['tools_menu', 'airone-ide'];
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
 * Uses BOTH CSS and DOM manipulation for maximum reliability.
 */
@injectable()
export class TheiaIDEContribution implements CommandContribution, MenuContribution {

    @inject(WindowService)
    protected readonly windowService: WindowService;

    static REPORT_ISSUE_URL = 'https://github.com/eesha000009-dev/airone-ide/issues/new';
    static DOCUMENTATION_URL = 'https://github.com/eesha000009-dev/airone-ide#readme';

    private renameObserver: MutationObserver | null = null;
    private uiObserver: MutationObserver | null = null;
    private hideAttempts = 0;
    private readonly MAX_HIDE_ATTEMPTS = 100;

    constructor() {
        this.startUIObserver();
    }

    /**
     * Unified observer that handles all DOM-based UI modifications:
     * - Hide unwanted menu items
     * - Hide activity bar and sidebar
     * - Remove navigation arrows
     * - Rename Extensions → Libraries
     * - Make logo bigger
     */
    protected startUIObserver(): void {
        this.modifyUI();

        this.uiObserver = new MutationObserver(() => {
            this.modifyUI();
        });

        const startObserving = () => {
            if (document.body) {
                this.uiObserver!.observe(document.body, {
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

    protected modifyUI(): void {
        if (this.hideAttempts >= this.MAX_HIDE_ATTEMPTS) {
            // Stop observing after max attempts to save performance
            return;
        }
        this.hideAttempts++;

        let changesMade = false;

        // 1. Hide unwanted menus
        changesMade = this.hideUnwantedMenus() || changesMade;

        // 2. Hide activity bar and sidebar
        changesMade = this.hideSidebarAndActivityBar() || changesMade;

        // 3. Remove navigation arrows
        changesMade = this.removeNavigationArrows() || changesMade;

        // 4. Rename Extensions → Libraries
        changesMade = this.renameExtensionsToLibraries() || changesMade;

        // 5. Make logo bigger
        changesMade = this.enlargeLogo() || changesMade;

        // If we've made changes successfully many times, we can slow down
        if (changesMade && this.hideAttempts > 30) {
            // Still keep observing but less aggressively
        }
    }

    /**
     * Hide unwanted menus: Selection, Go, Run, Help, Compile, Verify, Upload, Terminal
     * Keep: File, Edit, View, Libraries, Tools
     */
    protected hideUnwantedMenus(): boolean {
        let changed = false;
        const hiddenLabels = ['Selection', 'Go', 'Run', 'Help', 'Compile', 'Verify', 'Upload', 'Terminal'];

        const menuItems = document.querySelectorAll('.p-MenuBar-item, .theia-MenuBar-item, [class*="MenuBar-item"]');
        menuItems.forEach(item => {
            const label = item.textContent?.trim();
            if (label && hiddenLabels.includes(label)) {
                if (item instanceof HTMLElement && item.style.display !== 'none') {
                    item.style.display = 'none';
                    changed = true;
                }
            }
        });

        const allMenuBarChildren = document.querySelectorAll('.theia-menubar, .p-MenuBar');
        allMenuBarChildren.forEach(menuBar => {
            const children = menuBar.children;
            for (let i = 0; i < children.length; i++) {
                const child = children[i] as HTMLElement;
                const label = child.textContent?.trim();
                if (label && hiddenLabels.includes(label)) {
                    if (child.style.display !== 'none') {
                        child.style.display = 'none';
                        changed = true;
                    }
                }
            }
        });

        return changed;
    }

    /**
     * Hide the activity bar and sidebar using DOM manipulation
     * (in addition to CSS, which may not match all Theia versions).
     */
    protected hideSidebarAndActivityBar(): boolean {
        let changed = false;

        // Activity bar selectors
        const activityBarSelectors = [
            '#theia-activitybar',
            '.theia-activity-bar',
            '.p-TabBar.theia-activity-bar',
            '[class*="activity-bar"]',
            '[class*="activitybar"]',
            '[id*="activitybar"]',
            '[id*="activity-bar"]',
        ];

        for (const sel of activityBarSelectors) {
            try {
                document.querySelectorAll<HTMLElement>(sel).forEach(el => {
                    if (el.style.display !== 'none' || el.style.width !== '0px') {
                        el.style.display = 'none';
                        el.style.width = '0px';
                        el.style.minWidth = '0px';
                        el.style.maxWidth = '0px';
                        el.style.overflow = 'hidden';
                        el.style.padding = '0px';
                        el.style.margin = '0px';
                        changed = true;
                    }
                });
            } catch { /* invalid selector */ }
        }

        // Sidebar panel selectors
        const sidebarSelectors = [
            '.theia-left-side-panel',
            '.theia-side-panel',
            '.theia-sidebar-container',
            '#sidebar-left',
            '#sidebar-left-content',
            '[data-area="left"]',
            '.p-DockPanel > [data-area="left"]',
        ];

        for (const sel of sidebarSelectors) {
            try {
                document.querySelectorAll<HTMLElement>(sel).forEach(el => {
                    if (el.style.display !== 'none' || el.style.width !== '0px') {
                        el.style.display = 'none';
                        el.style.width = '0px';
                        el.style.minWidth = '0px';
                        el.style.maxWidth = '0px';
                        el.style.overflow = 'hidden';
                        el.style.padding = '0px';
                        el.style.margin = '0px';
                        changed = true;
                    }
                });
            } catch { /* invalid selector */ }
        }

        // Also find elements with class containing "sidebar" or "side-panel"
        document.querySelectorAll<HTMLElement>('[class*="sidebar"], [class*="side-panel"], [class*="SidePanel"]').forEach(el => {
            // Only hide if it's on the LEFT side
            const rect = el.getBoundingClientRect();
            if (rect.left < 100 && rect.width < 500 && rect.height > 200) {
                if (el.style.display !== 'none') {
                    el.style.display = 'none';
                    el.style.width = '0px';
                    el.style.overflow = 'hidden';
                    changed = true;
                }
            }
        });

        // Hide the Airone sidebar widget if it somehow gets created
        document.querySelectorAll<HTMLElement>('#airo-sidebar, .airo-sidebar, .airo-sidebar-panel').forEach(el => {
            if (el.style.display !== 'none') {
                el.style.display = 'none';
                changed = true;
            }
        });

        return changed;
    }

    /**
     * Remove back/forward navigation arrows from the toolbar.
     */
    protected removeNavigationArrows(): boolean {
        let changed = false;

        // Strategy 1: Find toolbar items with navigation IDs
        document.querySelectorAll<HTMLElement>('.theia-toolbar-item, [class*="toolbar-item"]').forEach(item => {
            const id = item.id || '';
            const title = item.title || '';
            if (
                id.includes('navigation.back') ||
                id.includes('navigation.forward') ||
                id.includes('navigate.back') ||
                id.includes('navigate.forward') ||
                title.toLowerCase().includes('back') ||
                title.toLowerCase().includes('forward')
            ) {
                if (item.style.display !== 'none') {
                    item.style.display = 'none';
                    item.style.width = '0px';
                    item.style.overflow = 'hidden';
                    item.style.padding = '0px';
                    item.style.margin = '0px';
                    changed = true;
                }
            }
        });

        // Strategy 2: Find buttons in toolbar
        const toolbar = document.querySelector('.theia-toolbar, [class*="theia-toolbar"]');
        if (toolbar) {
            toolbar.querySelectorAll<HTMLElement>('button, [role="button"]').forEach(btn => {
                const title = btn.title || '';
                const text = btn.textContent?.trim() || '';
                const ariaLabel = btn.getAttribute('aria-label') || '';

                if (
                    (title && (title.toLowerCase().includes('back') || title.toLowerCase().includes('forward'))) ||
                    (ariaLabel && (ariaLabel.toLowerCase().includes('back') || ariaLabel.toLowerCase().includes('forward'))) ||
                    text === '←' || text === '→' ||
                    text === '‹' || text === '›'
                ) {
                    if (btn.style.display !== 'none') {
                        btn.style.display = 'none';
                        btn.style.width = '0px';
                        btn.style.overflow = 'hidden';
                        btn.style.padding = '0px';
                        btn.style.margin = '0px';
                        changed = true;
                    }
                }
            });
        }

        return changed;
    }

    /**
     * Rename all instances of "Extensions" to "Libraries" in the UI.
     */
    protected renameExtensionsToLibraries(): boolean {
        let changed = false;

        const renameMap: [string, string][] = [
            ['Extensions', 'Libraries'],
            ['EXTENSIONS', 'LIBRARIES'],
        ];

        // Activity bar tab labels
        document.querySelectorAll('.p-TabBar-tabLabel').forEach(tab => {
            for (const [from, to] of renameMap) {
                if (tab.textContent?.trim() === from) {
                    tab.textContent = to;
                    changed = true;
                }
            }
        });

        // Sidebar panel titles
        document.querySelectorAll('.theia-sidepanel-title').forEach(title => {
            if (title.textContent?.trim() === 'Extensions') {
                title.textContent = 'Libraries';
                changed = true;
            }
        });

        // View container headers
        document.querySelectorAll('.theia-header').forEach(header => {
            if (header.textContent?.trim() === 'EXTENSIONS') {
                header.textContent = 'LIBRARIES';
                changed = true;
            }
            if (header.textContent?.trim() === 'Extensions') {
                header.textContent = 'Libraries';
                changed = true;
            }
        });

        // Tooltip text for activity bar icons
        document.querySelectorAll('[title="Extensions"]').forEach(el => {
            el.setAttribute('title', 'Libraries');
            changed = true;
        });

        // Tab bar captions
        document.querySelectorAll('.p-TabBar-tab .p-TabBar-tabCaption').forEach(caption => {
            if (caption.textContent?.trim() === 'Extensions') {
                caption.textContent = 'Libraries';
                changed = true;
            }
        });

        return changed;
    }

    /**
     * Make the logo bigger in the menu bar area.
     */
    protected enlargeLogo(): boolean {
        let changed = false;

        // Find the logo element in the menu bar
        const logoSelectors = [
            '.theia-icon',
            '.theia-menubar-logo',
            '[class*="MenuBar-logo"]',
            '[class*="menubar-logo"]',
            '.p-MenuBar-logo',
        ];

        for (const sel of logoSelectors) {
            try {
                document.querySelectorAll<HTMLElement>(sel).forEach(el => {
                    const currentWidth = el.style.width;
                    if (currentWidth !== '40px') {
                        el.style.width = '40px';
                        el.style.height = '40px';
                        el.style.minWidth = '40px';
                        el.style.minHeight = '40px';
                        el.style.backgroundSize = '36px 36px';
                        el.style.padding = '4px';
                        changed = true;
                    }
                });
            } catch { /* invalid selector */ }
        }

        return changed;
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
                commandRegistry.executeCommand('workbench.view.extensions');
            }
        });
    }

    registerMenus(_menus: MenuModelRegistry): void {
        // Menus are handled by AiroContribution now
    }

    dispose(): void {
        if (this.renameObserver) {
            this.renameObserver.disconnect();
            this.renameObserver = null;
        }
        if (this.uiObserver) {
            this.uiObserver.disconnect();
            this.uiObserver = null;
        }
    }
}
