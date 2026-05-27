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
    private readonly MAX_RETRIES = 80;

    onStart(): void {
        this.injectToolbar();
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

        // Check if already injected
        if (document.getElementById('airo-secondary-toolbar')) {
            this.injected = true;
            return;
        }

        // Find the top panel container (which holds the menu bar)
        const topPanel = this.findTopPanel();
        if (!topPanel) {
            return;
        }

        // Create a NEW, SEPARATE toolbar row
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

        // Insert the new toolbar row RIGHT AFTER the top panel
        // (so it appears below the menu bar, not inside it)
        if (topPanel.parentNode) {
            topPanel.parentNode.insertBefore(toolbarRow, topPanel.nextSibling);
        }

        this.injected = true;

        // Also remove navigation arrows from the existing toolbar
        this.removeNavigationArrows();

        if (this.observer) {
            this.observer.disconnect();
        }
    }

    /**
     * Find the Theia top panel that contains the menu bar.
     * This is the container we insert AFTER (not into).
     */
    protected findTopPanel(): HTMLElement | null {
        // Theia's top panel selectors
        const selectors = [
            '#theia-top-panel',
            '.theia-top-panel',
            '[class*="top-panel"]',
        ];

        for (const sel of selectors) {
            try {
                const el = document.querySelector<HTMLElement>(sel);
                if (el) {
                    return el;
                }
            } catch { /* invalid selector */ }
        }

        // Fallback: find the menu bar and return its parent
        const menuBar = document.querySelector('.p-MenuBar, .theia-menubar, [class*="MenuBar"]');
        if (menuBar && menuBar.parentElement) {
            return menuBar.parentElement;
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
        // Remove back/forward navigation buttons from the Theia toolbar area
        // These are typically inside the top panel / menu bar area

        const topPanel = this.findTopPanel();
        if (!topPanel) {
            return;
        }

        // Find and hide all navigation-related items
        const allElements = topPanel.querySelectorAll('*');
        allElements.forEach(el => {
            if (!(el instanceof HTMLElement)) {
                return;
            }
            const id = el.id || '';
            const title = el.title || '';
            const textContent = el.textContent?.trim() || '';
            const className = el.className || '';
            const ariaLabel = el.getAttribute('aria-label') || '';
            const dataCommand = el.getAttribute('data-command') || '';

            // Match navigation back/forward
            const isNavArrow =
                id.includes('navigation.back') ||
                id.includes('navigation.forward') ||
                id.includes('navigate.back') ||
                id.includes('navigate.forward') ||
                dataCommand.includes('navigation.back') ||
                dataCommand.includes('navigation.forward') ||
                (title && (title.toLowerCase().includes('navigate back') || title.toLowerCase().includes('navigate forward'))) ||
                (ariaLabel && (ariaLabel.toLowerCase().includes('navigate back') || ariaLabel.toLowerCase().includes('navigate forward'))) ||
                // Theia 1.72 toolbar items
                (className.includes('toolbar-item') && (title.toLowerCase().includes('back') || title.toLowerCase().includes('forward')));

            if (isNavArrow) {
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
            }
        });
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
    }
}
