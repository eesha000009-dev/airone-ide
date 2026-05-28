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
 *
 * Uses WHITELIST approach for menus: ALL menus are hidden via CSS, then only
 * the allowed ones (File, Edit, View, Libraries, Tools) are shown. This is
 * more reliable than a blacklist because any new menus Theia adds are
 * automatically hidden.
 */
@injectable()
export class TheiaIDEContribution implements CommandContribution, MenuContribution {

    @inject(WindowService)
    protected readonly windowService: WindowService;

    static REPORT_ISSUE_URL = 'https://github.com/eesha000009-dev/airone-ide/issues/new';
    static DOCUMENTATION_URL = 'https://github.com/eesha000009-dev/airone-ide#readme';

    /** Only these menu labels should be visible in the menu bar */
    static readonly ALLOWED_MENU_LABELS = new Set(['File', 'Edit', 'View', 'Libraries', 'Tools']);

    private uiObserver: MutationObserver | null = null;
    private hideAttempts = 0;
    private readonly MAX_HIDE_ATTEMPTS = 500;

    constructor() {
        this.startUIObserver();
    }

    /**
     * Unified observer that handles all DOM-based UI modifications:
     * - Hide activity bar and sidebar COMPLETELY
     * - Hide unwanted menus (whitelist approach)
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

        // 2. Hide unwanted menus (whitelist: show only allowed)
        this.hideUnwantedMenus();

        // 3. Remove navigation arrows
        this.removeNavigationArrows();

        // 4. Hide Theia's built-in toolbar
        this.hideTheiaToolbar();

        // 5. Rename Extensions → Libraries
        this.renameExtensionsToLibraries();

        // 6. Make logo bigger
        this.enlargeLogo();
    }

    /**
     * WHITELIST APPROACH: Hide all menu bar items, then show only the
     * allowed ones. This is more reliable than blacklisting because any
     * new menus Theia adds will automatically be hidden.
     *
     * We iterate ALL .p-MenuBar-item elements and check their text content
     * or aria-label against our ALLOWED set.
     */
    protected hideUnwantedMenus(): void {
        const allowed = TheiaIDEContribution.ALLOWED_MENU_LABELS;

        // Find all menu bar items
        const menuBarItemSelectors = [
            '.p-MenuBar-item',
            '.theia-MenuBar-item',
            '[class*="MenuBar-item"]',
        ];

        for (const sel of menuBarItemSelectors) {
            try {
                document.querySelectorAll<HTMLElement>(sel).forEach(item => {
                    const text = this.getMenuItemLabel(item);
                    if (!allowed.has(text)) {
                        // Hide this menu item
                        item.style.display = 'none';
                    } else {
                        // Ensure allowed items are visible
                        item.style.display = '';
                    }
                });
            } catch { /* invalid selector */ }
        }

        // Also iterate direct children of the menu bar container
        document.querySelectorAll('.theia-menubar, .p-MenuBar, [class*="MenuBar"]').forEach(menuBar => {
            // Skip if this is a menu ITEM, not the container
            if (menuBar.classList.contains('p-MenuBar-item') || menuBar.classList.contains('theia-MenuBar-item')) {
                return;
            }
            const children = menuBar.children;
            for (let i = 0; i < children.length; i++) {
                const child = children[i] as HTMLElement;
                const text = this.getMenuItemLabel(child);
                if (!allowed.has(text)) {
                    child.style.display = 'none';
                } else {
                    child.style.display = '';
                }
            }
        });
    }

    /**
     * Get the label text of a menu item. Checks aria-label first (most reliable),
     * then direct text content, then inner span text.
     */
    protected getMenuItemLabel(el: Element): string {
        // Check aria-label first (most reliable in Theia 1.72+)
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) {
            return ariaLabel;
        }

        // Check direct text content
        const directText = this.getDirectTextContent(el);
        if (directText) {
            return directText;
        }

        // Fallback: full text content trimmed
        return el.textContent?.trim() || '';
    }

    /**
     * Get the direct text content of an element (not including child elements).
     */
    protected getDirectTextContent(el: Element): string {
        let text = '';
        for (const node of Array.from(el.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE) {
                text += node.textContent?.trim() || '';
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const htmlNode = node as Element;
                if (htmlNode.tagName === 'SPAN' || htmlNode.tagName === 'DIV' ||
                    htmlNode.className.includes('label') || htmlNode.className.includes('Label')) {
                    if (!htmlNode.className.includes('submenu') && !htmlNode.className.includes('arrow')) {
                        text += htmlNode.textContent?.trim() || '';
                    }
                }
            }
        }
        return text.trim();
    }

    /**
     * Hide the activity bar and sidebar using aggressive DOM manipulation.
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

        // Hide any sidebar-like elements on the left
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
    }

    /**
     * Remove back/forward navigation arrows from the toolbar.
     */
    protected removeNavigationArrows(): void {
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
     * Hide Theia's built-in toolbar (only the toolbar container, NOT the menu bar).
     */
    protected hideTheiaToolbar(): void {
        const toolbarSelectors = [
            '#theia-toolbar-container',
            '.theia-toolbar-container',
            '#theia-toolbar',
            '.theia-toolbar',
        ];

        for (const sel of toolbarSelectors) {
            try {
                document.querySelectorAll<HTMLElement>(sel).forEach(el => {
                    if (!el.id.startsWith('airo-') && !el.className.includes('airo-')) {
                        el.style.display = 'none';
                        el.style.height = '0';
                        el.style.minHeight = '0';
                        el.style.overflow = 'hidden';
                    }
                });
            } catch { /* invalid selector */ }
        }
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
                    if (currentWidth !== '48px') {
                        el.style.width = '48px';
                        el.style.height = '48px';
                        el.style.minWidth = '48px';
                        el.style.minHeight = '48px';
                        el.style.backgroundSize = '44px 44px';
                        el.style.padding = '2px';
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
