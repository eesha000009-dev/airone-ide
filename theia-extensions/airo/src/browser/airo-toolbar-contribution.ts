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

/**
 * Toolbar contribution that creates a SEPARATE toolbar row below the menu bar
 * for Compile, Verify, Upload, and Serial Monitor buttons.
 *
 * Auto-update: Updates are checked and downloaded automatically. When ready,
 * a "Restart to Update" button appears in the toolbar.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ [Logo] File  Edit  View  Libraries  Tools          [Cmd Palette]│ ← Menu bar row
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │ [▶ Compile] [✓ Verify] [↑ Upload]  [⎆ Serial] [↻ Restart]     │ ← Our toolbar row
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │ Main content area                                                │
 *   └──────────────────────────────────────────────────────────────────┘
 */
@injectable()
export class AiroToolbarContribution implements FrontendApplicationContribution {

    @inject(CommandService)
    protected readonly commandService!: CommandService;

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    private observer: MutationObserver | null = null;
    private injected = false;
    private retryCount = 0;
    private readonly MAX_RETRIES = 150;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    private updateReadyBtn: HTMLButtonElement | null = null;

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
        // Look for Theia's top panel area (the menu bar container)
        // Theia 1.72 uses Lumino (lm- prefix) instead of PhosphorJS (p- prefix)
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

        // Strategy 1: Find the top panel container
        const topPanel = this.findTopPanel();
        if (topPanel) {
            this.insertToolbarAfter(topPanel);
            return;
        }

        // Strategy 2: Find the shell and look for its first child
        const shell = document.getElementById('theia-shell') ||
            document.querySelector('.theia-shell') ||
            document.querySelector('[class*="theia-shell"]');

        if (shell && shell.firstElementChild) {
            this.insertToolbarAfter(shell.firstElementChild as HTMLElement);
            return;
        }

        // Strategy 3: Find any menubar and insert after its parent
        const menuBar = document.querySelector('.lm-MenuBar, .p-MenuBar, .theia-MenuBar');
        if (menuBar && menuBar.parentElement) {
            this.insertToolbarAfter(menuBar.parentElement);
            return;
        }

        // Strategy 4: Find the main content panel and insert before it
        const mainPanel = document.getElementById('theia-main-content-panel') ||
            document.querySelector('.theia-main-content-panel') ||
            document.querySelector('[class*="main-content-panel"]');

        if (mainPanel && mainPanel.parentElement) {
            this.insertToolbarBefore(mainPanel);
            return;
        }
    }

    protected insertToolbarAfter(afterElement: HTMLElement): void {
        const toolbarRow = this.createToolbarRow();
        if (afterElement.parentNode) {
            if (afterElement.nextSibling) {
                afterElement.parentNode.insertBefore(toolbarRow, afterElement.nextSibling);
            } else {
                afterElement.parentNode.appendChild(toolbarRow);
            }
        }
        this.injected = true;
        this.removeNavigationArrows();
        this.cleanup();
    }

    protected insertToolbarBefore(beforeElement: HTMLElement): void {
        const toolbarRow = this.createToolbarRow();
        if (beforeElement.parentNode) {
            beforeElement.parentNode.insertBefore(toolbarRow, beforeElement);
        }
        this.injected = true;
        this.removeNavigationArrows();
        this.cleanup();
    }

    // ─── SVG Icons ────────────────────────────────────────────────────────────

    protected get compileIconSvg(): string {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    }

    protected get verifyIconSvg(): string {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
    }

    protected get uploadIconSvg(): string {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
    }

    protected get serialIconSvg(): string {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;
    }

    protected get restartIconSvg(): string {
        // Restart/update icon
        return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
    }

    // ─── Toolbar Creation ─────────────────────────────────────────────────────

    protected createToolbarRow(): HTMLElement {
        const toolbarRow = document.createElement('div');
        toolbarRow.id = 'airo-secondary-toolbar';
        toolbarRow.className = 'airo-secondary-toolbar';

        // Left group: Compile, Verify, Upload
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
            'airo-verify-btn',
            this.verifyIconSvg,
            'Verify',
            '#2980b9',
            '#2471a3',
            () => this.executeCommand('airo.verify')
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
            () => this.executeCommand('electron-theia:restart-to-update')
        );
        this.updateReadyBtn.style.display = 'none';
        rightGroup.appendChild(this.updateReadyBtn);

        toolbarRow.appendChild(leftGroup);
        toolbarRow.appendChild(rightGroup);

        // Start watching for update readiness
        this.watchForUpdates();

        return toolbarRow;
    }

    /**
     * Watch for update readiness by observing the restart-to-update command availability.
     * When an update is downloaded, the updater contribution enables the restart command.
     * We check periodically and show the "Restart to Update" button when available.
     */
    protected watchForUpdates(): void {
        const checkInterval = setInterval(() => {
            if (!this.updateReadyBtn) {
                clearInterval(checkInterval);
                return;
            }
            // Check if the restart command is available by trying to execute a check
            // The updater contribution sets readyToUpdate = true when download completes
            // We use a simpler approach: listen for the command becoming visible
            this.commandService.executeCommand('electron-theia:restart-to-update').then(() => {
                // If the command executed, the update was ready and user chose to restart
            }).catch(() => {
                // Command not available yet — that's fine, keep checking
            });

            // Alternative: just check if the button should be visible
            // We rely on the Theia updater's notification flow instead
        }, 30000); // Check every 30 seconds

        // Also listen for DOM-based signals from the updater
        const updateObserver = new MutationObserver(() => {
            // The updater contribution adds "Restart to Update" to the menu
            // When we see it in the menu, show our toolbar button too
            const restartMenuItem = document.querySelector('[data-command="electron-theia:restart-to-update"]');
            if (restartMenuItem && this.updateReadyBtn) {
                this.updateReadyBtn.style.display = 'inline-flex';
            }
        });

        updateObserver.observe(document.body, { childList: true, subtree: true });
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

        // Create icon span
        const iconSpan = document.createElement('span');
        iconSpan.className = 'airo-toolbar-icon';
        iconSpan.innerHTML = iconSvg;
        iconSpan.style.cssText = `
            display: inline-flex;
            align-items: center;
            margin-right: 5px;
            line-height: 1;
        `;

        // Create label span
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

    protected cleanup(): void {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        if (this.retryTimer) {
            clearInterval(this.retryTimer);
            this.retryTimer = null;
        }
    }

    dispose(): void {
        this.cleanup();
    }
}
