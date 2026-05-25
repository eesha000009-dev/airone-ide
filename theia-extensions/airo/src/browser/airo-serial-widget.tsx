/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import * as React from 'react';

@injectable()
export class AiroSerialWidget extends ReactWidget {
    static readonly ID = 'airo-serial-monitor';
    static readonly LABEL = 'Serial Monitor';

    private lines: string[] = [];
    private connected: boolean = false;
    private selectedPort: string = '';
    private baudRate: number = 115200;

    @postConstruct()
    protected init(): void {
        this.id = AiroSerialWidget.ID;
        this.title.label = AiroSerialWidget.LABEL;
        this.title.caption = 'Airone Serial Monitor';
        this.title.iconClass = 'fa fa-plug';
        this.title.closable = true;
        this.update();
    }

    protected render(): React.ReactNode {
        return <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{
                padding: '4px 8px',
                borderBottom: '1px solid var(--theia-border-color)',
                display: 'flex',
                gap: '8px',
                alignItems: 'center',
                flexShrink: 0
            }}>
                <select
                    value={this.selectedPort}
                    onChange={(e) => { this.selectedPort = e.target.value; this.update(); }}
                    style={{
                        background: 'var(--theia-input-background)',
                        color: 'var(--theia-input-foreground)',
                        border: '1px solid var(--theia-border-color)',
                        padding: '2px 4px',
                        borderRadius: '2px'
                    }}
                >
                    <option value="">Select Port...</option>
                    <option value="COM3">COM3</option>
                    <option value="/dev/ttyUSB0">/dev/ttyUSB0</option>
                    <option value="/dev/ttyACM0">/dev/ttyACM0</option>
                </select>
                <select
                    value={this.baudRate.toString()}
                    onChange={(e) => { this.baudRate = parseInt(e.target.value); this.update(); }}
                    style={{
                        background: 'var(--theia-input-background)',
                        color: 'var(--theia-input-foreground)',
                        border: '1px solid var(--theia-border-color)',
                        padding: '2px 4px',
                        borderRadius: '2px'
                    }}
                >
                    <option value="9600">9600</option>
                    <option value="115200">115200</option>
                    <option value="57600">57600</option>
                    <option value="38400">38400</option>
                    <option value="19200">19200</option>
                    <option value="4800">4800</option>
                </select>
                <button
                    onClick={() => { this.connected = !this.connected; this.update(); }}
                    style={{
                        background: this.connected ? '#e74c3c' : '#27ae60',
                        color: 'white',
                        border: 'none',
                        padding: '2px 12px',
                        borderRadius: '2px',
                        cursor: 'pointer'
                    }}
                >
                    {this.connected ? 'Disconnect' : 'Connect'}
                </button>
                <button
                    onClick={() => { this.lines = []; this.update(); }}
                    style={{
                        background: 'var(--theia-input-background)',
                        color: 'var(--theia-input-foreground)',
                        border: '1px solid var(--theia-border-color)',
                        padding: '2px 8px',
                        borderRadius: '2px',
                        cursor: 'pointer'
                    }}
                >
                    Clear
                </button>
            </div>
            <div
                ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}
                style={{
                    flex: 1,
                    overflow: 'auto',
                    padding: '8px',
                    fontFamily: 'monospace',
                    fontSize: '13px',
                    whiteSpace: 'pre-wrap',
                    background: 'var(--theia-editor-background)',
                    color: 'var(--theia-editor-foreground)'
                }}
            >
                {this.lines.length === 0 ?
                    <span style={{ opacity: 0.5 }}>Serial Monitor - Select a port and click Connect</span> :
                    this.lines.map((line, i) => <div key={i}>{line}</div>)
                }
            </div>
            <div style={{
                padding: '4px 8px',
                borderTop: '1px solid var(--theia-border-color)',
                display: 'flex',
                gap: '4px',
                flexShrink: 0
            }}>
                <input
                    type="text"
                    placeholder="Send text to serial port..."
                    style={{
                        flex: 1,
                        background: 'var(--theia-input-background)',
                        color: 'var(--theia-input-foreground)',
                        border: '1px solid var(--theia-border-color)',
                        padding: '4px 8px',
                        borderRadius: '2px',
                        fontFamily: 'monospace'
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            const input = e.currentTarget.value;
                            this.lines.push(`> ${input}`);
                            e.currentTarget.value = '';
                            this.update();
                        }
                    }}
                />
            </div>
        </div>;
    }
}
