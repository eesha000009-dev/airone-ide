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
 *
 * Theia 1.72 uses Lumino (lm- prefix) instead of PhosphorJS (p- prefix).
 * Menu items do NOT have aria-label attributes. The label text is inside
 * a child element: .lm-MenuBar-itemLabel
 */
@injectable()
export class TheiaIDEContribution implements CommandContribution, MenuContribution {

    @inject(WindowService)
    protected readonly windowService: WindowService;

    static REPORT_ISSUE_URL = 'https://github.com/eesha000009-dev/airone-ide/issues/new';
    static DOCUMENTATION_URL = 'https://github.com/eesha000009-dev/airone-ide#readme';

    /** Only these menu labels should be visible in the menu bar */
    static readonly ALLOWED_MENU_LABELS = new Set(['File', 'Edit', 'View', 'Libraries', 'Tools']);

    private uiObserver: MutationObserver | undefined = undefined;
    private hideAttempts = 0;
    private readonly MAX_HIDE_ATTEMPTS = 500;

    constructor() {
        this.startUIObserver();
    }

    /**
     * Unified observer that handles all DOM-based UI modifications:
     * - Hide activity bar and sidebar COMPLETELY
     * - Hide unwanted menus (whitelist approach using data attribute)
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

        // 7. Hide unwanted File submenu items (New File, New Folder, etc.)
        this.hideUnwantedFileMenuItems();
    }

    /**
     * Hide Theia's built-in "New File", "New Folder", and other unwanted items
     * from the File dropdown menu. We want only "New Sketch" and "Examples".
     */
    protected hideUnwantedFileMenuItems(): void {
        // List of command IDs to hide from menus
        const hiddenCommands = [
            'core.newFile',
            'core:newFile',
            'core.newFolder',
            'core:newFolder',
            'core.openFile',
            'core:openFile',
            'workspace:newFile',
            'file.newFile',
        ];

        // Selectors for menu items in dropdown menus (both Lumino and PhosphorJS)
        const menuItemSelectors = [
            '.lm-Menu-item',
            '.p-Menu-item',
            '.theia-Menu-item',
        ];

        for (const sel of menuItemSelectors) {
            try {
                document.querySelectorAll<HTMLElement>(sel).forEach(item => {
                    const dataCommand = item.getAttribute('data-command') || '';
                    if (hiddenCommands.some(cmd => dataCommand === cmd)) {
                        item.style.display = 'none';
                        item.style.height = '0';
                        item.style.padding = '0';
                        item.style.margin = '0';
                        item.style.overflow = 'hidden';
                        item.style.minHeight = '0';
                        item.style.border = 'none';
                    }
                });
            } catch { /* invalid selector */ }
        }

        // Also hide by label text in case data-command is not set
        const hiddenLabels = ['New File', 'New Folder', 'Open File…', 'Open File...'];
        for (const sel of menuItemSelectors) {
            try {
                document.querySelectorAll<HTMLElement>(sel).forEach(item => {
                    const labelEl = item.querySelector('.lm-Menu-itemLabel, .p-Menu-itemLabel, .theia-Menu-itemLabel');
                    const text = labelEl?.textContent?.trim() || item.textContent?.trim() || '';
                    if (hiddenLabels.some(label => text === label)) {
                        item.style.display = 'none';
                        item.style.height = '0';
                        item.style.padding = '0';
                        item.style.margin = '0';
                        item.style.overflow = 'hidden';
                        item.style.minHeight = '0';
                        item.style.border = 'none';
                    }
                });
            } catch { /* invalid selector */ }
        }
    }

    /**
     * WHITELIST APPROACH: All menu items are hidden by CSS rule
     * (`.lm-MenuBar-item { display: none }`). We then set
     * `data-airone-visible="true"` on allowed items, which CSS
     * matches with `.lm-MenuBar-item[data-airone-visible="true"] { display: flex }`.
     *
     * This is more reliable than inline style manipulation because:
     * 1. It works with both Lumino (lm-) and PhosphorJS (p-) prefixes
     * 2. It doesn't fight with Theia's DOM reconciliation
     * 3. CSS !important rules take precedence
     */
    protected hideUnwantedMenus(): void {
        const allowed = TheiaIDEContribution.ALLOWED_MENU_LABELS;

        // Selectors for menu bar items — both Lumino (lm-) and PhosphorJS (p-)
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
                        // Mark as visible — CSS will show this item
                        item.setAttribute('data-airone-visible', 'true');
                    } else {
                        // Remove visibility marker — CSS will hide this item
                        item.removeAttribute('data-airone-visible');
                    }
                });
            } catch { /* invalid selector */ }
        }

        // Also iterate direct children of the menu bar container
        const menuBarSelectors = [
            '.lm-MenuBar',
            '.p-MenuBar',
            '.theia-menubar',
        ];
        for (const sel of menuBarSelectors) {
            try {
                document.querySelectorAll(sel).forEach(menuBar => {
                    // Skip if this is a menu ITEM, not the container
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

    /**
     * Get the label text of a menu item.
     *
     * In Theia 1.72 with Lumino, the label text is inside a child element:
     *   <li class="lm-MenuBar-item">
     *     <div class="lm-MenuBar-itemLabel">File</div>
     *   </li>
     *
     * We check the itemLabel child first, then aria-label, then text content.
     */
    protected getMenuItemLabel(el: Element): string {
        // Check for Lumino itemLabel child (most reliable in Theia 1.72+)
        const itemLabel = el.querySelector('.lm-MenuBar-itemLabel, .p-MenuBar-itemLabel');
        if (itemLabel) {
            const text = itemLabel.textContent?.trim();
            if (text) {
                return text;
            }
        }

        // Check aria-label (unlikely but possible)
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
                // Include label-like children but not submenu indicators
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

    /**
     * Hide the activity bar and sidebar using aggressive DOM manipulation.
     */
    protected hideSidebarAndActivityBar(): void {
        // Activity bar selectors — remove from DOM entirely
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

        // Activity bar tab labels (both Lumino and PhosphorJS)
        document.querySelectorAll('.lm-TabBar-tabLabel, .p-TabBar-tabLabel').forEach(tab => {
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

        // Tab bar captions (both Lumino and PhosphorJS)
        document.querySelectorAll('.lm-TabBar-tab .lm-TabBar-tabCaption, .p-TabBar-tab .p-TabBar-tabCaption').forEach(caption => {
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
    }
}
