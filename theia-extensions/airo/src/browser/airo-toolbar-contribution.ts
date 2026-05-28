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
 * for Compile, Verify, Upload, Serial Monitor, and Check for Updates buttons.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ [Logo] File  Edit  View  Libraries  Tools    [Cmd Palette] │ ← Menu bar row
 *   ├─────────────────────────────────────────────────────────────┤
 *   │ [Compile] [Verify] [Upload] [Serial Monitor]  [↻ Updates]  │ ← Our toolbar row
 *   ├─────────────────────────────────────────────────────────────┤
 *   │ Main content area                                           │
 *   └─────────────────────────────────────────────────────────────┘
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

    onStart(): void {
        this.scheduleInject();
    }

    protected scheduleInject(): void {
        // Try immediately
        this.tryInject();

        if (this.injected) {
            return;
        }

        // Also use MutationObserver as backup
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

        // Also use timed retries as ultimate fallback
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

    protected tryInject(): void {
        if (this.retryCount >= this.MAX_RETRIES) {
            return;
        }
        this.retryCount++;

        // Check if already injected
        if (document.getElementById('airo-secondary-toolbar')) {
            this.injected = true;
            this.cleanup();
            return;
        }

        // Strategy 1: Find the top panel container
        const topPanel = this.findTopPanel();
        if (topPanel) {
            this.insertToolbar(topPanel);
            return;
        }

        // Strategy 2: Find the shell and look for its first child
        const shell = document.getElementById('theia-shell') ||
            document.querySelector('.theia-shell') ||
            document.querySelector('[class*="theia-shell"]');

        if (shell && shell.firstElementChild) {
            this.insertToolbar(shell.firstElementChild as HTMLElement);
            return;
        }

        // Strategy 3: Find any menubar and insert after its parent
        const menuBar = document.querySelector('.p-MenuBar, .theia-MenuBar, [class*="MenuBar"]');
        if (menuBar) {
            const parent = menuBar.parentElement;
            if (parent) {
                this.insertToolbar(parent);
                return;
            }
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

    protected insertToolbar(afterElement: HTMLElement): void {
        const toolbarRow = this.createToolbarRow();

        // Insert after the top panel (so it appears below the menu bar)
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

    protected createToolbarRow(): HTMLElement {
        const toolbarRow = document.createElement('div');
        toolbarRow.id = 'airo-secondary-toolbar';
        toolbarRow.className = 'airo-secondary-toolbar';

        // Left group: Compile, Verify, Upload
        const leftGroup = document.createElement('div');
        leftGroup.className = 'airo-toolbar-left';

        leftGroup.appendChild(this.createButton('airo-compile-btn', '⏻ Compile', '#27ae60', '#219a52', () => {
            this.executeCommand('airo.compile');
        }));

        leftGroup.appendChild(this.createButton('airo-verify-btn', '✓ Verify', '#2980b9', '#2471a3', () => {
            this.executeCommand('airo.verify');
        }));

        leftGroup.appendChild(this.createButton('airo-upload-btn', '→ Upload', '#e67e22', '#d35400', () => {
            this.executeCommand('airo.upload');
        }));

        // Right group: Serial Monitor, Check Updates
        const rightGroup = document.createElement('div');
        rightGroup.className = 'airo-toolbar-right';

        rightGroup.appendChild(this.createButton('airo-serial-btn', '⎆ Serial Monitor', '#555555', '#444444', () => {
            this.executeCommand('airo.serialMonitor');
        }));

        rightGroup.appendChild(this.createButton('airo-update-btn', '↻ Check Updates', '#7b1fa2', '#6a1b9a', () => {
            this.executeCommand('airo.checkUpdates');
        }));

        toolbarRow.appendChild(leftGroup);
        toolbarRow.appendChild(rightGroup);

        return toolbarRow;
    }

    /**
     * Find the Theia top panel that contains the menu bar.
     */
    protected findTopPanel(): HTMLElement | null {
        // Theia 1.72 top panel selectors - try most specific first
        const selectors = [
            '#theia-top-panel',
            '.theia-top-panel',
            '#theia-top-panel-container',
            '[class*="top-panel"]',
            '[id*="top-panel"]',
        ];

        for (const sel of selectors) {
            try {
                const el = document.querySelector<HTMLElement>(sel);
                if (el && el.offsetHeight > 0) {
                    return el;
                }
            } catch { /* invalid selector */ }
        }

        // Fallback: find the menu bar and return its parent
        const menuBar = document.querySelector('.p-MenuBar, .theia-MenuBar, [class*="MenuBar"]');
        if (menuBar && menuBar.parentElement) {
            return menuBar.parentElement;
        }

        return null;
    }

    protected createButton(
        id: string,
        label: string,
        bg: string,
        hoverBg: string,
        onClick: () => void
    ): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.id = id;
        btn.textContent = label;
        btn.title = label;
        btn.className = 'airo-toolbar-btn';
        btn.style.cssText = `
            background: ${bg};
            color: white;
            border: 1px solid ${hoverBg};
            border-radius: 4px;
            padding: 4px 14px;
            cursor: pointer;
            font-weight: 700;
            font-size: 13px;
            white-space: nowrap;
            line-height: 24px;
            margin-left: 6px;
            margin-right: 2px;
            transition: filter 0.15s ease, transform 0.1s ease;
            letter-spacing: 0.3px;
            text-shadow: 0 1px 1px rgba(0,0,0,0.2);
            box-shadow: 0 1px 3px rgba(0,0,0,0.15);
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

    // ─── Remove Navigation Arrows ───────────────────────────────────────

    protected removeNavigationArrows(): void {
        // Remove back/forward navigation buttons from the Theia toolbar area
        // Try multiple strategies to find and hide them

        // Strategy 1: By data-command attribute
        document.querySelectorAll<HTMLElement>('[data-command*="navigation.back"], [data-command*="navigation.forward"]').forEach(el => {
            this.hideElement(el);
        });

        // Strategy 2: By ID patterns
        document.querySelectorAll<HTMLElement>('[id*="navigation.back"], [id*="navigation.forward"], [id*="navigate.back"], [id*="navigate.forward"]').forEach(el => {
            this.hideElement(el);
        });

        // Strategy 3: By title/aria-label
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
                // Don't hide our own buttons
                if (!btn.id.startsWith('airo-')) {
                    this.hideElement(btn);
                }
            }
        });

        // Strategy 4: By class patterns in toolbar area
        document.querySelectorAll<HTMLElement>('.theia-toolbar-item, [class*="toolbar-item"]').forEach(item => {
            const id = item.id || '';
            const title = item.title || '';
            const dataCommand = item.getAttribute('data-command') || '';

            if (
                id.includes('navigation') ||
                dataCommand.includes('navigation') ||
                (title && (title.toLowerCase().includes('back') || title.toLowerCase().includes('forward')))
            ) {
                this.hideElement(item);
            }
        });

        // Strategy 5: Find the entire Theia toolbar and hide navigation items within it
        const toolbarArea = document.querySelector('.theia-toolbar, [class*="theia-toolbar"]');
        if (toolbarArea) {
            toolbarArea.querySelectorAll<HTMLElement>('*').forEach(el => {
                const cls = el.className || '';
                const title = el.title || '';
                const id = el.id || '';

                if (
                    cls.includes('navigation') ||
                    id.includes('navigation') ||
                    (title && (title.toLowerCase().includes('back') || title.toLowerCase().includes('forward')))
                ) {
                    this.hideElement(el);
                }
            });
        }
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
