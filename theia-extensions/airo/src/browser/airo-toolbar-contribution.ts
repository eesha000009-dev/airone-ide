/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { CommandService } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { ApplicationShell } from '@theia/core/lib/browser/shell';

/**
 * Toolbar contribution that creates a SEPARATE toolbar row below the menu bar
 * for Compile, Upload, and Serial Monitor buttons.
 *
 * Auto-update: Updates are checked and downloaded automatically. When ready,
 * a "Restart to Update" button appears in the toolbar.
 *
 * The toolbar watches for the update-ready signal via a DOM-based approach:
 * the updater extension adds a hidden DOM element when an update is ready.
 */
@injectable()
export class AiroToolbarContribution implements FrontendApplicationContribution {

    @inject(CommandService)
    protected readonly commandService!: CommandService;

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    private observer: MutationObserver | null = null;
    private injected = false;
    private retryCount = 0;
    private readonly MAX_RETRIES = 150;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    private updateReadyBtn: HTMLButtonElement | null = null;
    private layoutResizeObserver: ResizeObserver | null = null;
    private layoutMutationObserver: MutationObserver | null = null;

    onStart(): void {
        this.scheduleInject();
    }

    protected scheduleInject(): void {
        this.tryInject();

        if (this.injected) {
            return;
        }

        this.observer = new MutationObserver(() => {
            if (!this.injected) {
                this.tryInject();
            }
        });

        const startObserving = () => {
            if (document.body) {
                this.observer!.observe(document.body, { childList: true, subtree: true });
            } else {
                setTimeout(startObserving, 50);
            }
        };
        startObserving();

        this.retryTimer = setInterval(() => {
            if (this.injected || this.retryCount >= this.MAX_RETRIES) {
                if (this.retryTimer) {
                    clearInterval(this.retryTimer);
                    this.retryTimer = null;
                }
                return;
            }
            this.tryInject();
        }, 300);
    }

    protected findTopPanel(): HTMLElement | null {
        const selectors = [
            '#theia-top-panel',
            '.theia-top-panel',
            '[class*="theia-top-panel"]',
            '#theia-menubar',
            '.lm-MenuBar',
            '.p-MenuBar',
            '.theia-MenuBar',
        ];
        for (const sel of selectors) {
            try {
                const el = document.querySelector<HTMLElement>(sel);
                if (el) {
                    return el;
                }
            } catch { /* invalid selector */ }
        }
        return null;
    }

    protected tryInject(): void {
        if (this.retryCount >= this.MAX_RETRIES) {
            return;
        }
        this.retryCount++;

        if (document.getElementById('airo-secondary-toolbar')) {
            this.injected = true;
            this.cleanup();
            return;
        }

        // BEST APPROACH: Insert the toolbar INSIDE the top panel.
        // Theia's shell uses Lumino BoxPanel which absolutely positions its children.
        // If we insert the toolbar as a sibling, it won't be accounted for in the layout.
        // By putting it inside the top panel, the top panel grows to include it,
        // and Theia's layout engine automatically adjusts the main content area.
        const topPanel = this.findTopPanel();
        if (topPanel) {
            this.insertToolbarInsideTopPanel(topPanel);
            return;
        }

        // Fallback: If we can't find the top panel, try inserting before main content
        const mainPanel = document.getElementById('theia-main-content-panel') ||
            document.querySelector('.theia-main-content-panel') ||
            document.querySelector('[class*="main-content-panel"]');

        if (mainPanel && mainPanel.parentElement) {
            this.insertToolbarBefore(mainPanel);
            return;
        }
    }

    /**
     * Insert the toolbar INSIDE the top panel as its last child.
     * This is the correct approach because Theia's Lumino BoxPanel
     * absolutely positions its direct children (top-panel, main-content, etc.).
     * Adding the toolbar INSIDE the top panel means the top panel's height
     * naturally includes the toolbar, and the BoxPanel adjusts the main
     * content area automatically.
     */
    protected insertToolbarInsideTopPanel(topPanel: HTMLElement): void {
        const toolbarRow = this.createToolbarRow();

        // Make the top panel a flex column so menu bar and toolbar stack vertically
        topPanel.style.display = 'flex';
        topPanel.style.flexDirection = 'column';

        // Append toolbar as last child of top panel (below the menu bar)
        topPanel.appendChild(toolbarRow);

        this.injected = true;
        this.removeNavigationArrows();
        this.cleanup();

        // CRITICAL: Adjust the layout so the editor area doesn't overlap with the toolbar.
        // Theia's Lumino BoxPanel positions children absolutely with inline styles.
        // When the top panel grows (because we added the toolbar), the BoxPanel
        // doesn't recalculate the main content panel's position. We need to fix this.
        this.adjustLayoutAfterToolbarInsert();
    }

    protected insertToolbarBefore(beforeElement: HTMLElement): void {
        const toolbarRow = this.createToolbarRow();
        if (beforeElement.parentNode) {
            beforeElement.parentNode.insertBefore(toolbarRow, beforeElement);
        }
        this.injected = true;
        this.removeNavigationArrows();
        this.cleanup();
        this.adjustLayoutAfterToolbarInsert();
    }

    // ─── SVG Icons ────────────────────────────────────────────────────────────

    protected get compileIconSvg(): string {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    }

    protected get uploadIconSvg(): string {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
    }

    protected get serialIconSvg(): string {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;
    }

    protected get restartIconSvg(): string {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
    }

    // ─── Toolbar Creation ─────────────────────────────────────────────────────

    protected createToolbarRow(): HTMLElement {
        const toolbarRow = document.createElement('div');
        toolbarRow.id = 'airo-secondary-toolbar';
        toolbarRow.className = 'airo-secondary-toolbar';

        // Left group: Compile, Upload
        const leftGroup = document.createElement('div');
        leftGroup.className = 'airo-toolbar-left';

        leftGroup.appendChild(this.createButton(
            'airo-compile-btn',
            this.compileIconSvg,
            'Compile',
            '#27ae60',
            '#219a52',
            () => this.executeCommand('airo.compile')
        ));

        leftGroup.appendChild(this.createButton(
            'airo-upload-btn',
            this.uploadIconSvg,
            'Upload',
            '#e67e22',
            '#d35400',
            () => this.executeCommand('airo.upload')
        ));

        // Right group: Serial Monitor, Restart to Update (hidden until update is ready)
        const rightGroup = document.createElement('div');
        rightGroup.className = 'airo-toolbar-right';

        rightGroup.appendChild(this.createButton(
            'airo-serial-btn',
            this.serialIconSvg,
            'Serial Monitor',
            '#555555',
            '#444444',
            () => this.executeCommand('airo.serialMonitor')
        ));

        // Restart to Update button — hidden by default, shown when update is downloaded
        this.updateReadyBtn = this.createButton(
            'airo-restart-update-btn',
            this.restartIconSvg,
            'Restart to Update',
            '#c0392b',
            '#a93226',
            () => this.executeCommand('airo.restartUpdate')
        );
        this.updateReadyBtn.style.display = 'none';
        rightGroup.appendChild(this.updateReadyBtn);

        toolbarRow.appendChild(leftGroup);
        toolbarRow.appendChild(rightGroup);

        // Watch for update readiness via DOM signals
        // The updater extension will add a hidden signal element when update is ready
        this.watchForUpdateSignal();

        return toolbarRow;
    }

    /**
     * Watch for update readiness by observing the DOM.
     * The updater contribution adds a data-airone-update-ready attribute
     * to the body element when an update is downloaded and ready.
     * Also watches for the restart-to-update command becoming visible in menus.
     */
    protected watchForUpdateSignal(): void {
        // Check for the updater's signal element periodically
        const checkInterval = setInterval(() => {
            if (!this.updateReadyBtn) {
                clearInterval(checkInterval);
                return;
            }

            // Method 1: Check for data attribute on body set by the updater
            if (document.body.hasAttribute('data-airone-update-ready')) {
                this.showUpdateReadyButton();
                clearInterval(checkInterval);
                return;
            }

            // Method 2: Check if the restart-to-update menu item is visible
            const restartMenuItem = document.querySelector('[data-command="electron-theia:restart-to-update"]');
            if (restartMenuItem) {
                const parentLi = restartMenuItem.closest('li');
                if (parentLi && parentLi.offsetParent !== null) {
                    this.showUpdateReadyButton();
                    clearInterval(checkInterval);
                    return;
                }
            }
        }, 5000); // Check every 5 seconds (non-invasive)

        // Also observe DOM mutations for the signal element
        const signalObserver = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'data-airone-update-ready') {
                    if (document.body.hasAttribute('data-airone-update-ready')) {
                        this.showUpdateReadyButton();
                        signalObserver.disconnect();
                        return;
                    }
                }
            }
        });

        signalObserver.observe(document.body, { attributes: true, attributeFilter: ['data-airone-update-ready'] });
    }

    /**
     * Show the "Restart to Update" button in the toolbar.
     */
    showUpdateReadyButton(): void {
        if (this.updateReadyBtn) {
            this.updateReadyBtn.style.display = 'inline-flex';
        }
    }

    protected createButton(
        id: string,
        iconSvg: string,
        label: string,
        bg: string,
        hoverBg: string,
        onClick: () => void
    ): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.id = id;
        btn.title = label;
        btn.className = 'airo-toolbar-btn';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'airo-toolbar-icon';
        iconSpan.innerHTML = iconSvg;
        iconSpan.style.cssText = `
            display: inline-flex;
            align-items: center;
            margin-right: 5px;
            line-height: 1;
        `;

        const labelSpan = document.createElement('span');
        labelSpan.className = 'airo-toolbar-label';
        labelSpan.textContent = label;

        btn.appendChild(iconSpan);
        btn.appendChild(labelSpan);

        btn.style.cssText = `
            background: ${bg};
            color: white;
            border: 1px solid ${hoverBg};
            border-radius: 4px;
            padding: 4px 12px;
            cursor: pointer;
            font-weight: 700;
            font-size: 13px;
            white-space: nowrap;
            line-height: 24px;
            margin-left: 4px;
            margin-right: 2px;
            transition: filter 0.15s ease, transform 0.1s ease;
            letter-spacing: 0.3px;
            text-shadow: 0 1px 1px rgba(0,0,0,0.2);
            box-shadow: 0 1px 3px rgba(0,0,0,0.15);
            display: inline-flex;
            align-items: center;
        `;

        btn.addEventListener('mouseenter', () => {
            btn.style.filter = 'brightness(1.2)';
            btn.style.transform = 'translateY(-1px)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.filter = 'none';
            btn.style.transform = 'none';
        });
        btn.addEventListener('click', onClick);
        return btn;
    }

    // ─── Remove Navigation Arrows ─────────────────────────────────────────────

    protected removeNavigationArrows(): void {
        document.querySelectorAll<HTMLElement>('[data-command*="navigation.back"], [data-command*="navigation.forward"]').forEach(el => {
            this.hideElement(el);
        });

        document.querySelectorAll<HTMLElement>('[id*="navigation.back"], [id*="navigation.forward"], [id*="navigate.back"], [id*="navigate.forward"]').forEach(el => {
            this.hideElement(el);
        });

        document.querySelectorAll<HTMLElement>('button, [role="button"]').forEach(btn => {
            const title = (btn.title || '').toLowerCase();
            const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
            const text = (btn.textContent || '').trim();

            if (
                title.includes('navigate back') || title.includes('navigate forward') ||
                title === 'back' || title === 'forward' ||
                ariaLabel.includes('navigate back') || ariaLabel.includes('navigate forward') ||
                ariaLabel === 'back' || ariaLabel === 'forward' ||
                text === '←' || text === '→' ||
                text === '‹' || text === '›'
            ) {
                if (!btn.id.startsWith('airo-')) {
                    this.hideElement(btn);
                }
            }
        });
    }

    protected hideElement(el: HTMLElement): void {
        el.style.display = 'none';
        el.style.width = '0';
        el.style.height = '0';
        el.style.overflow = 'hidden';
        el.style.padding = '0';
        el.style.margin = '0';
        el.style.border = 'none';
        el.style.minWidth = '0';
        el.style.position = 'absolute';
        el.style.visibility = 'hidden';
        el.style.pointerEvents = 'none';
    }

    protected async executeCommand(commandId: string): Promise<void> {
        try {
            await this.commandService.executeCommand(commandId);
        } catch (err: any) {
            this.messageService.error(`Command error: ${err.message}`);
        }
    }

    /**
     * After the toolbar is inserted inside the top panel, the top panel's height
     * increases (because height: auto). But Theia's Lumino BoxPanel positions its
     * children (top panel, main content, bottom panel) absolutely with calculated
     * inline styles. The main content panel's `top` is still set to the old top
     * panel height, causing the toolbar to overlap the editor.
     *
     * This method:
     * 1. Observes the top panel's actual height with a ResizeObserver
     * 2. Adjusts the main content panel's `top` and `height` to account for it
     * 3. Also triggers Theia's shell layout update
     */
    protected adjustLayoutAfterToolbarInsert(): void {
        const adjustOnce = () => {
            const topPanel = this.findTopPanel();
            if (!topPanel) return;

            const actualHeight = topPanel.offsetHeight;

            // Find the main content panel and bottom panel
            const mainContentPanel = document.getElementById('theia-main-content-panel') ||
                document.querySelector('.theia-main-content-panel') as HTMLElement;
            const bottomPanel = document.getElementById('theia-bottom-panel') ||
                document.querySelector('.theia-bottom-panel') as HTMLElement;

            if (mainContentPanel) {
                // Override the inline `top` style set by Lumino BoxPanel
                mainContentPanel.style.top = `${actualHeight}px`;
            }

            if (bottomPanel) {
                // Also ensure the bottom panel is positioned correctly
                // The bottom panel should be below the main content panel
                const shellHeight = document.getElementById('theia-app-shell')?.offsetHeight || window.innerHeight;
                const bottomHeight = bottomPanel.offsetHeight || 0;
                bottomPanel.style.top = `${shellHeight - bottomHeight}px`;
            }

            // Trigger Theia's layout engine to recalculate
            try {
                // Dispatch a resize event which causes Theia's shell to recalculate layout
                window.dispatchEvent(new Event('resize'));
            } catch { /* ignore */ }
        };

        // Adjust immediately
        adjustOnce();

        // Adjust after multiple delays (Theia may reset the layout after initial render)
        setTimeout(adjustOnce, 50);
        setTimeout(adjustOnce, 100);
        setTimeout(adjustOnce, 250);
        setTimeout(adjustOnce, 500);
        setTimeout(adjustOnce, 1000);
        setTimeout(adjustOnce, 2000);

        // Set up ResizeObserver on the top panel to continuously adjust
        const topPanel = this.findTopPanel();
        if (topPanel) {
            this.layoutResizeObserver = new ResizeObserver(() => {
                adjustOnce();
            });
            this.layoutResizeObserver.observe(topPanel);
        }

        // Also observe when Theia's layout engine resets the main content panel's position
        const mainContentPanel = document.getElementById('theia-main-content-panel') ||
            document.querySelector('.theia-main-content-panel');
        if (mainContentPanel) {
            this.layoutMutationObserver = new MutationObserver(mutations => {
                for (const mutation of mutations) {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                        // Theia's layout engine may have reset the top position
                        // Re-apply our adjustment
                        const topPanel = this.findTopPanel();
                        if (topPanel) {
                            const actualHeight = topPanel.offsetHeight;
                            const currentTop = parseInt((mainContentPanel as HTMLElement).style.top || '0', 10);
                            if (currentTop !== actualHeight) {
                                (mainContentPanel as HTMLElement).style.top = `${actualHeight}px`;
                            }
                        }
                    }
                }
            });
            this.layoutMutationObserver.observe(mainContentPanel, {
                attributes: true,
                attributeFilter: ['style']
            });
        }

        // Also observe the app shell for layout changes that may reset positions
        const appShell = document.getElementById('theia-app-shell');
        if (appShell) {
            const shellObserver = new MutationObserver(() => {
                adjustOnce();
            });
            shellObserver.observe(appShell, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['style']
            });
        }
    }

    protected cleanup(): void {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        if (this.retryTimer) {
            clearInterval(this.retryTimer);
            this.retryTimer = null;
        }
        if (this.layoutResizeObserver) {
            this.layoutResizeObserver.disconnect();
            this.layoutResizeObserver = null;
        }
        if (this.layoutMutationObserver) {
            this.layoutMutationObserver.disconnect();
            this.layoutMutationObserver = null;
        }
    }

    dispose(): void {
        this.cleanup();
    }
}
