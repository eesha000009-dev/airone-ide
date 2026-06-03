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
 * the allowed ones (File, Edit, View, Libraries, Tools) are shown by adding
 * a data-airone-visible="true" attribute that CSS matches.
 */
@injectable()
export class TheiaIDEContribution implements CommandContribution, MenuContribution {

    @inject(WindowService)
    protected readonly windowService: WindowService;

    static REPORT_ISSUE_URL = 'https://github.com/eesha000009-dev/airone-ide/issues/new';
    static DOCUMENTATION_URL = 'https://github.com/eesha000009-dev/airone-ide#readme';

    /** Only these menu labels should be visible in the menu bar */
    static readonly ALLOWED_MENU_LABELS = new Set(['File', 'Edit', 'View', 'Libraries', 'Tools']);

    /**
     * Command IDs to hide from ALL menus (dropdown menus + context menus).
     * These cover Theia's built-in "New File", "New Folder", "Open File" commands
     * across different Theia versions and modules.
     */
    static readonly HIDDEN_COMMAND_IDS = new Set([
        'core.newFile',
        'core:newFile',
        'core.newFolder',
        'core:newFolder',
        'core.openFile',
        'core:openFile',
        'workspace:newFile',
        'workspace:NewFile',
        'workspace:newFolder',
        'workspace:NewFolder',
        'file.newFile',
        'file:newFile',
        'navigator:newFile',
        'navigator:NewFile',
        'navigator:newFolder',
        'navigator:NewFolder',
        'navigator:openFile',
        'navigator:OpenFile',
    ]);

    /**
     * Label text to hide from dropdown menus (exact match or startsWith).
     * Includes both ASCII ellipsis "..." and Unicode ellipsis "…"
     */
    static readonly HIDDEN_LABELS = [
        'New File',
        'New File...',
        'New File…',
        'New Folder',
        'New Folder...',
        'New Folder…',
        'Open File',
        'Open File...',
        'Open File…',
    ];

    private uiObserver: MutationObserver | undefined = undefined;
    private dropdownObserver: MutationObserver | undefined = undefined;
    private menuBarAttempts = 0;
    private readonly MAX_MENU_BAR_ATTEMPTS = 500;

    constructor() {
        this.startUIObserver();
        this.startDropdownObserver();
    }

    // ─── Menu Bar Observer ────────────────────────────────────────────────

    protected startUIObserver(): void {
        this.modifyMenuBarUI();

        this.uiObserver = new MutationObserver(() => {
            this.modifyMenuBarUI();
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

    /**
     * Modify the menu bar UI — limited attempts for menu bar items
     * (which are stable after initial render), but ALWAYS processes
     * dropdown menu items (which are created dynamically).
     */
    protected modifyMenuBarUI(): void {
        const shouldProcessMenuBar = this.menuBarAttempts < this.MAX_MENU_BAR_ATTEMPTS;
        if (shouldProcessMenuBar) {
            this.menuBarAttempts++;
            this.hideSidebarAndActivityBar();
            this.hideUnwantedMenus();
            this.removeNavigationArrows();
            this.hideTheiaToolbar();
            this.renameExtensionsToLibraries();
            this.enlargeLogo();
        }

        // ALWAYS process dropdown menu items — these are created dynamically
        // when the user clicks a menu, so we must keep checking
        this.hideUnwantedFileMenuItems();
    }

    // ─── Dedicated Dropdown Menu Observer ─────────────────────────────────

    /**
     * A dedicated MutationObserver specifically for dropdown menus.
     * When Theia opens a dropdown menu, it creates a new DOM element
     * (e.g., <ul class="lm-Menu">) as a child of <body>. This observer
     * watches for those elements and hides unwanted items in them.
     *
     * This observer has NO attempt limit — it must work for the entire
     * session because users can open dropdown menus at any time.
     */
    protected startDropdownObserver(): void {
        this.dropdownObserver = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                for (const node of Array.from(mutation.addedNodes)) {
                    if (node instanceof HTMLElement) {
                        // Check if the added node is a dropdown menu
                        if (node.classList.contains('lm-Menu') ||
                            node.classList.contains('p-Menu') ||
                            node.classList.contains('theia-Menu') ||
                            node.querySelector('.lm-Menu-item, .p-Menu-item')) {
                            this.hideUnwantedItemsInMenu(node);
                        }
                    }
                }
            }
        });

        const startObserving = () => {
            if (document.body) {
                this.dropdownObserver!.observe(document.body, {
                    childList: true,
                    subtree: true,
                });
            } else {
                setTimeout(startObserving, 100);
            }
        };
        startObserving();
    }

    // ─── Hide Unwanted Dropdown Menu Items ────────────────────────────────

    /**
     * Hide unwanted items from ALL currently visible dropdown menus.
     */
    protected hideUnwantedFileMenuItems(): void {
        const menuItemSelectors = [
            '.lm-Menu-item',
            '.p-Menu-item',
            '.theia-Menu-item',
        ];

        for (const sel of menuItemSelectors) {
            try {
                document.querySelectorAll<HTMLElement>(sel).forEach(item => {
                    this.processMenuItem(item);
                });
            } catch { /* invalid selector */ }
        }
    }

    /**
     * Hide unwanted items within a specific menu element.
     * Called by the dropdown observer when a new menu is created.
     */
    protected hideUnwantedItemsInMenu(menuEl: HTMLElement): void {
        const menuItemSelectors = [
            '.lm-Menu-item',
            '.p-Menu-item',
            '.theia-Menu-item',
        ];

        for (const sel of menuItemSelectors) {
            try {
                menuEl.querySelectorAll<HTMLElement>(sel).forEach(item => {
                    this.processMenuItem(item);
                });
            } catch { /* invalid selector */ }
        }
    }

    /**
     * Process a single menu item: hide it if it matches a hidden command or label.
     */
    protected processMenuItem(item: HTMLElement): void {
        // Skip if already processed
        if (item.getAttribute('data-airone-hidden') === 'true') {
            return;
        }

        // Check by data-command attribute
        const dataCommand = item.getAttribute('data-command') || '';
        if (dataCommand && TheiaIDEContribution.HIDDEN_COMMAND_IDS.has(dataCommand)) {
            this.hideMenuItem(item);
            return;
        }

        // Check by label text (Theia uses child elements for labels)
        const labelEl = item.querySelector(
            '.lm-Menu-itemLabel, .p-Menu-itemLabel, .theia-Menu-itemLabel, ' +
            '.lm-MenuBar-itemLabel, .p-MenuBar-itemLabel'
        );
        const text = (labelEl?.textContent?.trim() || item.textContent?.trim() || '');

        for (const hiddenLabel of TheiaIDEContribution.HIDDEN_LABELS) {
            if (text === hiddenLabel || text.startsWith(hiddenLabel.replace('…', '').replace('...', ''))) {
                this.hideMenuItem(item);
                return;
            }
        }
    }

    /**
     * Hide a menu item element completely.
     */
    protected hideMenuItem(item: HTMLElement): void {
        item.setAttribute('data-airone-hidden', 'true');
        item.style.display = 'none';
        item.style.height = '0';
        item.style.padding = '0';
        item.style.margin = '0';
        item.style.overflow = 'hidden';
        item.style.minHeight = '0';
        item.style.border = 'none';
        item.style.position = 'absolute';
        item.style.visibility = 'hidden';
        item.style.pointerEvents = 'none';
    }

    // ─── Menu Bar Whitelist ───────────────────────────────────────────────

    protected hideUnwantedMenus(): void {
        const allowed = TheiaIDEContribution.ALLOWED_MENU_LABELS;

        const menuBarItemSelectors = [
            '.lm-MenuBar-item',
            '.p-MenuBar-item',
            '.theia-MenuBar-item',
        ];

        for (const sel of menuBarItemSelectors) {
            try {
                document.querySelectorAll<HTMLElement>(sel).forEach(item => {
                    const text = this.getMenuItemLabel(item);
                    if (allowed.has(text)) {
                        item.setAttribute('data-airone-visible', 'true');
                    } else {
                        item.removeAttribute('data-airone-visible');
                    }
                });
            } catch { /* invalid selector */ }
        }

        const menuBarSelectors = [
            '.lm-MenuBar',
            '.p-MenuBar',
            '.theia-menubar',
        ];
        for (const sel of menuBarSelectors) {
            try {
                document.querySelectorAll(sel).forEach(menuBar => {
                    if (menuBar.classList.contains('lm-MenuBar-item') ||
                        menuBar.classList.contains('p-MenuBar-item') ||
                        menuBar.classList.contains('theia-MenuBar-item')) {
                        return;
                    }
                    const children = menuBar.children;
                    for (let i = 0; i < children.length; i++) {
                        const child = children[i] as HTMLElement;
                        const text = this.getMenuItemLabel(child);
                        if (allowed.has(text)) {
                            child.setAttribute('data-airone-visible', 'true');
                        } else {
                            child.removeAttribute('data-airone-visible');
                        }
                    }
                });
            } catch { /* invalid selector */ }
        }
    }

    protected getMenuItemLabel(el: Element): string {
        const itemLabel = el.querySelector('.lm-MenuBar-itemLabel, .p-MenuBar-itemLabel');
        if (itemLabel) {
            const text = itemLabel.textContent?.trim();
            if (text) {
                return text;
            }
        }

        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) {
            return ariaLabel;
        }

        const directText = this.getDirectTextContent(el);
        if (directText) {
            return directText;
        }

        return el.textContent?.trim() || '';
    }

    protected getDirectTextContent(el: Element): string {
        let text = '';
        for (const node of Array.from(el.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE) {
                text += node.textContent?.trim() || '';
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const htmlNode = node as Element;
                if (htmlNode.className.includes('label') || htmlNode.className.includes('Label') ||
                    htmlNode.tagName === 'SPAN' || htmlNode.tagName === 'DIV') {
                    if (!htmlNode.className.includes('submenu') && !htmlNode.className.includes('arrow') &&
                        !htmlNode.className.includes('icon') && !htmlNode.className.includes('Icon')) {
                        text += htmlNode.textContent?.trim() || '';
                    }
                }
            }
        }
        return text.trim();
    }

    // ─── Sidebar / Activity Bar ───────────────────────────────────────────

    protected hideSidebarAndActivityBar(): void {
        const activityBarSelectors = [
            '#theia-activitybar',
            '.theia-activity-bar',
            '.lm-TabBar.theia-activity-bar',
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

        document.querySelectorAll<HTMLElement>('#airo-sidebar, .airo-sidebar, .airo-sidebar-panel').forEach(el => {
            el.style.display = 'none';
            el.style.position = 'absolute';
            el.style.left = '-9999px';
        });
    }

    // ─── Navigation Arrows ────────────────────────────────────────────────

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

    // ─── Rename Extensions → Libraries ────────────────────────────────────

    protected renameExtensionsToLibraries(): void {
        const renameMap: [string, string][] = [
            ['Extensions', 'Libraries'],
            ['EXTENSIONS', 'LIBRARIES'],
        ];

        document.querySelectorAll('.lm-TabBar-tabLabel, .p-TabBar-tabLabel').forEach(tab => {
            for (const [from, to] of renameMap) {
                if (tab.textContent?.trim() === from) {
                    tab.textContent = to;
                }
            }
        });

        document.querySelectorAll('.theia-sidepanel-title').forEach(title => {
            if (title.textContent?.trim() === 'Extensions') {
                title.textContent = 'Libraries';
            }
        });

        document.querySelectorAll('.theia-header').forEach(header => {
            if (header.textContent?.trim() === 'EXTENSIONS') {
                header.textContent = 'LIBRARIES';
            }
            if (header.textContent?.trim() === 'Extensions') {
                header.textContent = 'Libraries';
            }
        });

        document.querySelectorAll('[title="Extensions"]').forEach(el => {
            el.setAttribute('title', 'Libraries');
        });

        document.querySelectorAll('.lm-TabBar-tab .lm-TabBar-tabCaption, .p-TabBar-tab .p-TabBar-tabCaption').forEach(caption => {
            if (caption.textContent?.trim() === 'Extensions') {
                caption.textContent = 'Libraries';
            }
        });
    }

    // ─── Theia Toolbar ────────────────────────────────────────────────────

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

    // ─── Logo ─────────────────────────────────────────────────────────────

    protected enlargeLogo(): void {
        const logoSelectors = [
            '.theia-icon',
            '.theia-menubar-logo',
            '[class*="MenuBar-logo"]',
            '[class*="menubar-logo"]',
            '.lm-MenuBar-logo',
            '.p-MenuBar-logo',
        ];

        for (const sel of logoSelectors) {
            try {
                document.querySelectorAll<HTMLElement>(sel).forEach(el => {
                    const currentWidth = el.style.width;
                    if (currentWidth !== '100px') {
                        el.style.width = '100px';
                        el.style.height = '100px';
                        el.style.minWidth = '100px';
                        el.style.minHeight = '100px';
                        el.style.backgroundSize = '92px 92px';
                        el.style.padding = '4px';
                    }
                });
            } catch { /* invalid selector */ }
        }
    }

    // ─── Command/Menu Registration ────────────────────────────────────────

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
            this.uiObserver = undefined;
        }
        if (this.dropdownObserver) {
            this.dropdownObserver.disconnect();
            this.dropdownObserver = undefined;
        }
    }
}
