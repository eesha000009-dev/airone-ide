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

    private uiObserver: MutationObserver | null = null;
    private hideAttempts = 0;
    private readonly MAX_HIDE_ATTEMPTS = 200;

    constructor() {
        this.startUIObserver();
    }

    /**
     * Unified observer that handles all DOM-based UI modifications:
     * - Hide activity bar and sidebar COMPLETELY (remove from DOM)
     * - Hide unwanted menu items
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
            return;
        }
        this.hideAttempts++;

        // 1. Hide activity bar and sidebar COMPLETELY
        this.hideSidebarAndActivityBar();

        // 2. Hide unwanted menus
        this.hideUnwantedMenus();

        // 3. Remove navigation arrows
        this.removeNavigationArrows();

        // 4. Rename Extensions → Libraries
        this.renameExtensionsToLibraries();

        // 5. Make logo bigger
        this.enlargeLogo();
    }

    /**
     * Hide unwanted menus: Selection, Go, Run, Help, Compile, Verify, Upload, Sketch, Terminal
     * Keep: File, Edit, View, Libraries, Tools
     */
    protected hideUnwantedMenus(): void {
        const hiddenLabels = ['Selection', 'Go', 'Run', 'Help', 'Compile', 'Verify', 'Upload', 'Terminal', 'Sketch'];

        document.querySelectorAll('.p-MenuBar-item, .theia-MenuBar-item, [class*="MenuBar-item"]').forEach(item => {
            const label = item.textContent?.trim();
            if (label && hiddenLabels.includes(label)) {
                if (item instanceof HTMLElement && item.style.display !== 'none') {
                    item.style.display = 'none';
                }
            }
        });

        document.querySelectorAll('.theia-menubar, .p-MenuBar').forEach(menuBar => {
            const children = menuBar.children;
            for (let i = 0; i < children.length; i++) {
                const child = children[i] as HTMLElement;
                const label = child.textContent?.trim();
                if (label && hiddenLabels.includes(label)) {
                    if (child.style.display !== 'none') {
                        child.style.display = 'none';
                    }
                }
            }
        });
    }

    /**
     * Hide the activity bar and sidebar using aggressive DOM manipulation.
     * Instead of just hiding, we REMOVE elements from the DOM to prevent
     * Theia from re-showing them via its layout JavaScript.
     */
    protected hideSidebarAndActivityBar(): void {
        // Activity bar selectors — remove from DOM entirely
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
                document.querySelectorAll(sel).forEach(el => {
                    if (el instanceof HTMLElement) {
                        // Remove from DOM entirely to prevent Theia from re-showing
                        el.remove();
                    }
                });
            } catch { /* invalid selector */ }
        }

        // Sidebar panel selectors — remove from DOM entirely
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
                document.querySelectorAll(sel).forEach(el => {
                    if (el instanceof HTMLElement) {
                        el.style.display = 'none';
                        el.style.width = '0px';
                        el.style.minWidth = '0px';
                        el.style.maxWidth = '0px';
                        el.style.overflow = 'hidden';
                        el.style.padding = '0px';
                        el.style.margin = '0px';
                        el.style.position = 'absolute';
                        el.style.left = '-9999px';
                        el.style.visibility = 'hidden';
                        el.style.pointerEvents = 'none';
                    }
                });
            } catch { /* invalid selector */ }
        }

        // Also find elements with class containing "sidebar" or "side-panel" on the left
        document.querySelectorAll<HTMLElement>('[class*="sidebar"], [class*="side-panel"], [class*="SidePanel"]').forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.left < 100 && rect.width < 500 && rect.height > 200) {
                el.style.display = 'none';
                el.style.width = '0px';
                el.style.overflow = 'hidden';
                el.style.position = 'absolute';
                el.style.left = '-9999px';
                el.style.visibility = 'hidden';
                el.style.pointerEvents = 'none';
            }
        });

        // Hide the Airone sidebar widget if it somehow gets created
        document.querySelectorAll<HTMLElement>('#airo-sidebar, .airo-sidebar, .airo-sidebar-panel').forEach(el => {
            el.style.display = 'none';
            el.style.position = 'absolute';
            el.style.left = '-9999px';
        });

        // CRITICAL: Also hide the split panel handle that separates sidebar from main area
        document.querySelectorAll<HTMLElement>('.p-SplitPanel-handle').forEach(el => {
            // Only hide if it's the left sidebar handle (first child in split panel)
            const parent = el.parentElement;
            if (parent) {
                const firstWidget = parent.querySelector('.p-Widget:first-child');
                if (firstWidget && firstWidget.getBoundingClientRect().left < 50) {
                    el.style.display = 'none';
                }
            }
        });
    }

    /**
     * Remove back/forward navigation arrows from the toolbar.
     */
    protected removeNavigationArrows(): void {
        // Find toolbar items with navigation IDs
        document.querySelectorAll<HTMLElement>('.theia-toolbar-item, [class*="toolbar-item"]').forEach(item => {
            const id = item.id || '';
            const title = item.title || '';
            const dataCommand = item.getAttribute('data-command') || '';
            if (
                id.includes('navigation.back') ||
                id.includes('navigation.forward') ||
                id.includes('navigate.back') ||
                id.includes('navigate.forward') ||
                dataCommand.includes('navigation.back') ||
                dataCommand.includes('navigation.forward') ||
                (title && (title.toLowerCase().includes('navigate back') || title.toLowerCase().includes('navigate forward')))
            ) {
                item.style.display = 'none';
                item.style.width = '0px';
                item.style.overflow = 'hidden';
                item.style.padding = '0px';
                item.style.margin = '0px';
                item.style.position = 'absolute';
                item.style.visibility = 'hidden';
            }
        });

        // Find buttons in toolbar
        const toolbarSelectors = ['.theia-toolbar', '[class*="theia-toolbar"]', '#theia-top-panel'];
        for (const sel of toolbarSelectors) {
            const toolbar = document.querySelector(sel);
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
                        btn.style.display = 'none';
                        btn.style.width = '0px';
                        btn.style.overflow = 'hidden';
                        btn.style.padding = '0px';
                        btn.style.margin = '0px';
                        btn.style.position = 'absolute';
                        btn.style.visibility = 'hidden';
                    }
                });
            }
        }
    }

    /**
     * Rename all instances of "Extensions" to "Libraries" in the UI.
     */
    protected renameExtensionsToLibraries(): void {
        const renameMap: [string, string][] = [
            ['Extensions', 'Libraries'],
            ['EXTENSIONS', 'LIBRARIES'],
        ];

        // Activity bar tab labels
        document.querySelectorAll('.p-TabBar-tabLabel').forEach(tab => {
            for (const [from, to] of renameMap) {
                if (tab.textContent?.trim() === from) {
                    tab.textContent = to;
                }
            }
        });

        // Sidebar panel titles
        document.querySelectorAll('.theia-sidepanel-title').forEach(title => {
            if (title.textContent?.trim() === 'Extensions') {
                title.textContent = 'Libraries';
            }
        });

        // View container headers
        document.querySelectorAll('.theia-header').forEach(header => {
            if (header.textContent?.trim() === 'EXTENSIONS') {
                header.textContent = 'LIBRARIES';
            }
            if (header.textContent?.trim() === 'Extensions') {
                header.textContent = 'Libraries';
            }
        });

        // Tooltip text for activity bar icons
        document.querySelectorAll('[title="Extensions"]').forEach(el => {
            el.setAttribute('title', 'Libraries');
        });

        // Tab bar captions
        document.querySelectorAll('.p-TabBar-tab .p-TabBar-tabCaption').forEach(caption => {
            if (caption.textContent?.trim() === 'Extensions') {
                caption.textContent = 'Libraries';
            }
        });
    }

    /**
     * Make the logo bigger in the menu bar area.
     */
    protected enlargeLogo(): void {
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
                    if (currentWidth !== '58px') {
                        el.style.width = '58px';
                        el.style.height = '58px';
                        el.style.minWidth = '58px';
                        el.style.minHeight = '58px';
                        el.style.backgroundSize = '52px 52px';
                        el.style.padding = '4px';
                    }
                });
            } catch { /* invalid selector */ }
        }
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
                // Delegate to airo.manageLibraries which shows a QuickPick
                // (don't try to open the hidden sidebar)
                commandRegistry.executeCommand('airo.manageLibraries').catch(() => {
                    // Fallback: show a message
                });
            }
        });
    }

    registerMenus(_menus: MenuModelRegistry): void {
        // Menus are handled by AiroContribution now
    }

    dispose(): void {
        if (this.uiObserver) {
            this.uiObserver.disconnect();
            this.uiObserver = null;
        }
    }
}
