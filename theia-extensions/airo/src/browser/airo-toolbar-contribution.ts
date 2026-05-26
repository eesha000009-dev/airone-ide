/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application';
import { CommandService } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';

/**
 * Toolbar contribution that injects Compile, Verify, Upload, and Serial Monitor
 * buttons into the Theia toolbar area using DOM manipulation.
 * This avoids depending on the @theia/toolbar package directly.
 */
@injectable()
export class AiroToolbarContribution implements FrontendApplicationContribution {

    @inject(CommandService)
    protected readonly commandService: CommandService;

    @inject(MessageService)
    protected readonly messageService: MessageService;

    private observer: MutationObserver | null = null;
    private injected = false;

    onStart(): void {
        this.injectToolbar();
    }

    protected injectToolbar(): void {
        // Try immediately
        this.doInject();

        // Also observe DOM changes in case toolbar loads later
        this.observer = new MutationObserver(() => {
            if (!this.injected) {
                this.doInject();
            }
        });

        if (document.body) {
            this.observer.observe(document.body, { childList: true, subtree: true });
        }
    }

    protected doInject(): void {
        // Find the toolbar container - Theia's toolbar area
        const toolbar = document.querySelector('.theia-toolbar, .p-TabBar.theia-toolbar, [class*="toolbar"]');
        if (!toolbar) {
            return;
        }

        // Check if we already injected
        if (document.getElementById('airo-toolbar-group')) {
            this.injected = true;
            return;
        }

        // Create the toolbar group
        const group = document.createElement('div');
        group.id = 'airo-toolbar-group';
        group.className = 'airo-toolbar-group';

        // Compile button
        group.appendChild(this.createButton('airo-compile-btn', '⏻ Compile', '#27ae60', '#219a52', () => {
            this.executeCommand('airo.compile');
        }));

        // Verify button
        group.appendChild(this.createButton('airo-verify-btn', '✓ Verify', '#2980b9', '#2471a3', () => {
            this.executeCommand('airo.verify');
        }));

        // Upload button
        group.appendChild(this.createButton('airo-upload-btn', '→ Upload', '#e67e22', '#d35400', () => {
            this.executeCommand('airo.upload');
        }));

        // Serial Monitor button
        group.appendChild(this.createButton('airo-serial-btn', '🔌 Serial Monitor', 'var(--theia-button-background, #555)', 'var(--theia-border-color, #444)', () => {
            this.executeCommand('airo.serialMonitor');
        }));

        // Insert at the beginning of the toolbar (left side)
        toolbar.insertBefore(group, toolbar.firstChild);
        this.injected = true;

        // Disconnect observer since we're done
        if (this.observer) {
            this.observer.disconnect();
        }
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
            border-radius: 3px;
            padding: 2px 10px;
            cursor: pointer;
            font-weight: 600;
            font-size: 12px;
            white-space: nowrap;
            line-height: 20px;
            margin-right: 4px;
            transition: filter 0.15s ease;
        `;
        btn.addEventListener('mouseenter', () => {
            btn.style.filter = 'brightness(1.15)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.filter = 'none';
        });
        btn.addEventListener('click', onClick);
        return btn;
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
