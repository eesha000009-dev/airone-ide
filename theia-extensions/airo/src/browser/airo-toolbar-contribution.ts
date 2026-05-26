/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { injectable, inject } from '@theia/core/shared/inversify';
import * as React from 'react';
import { AbstractToolbarContribution } from '@theia/toolbar/lib/browser/abstract-toolbar-contribution';
import { CommandService } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';

/**
 * Toolbar contribution that adds Compile, Verify, Upload, and Serial Monitor
 * buttons to the Theia toolbar (the strip below the menu bar).
 */
@injectable()
export class AiroToolbarContribution extends AbstractToolbarContribution {
    id = 'airo-toolbar';

    @inject(CommandService)
    protected readonly commandService: CommandService;

    @inject(MessageService)
    protected readonly messageService: MessageService;

    render(): React.ReactNode {
        return <div className="airo-toolbar-buttons" style={{
            display: 'flex',
            gap: '4px',
            alignItems: 'center',
            padding: '0 4px'
        }}>
            <button
                className="airo-toolbar-btn airo-toolbar-compile"
                onClick={() => this.executeCommand('airo.compile')}
                title="Compile (Ctrl+Shift+R)"
                style={{
                    background: '#27ae60',
                    color: 'white',
                    border: '1px solid #219a52',
                    borderRadius: '3px',
                    padding: '2px 10px',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: '12px',
                    whiteSpace: 'nowrap',
                    lineHeight: '20px'
                }}
            >
                ⏻ Compile
            </button>
            <button
                className="airo-toolbar-btn airo-toolbar-verify"
                onClick={() => this.executeCommand('airo.verify')}
                title="Verify (Ctrl+R)"
                style={{
                    background: '#2980b9',
                    color: 'white',
                    border: '1px solid #2471a3',
                    borderRadius: '3px',
                    padding: '2px 10px',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: '12px',
                    whiteSpace: 'nowrap',
                    lineHeight: '20px'
                }}
            >
                ✓ Verify
            </button>
            <button
                className="airo-toolbar-btn airo-toolbar-upload"
                onClick={() => this.executeCommand('airo.upload')}
                title="Upload (Ctrl+U)"
                style={{
                    background: '#e67e22',
                    color: 'white',
                    border: '1px solid #d35400',
                    borderRadius: '3px',
                    padding: '2px 10px',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: '12px',
                    whiteSpace: 'nowrap',
                    lineHeight: '20px'
                }}
            >
                → Upload
            </button>
            <button
                className="airo-toolbar-btn airo-toolbar-serial"
                onClick={() => this.executeCommand('airo.serialMonitor')}
                title="Serial Monitor (Ctrl+Shift+M)"
                style={{
                    background: 'var(--theia-button-background, #555)',
                    color: 'var(--theia-button-foreground, white)',
                    border: '1px solid var(--theia-border-color, #444)',
                    borderRadius: '3px',
                    padding: '2px 10px',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: '12px',
                    whiteSpace: 'nowrap',
                    lineHeight: '20px'
                }}
            >
                🔌 Serial Monitor
            </button>
        </div>;
    }

    protected async executeCommand(commandId: string): Promise<void> {
        try {
            await this.commandService.executeCommand(commandId);
        } catch (err: any) {
            this.messageService.error(`Command error: ${err.message}`);
        }
    }
}
