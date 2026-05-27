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
 * Toolbar contribution that injects Compile, Verify, Upload, Serial Monitor,
 * and Check for Updates buttons into the Theia toolbar area using DOM manipulation.
 *
 * Layout (far left → far right):
 *   [empty space where nav arrows were] ... [Compile] [Verify] [Upload] [Serial Monitor] [Check Updates] ... [Command Palette]
 */
@injectable()
export class AiroToolbarContribution implements FrontendApplicationContribution {

    @inject(CommandService)
    protected readonly commandService!: CommandService;

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    private observer: MutationObserver | null = null;
    private arrowObserver: MutationObserver | null = null;
    private injected = false;
    private arrowsRemoved = false;
    private retryCount = 0;
    private readonly MAX_RETRIES = 50;

    onStart(): void {
        this.injectToolbar();
        this.removeNavigationArrows();
    }

    // ─── Toolbar Injection ─────────────────────────────────────────────

    protected injectToolbar(): void {
        this.tryInject();

        this.observer = new MutationObserver(() => {
            if (!this.injected) {
                this.tryInject();
            }
        });

        if (document.body) {
            this.observer.observe(document.body, { childList: true, subtree: true });
        }
    }

    protected tryInject(): void {
        if (this.retryCount >= this.MAX_RETRIES) {
            return;
        }
        this.retryCount++;

        // Try multiple selectors for the Theia toolbar
        const toolbar = this.findToolbar();
        if (!toolbar) {
            return;
        }

        if (document.getElementById('airo-toolbar-group')) {
            this.injected = true;
            return;
        }

        const group = document.createElement('div');
        group.id = 'airo-toolbar-group';
        group.className = 'airo-toolbar-group';

        // Compile button (green)
        group.appendChild(this.createButton('airo-compile-btn', '⏻ Compile', '#27ae60', '#219a52', () => {
            this.executeCommand('airo.compile');
        }));

        // Verify button (blue)
        group.appendChild(this.createButton('airo-verify-btn', '✓ Verify', '#2980b9', '#2471a3', () => {
            this.executeCommand('airo.verify');
        }));

        // Upload button (orange)
        group.appendChild(this.createButton('airo-upload-btn', '→ Upload', '#e67e22', '#d35400', () => {
            this.executeCommand('airo.upload');
        }));

        // Serial Monitor button (dark gray)
        group.appendChild(this.createButton('airo-serial-btn', '⎆ Serial Monitor', '#555555', '#444444', () => {
            this.executeCommand('airo.serialMonitor');
        }));

        // Check for Updates button
        group.appendChild(this.createButton('airo-update-btn', '↻ Check Updates', '#7b1fa2', '#6a1b9a', () => {
            this.executeCommand('airo.checkUpdates');
        }));

        // Append at the END (far right, before command palette which is at the very end)
        // Find the command palette button and insert before it, or just append to end
        const commandPalette = toolbar.querySelector('[id*="command-palette"], [class*="command-palette"], [title*="Command"]');
        if (commandPalette && commandPalette.parentNode === toolbar) {
            toolbar.insertBefore(group, commandPalette);
        } else {
            toolbar.appendChild(group);
        }

        this.injected = true;

        if (this.observer) {
            this.observer.disconnect();
        }
    }

    protected findToolbar(): HTMLElement | null {
        // Try various Theia toolbar selectors
        const selectors = [
            '.theia-toolbar',
            '.p-TabBar.theia-toolbar',
            '[class*="theia-toolbar"]',
            '#theia-toolbar',
            '.theia-toolbar-container',
            '.theia-top-panel .theia-toolbar',
            // Theia 1.72 uses this structure
            '.theia-main-toolbar',
            'div.theia-toolbar',
        ];

        for (const sel of selectors) {
            const el = document.querySelector<HTMLElement>(sel);
            if (el && el.offsetParent !== null) {
                return el;
            }
        }

        // Last resort: find any toolbar-like container in the top area
        const topPanel = document.querySelector('.theia-top-panel, #theia-top-panel');
        if (topPanel) {
            const toolbar = topPanel.querySelector<HTMLElement>('div, section, nav');
            if (toolbar) {
                return toolbar;
            }
        }

        return null;
    }

    protected createButton(
        id: string,
        label: string,
        bg: string,
        border: string,
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
            border: 1px solid ${border};
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
        this.tryRemoveArrows();

        this.arrowObserver = new MutationObserver(() => {
            if (!this.arrowsRemoved) {
                this.tryRemoveArrows();
            }
        });

        if (document.body) {
            this.arrowObserver.observe(document.body, { childList: true, subtree: true });
        }
    }

    protected tryRemoveArrows(): void {
        // Find and remove back/forward navigation buttons
        // These are Theia toolbar items with navigation commands
        let removed = 0;

        // Strategy 1: Find by command IDs in toolbar items
        const toolbarItems = document.querySelectorAll('.theia-toolbar-item, [class*="toolbar-item"], [class*="toolbarItem"]');
        toolbarItems.forEach(item => {
            const id = item.id || '';
            const title = (item as HTMLElement).title || '';
            const textContent = item.textContent?.trim() || '';
            const className = item.className || '';

            if (
                id.includes('navigation.back') ||
                id.includes('navigation.forward') ||
                id.includes('navigate.back') ||
                id.includes('navigate.forward') ||
                title.toLowerCase().includes('back') ||
                title.toLowerCase().includes('forward') ||
                (textContent === '←' || textContent === '→') ||
                (textContent === '‹' || textContent === '›')
            ) {
                (item as HTMLElement).style.display = 'none';
                (item as HTMLElement).style.width = '0';
                (item as HTMLElement).style.height = '0';
                (item as HTMLElement).style.overflow = 'hidden';
                (item as HTMLElement).style.padding = '0';
                (item as HTMLElement).style.margin = '0';
                (item as HTMLElement).style.border = 'none';
                removed++;
            }
        });

        // Strategy 2: Find buttons in the toolbar area
        const toolbar = this.findToolbar();
        if (toolbar) {
            const buttons = toolbar.querySelectorAll('button, [role="button"]');
            buttons.forEach(btn => {
                const title = (btn as HTMLElement).title || '';
                const text = btn.textContent?.trim() || '';
                const ariaLabel = btn.getAttribute('aria-label') || '';

                if (
                    title.toLowerCase().includes('back') ||
                    title.toLowerCase().includes('forward') ||
                    ariaLabel.toLowerCase().includes('back') ||
                    ariaLabel.toLowerCase().includes('forward') ||
                    text === '←' || text === '→' ||
                    text === '‹' || text === '›'
                ) {
                    (btn as HTMLElement).style.display = 'none';
                    (btn as HTMLElement).style.width = '0';
                    (btn as HTMLElement).style.overflow = 'hidden';
                    (btn as HTMLElement).style.padding = '0';
                    (btn as HTMLElement).style.margin = '0';
                    removed++;
                }
            });
        }

        if (removed > 0) {
            this.arrowsRemoved = true;
            if (this.arrowObserver) {
                // Keep observing for a while in case they get re-added
                setTimeout(() => {
                    if (this.arrowObserver) {
                        this.arrowObserver.disconnect();
                    }
                }, 10000);
            }
        }
    }

    protected async executeCommand(commandId: string): Promise<void> {
        try {
            await this.commandService.executeCommand(commandId);
        } catch (err: any) {
            this.messageService.error(`Command error: ${err.message}`);
        }
    }

    dispose(): void {
        if (this.observer) {
            this.observer.disconnect();
        }
        if (this.arrowObserver) {
            this.arrowObserver.disconnect();
        }
    }
}
