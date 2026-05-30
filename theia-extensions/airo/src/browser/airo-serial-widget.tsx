/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Message } from '@theia/core/lib/browser/widgets/widget';
import * as React from 'react';
import { AiroSerialService, AiroSerialClient, SerialPortInfo } from '../common/airo-protocol';
import { MessageService } from '@theia/core/lib/common/message-service';

@injectable()
export class AiroSerialWidget extends ReactWidget {
    static readonly ID = 'airo-serial-monitor';
    static readonly LABEL = 'Serial Monitor';

    @inject(AiroSerialService) protected readonly serialService!: AiroSerialClient;
    @inject(MessageService) protected readonly messageService!: MessageService;

    private lines: string[] = [];
    private connected: boolean = false;
    private selectedPort: string = '';
    private baudRate: number = 115200;
    private availablePorts: SerialPortInfo[] = [];
    private refreshing: boolean = false;
    private connectionStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
    private refreshTimer: number | undefined;
    private pollTimer: number | undefined;

    @postConstruct()
    protected init(): void {
        this.id = AiroSerialWidget.ID;
        this.title.label = AiroSerialWidget.LABEL;
        this.title.caption = 'Airone Serial Monitor';
        this.title.iconClass = 'fa fa-plug';
        this.title.closable = true;
        this.update();

        // Initial port list refresh
        this.refreshPorts();

        // Auto-refresh port list every 5 seconds
        this.refreshTimer = window.setInterval(() => this.refreshPorts(), 5000);
    }

    protected onCloseRequest(msg: Message): void {
        super.onCloseRequest(msg);
        if (this.refreshTimer !== undefined) {
            clearInterval(this.refreshTimer);
        }
        if (this.pollTimer !== undefined) {
            clearInterval(this.pollTimer);
        }
        if (this.connected) {
            this.serialService.disconnect().catch(() => { /* ignore */ });
        }
    }

    /** Fetch real available ports from the backend service */
    protected async refreshPorts(): Promise<void> {
        if (this.refreshing) {
            return;
        }
        this.refreshing = true;
        try {
            this.availablePorts = await this.serialService.listPorts();

            // If currently selected port is no longer available, reset selection
            if (this.selectedPort) {
                const stillExists = this.availablePorts.some(p => p.path === this.selectedPort);
                if (!stillExists) {
                    this.selectedPort = '';
                }
            }

            // Auto-select if only one port and none selected
            if (!this.selectedPort && this.availablePorts.length === 1) {
                this.selectedPort = this.availablePorts[0].path;
            }

            this.update();
        } catch (err: any) {
            // Silently fail — don't spam errors every 5s
            this.availablePorts = [];
            this.update();
        } finally {
            this.refreshing = false;
        }
    }

    /** Connect to the selected serial port */
    protected async doConnect(): Promise<void> {
        if (!this.selectedPort) {
            this.lines.push('⚠ Please select a port first.');
            this.update();
            return;
        }

        this.connectionStatus = 'connecting';
        this.update();

        try {
            const success = await this.serialService.connect(this.selectedPort, this.baudRate);
            if (success) {
                this.connected = true;
                this.connectionStatus = 'connected';
                this.lines.push(`✓ Connected to ${this.selectedPort} at ${this.baudRate} baud`);

                // Start polling for serial data (since RPC proxy doesn't support push callbacks)
                this.startDataPolling();
            } else {
                this.connected = false;
                this.connectionStatus = 'disconnected';
                this.lines.push(`✗ Failed to connect to ${this.selectedPort}`);
            }
        } catch (err: any) {
            this.connected = false;
            this.connectionStatus = 'disconnected';
            this.lines.push(`✗ Connection error: ${err.message}`);
        }
        this.update();
    }

    /** Start polling for serial data */
    protected startDataPolling(): void {
        if (this.pollTimer !== undefined) {
            clearInterval(this.pollTimer);
        }
        // Poll every 200ms for available data
        this.pollTimer = window.setInterval(async () => {
            if (!this.connected) {
                return;
            }
            try {
                const data = await this.serialService.readAvailable();
                if (data && data.length > 0) {
                    this.lines.push(data);
                    // Limit buffer to last 500 lines
                    if (this.lines.length > 500) {
                        this.lines = this.lines.slice(-500);
                    }
                    this.update();
                }
            } catch {
                // Connection may have been lost
            }
        }, 200);
    }

    /** Disconnect from the current serial port */
    protected async doDisconnect(): Promise<void> {
        if (this.pollTimer !== undefined) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
        try {
            await this.serialService.disconnect();
            this.connected = false;
            this.connectionStatus = 'disconnected';
            this.lines.push(`✓ Disconnected from ${this.selectedPort}`);
        } catch (err: any) {
            this.lines.push(`✗ Disconnect error: ${err.message}`);
        }
        this.update();
    }

    /** Send data to the serial port */
    protected async doSendData(data: string): Promise<void> {
        if (!this.connected) {
            this.lines.push('⚠ Not connected — select a port and connect first.');
            this.update();
            return;
        }
        try {
            const success = await this.serialService.sendData(data + '\n');
            if (success) {
                this.lines.push(`> ${data}`);
            } else {
                this.lines.push('✗ Failed to send data.');
            }
        } catch (err: any) {
            this.lines.push(`✗ Send error: ${err.message}`);
        }
        this.update();
    }

    protected render(): React.ReactNode {
        const statusColors: Record<string, string> = {
            disconnected: '#e74c3c',
            connecting: '#f39c12',
            connected: '#27ae60'
        };
        const statusLabels: Record<string, string> = {
            disconnected: 'Disconnected',
            connecting: 'Connecting...',
            connected: 'Connected'
        };

        return <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Connection Status Bar */}
            <div style={{
                padding: '4px 8px',
                borderBottom: '1px solid var(--theia-border-color)',
                display: 'flex',
                gap: '8px',
                alignItems: 'center',
                flexShrink: 0
            }}>
                {/* Connection Status Indicator */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '2px 8px',
                    borderRadius: '2px',
                    background: statusColors[this.connectionStatus] + '22',
                    border: `1px solid ${statusColors[this.connectionStatus]}`,
                    fontSize: '11px',
                    color: statusColors[this.connectionStatus],
                    fontWeight: 'bold'
                }}>
                    <div style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: statusColors[this.connectionStatus]
                    }} />
                    {statusLabels[this.connectionStatus]}
                </div>

                {/* Port Selector — populated from backend */}
                <select
                    value={this.selectedPort}
                    onChange={e => { this.selectedPort = e.target.value; this.update(); }}
                    disabled={this.connected}
                    style={{
                        background: 'var(--theia-input-background)',
                        color: 'var(--theia-input-foreground)',
                        border: '1px solid var(--theia-border-color)',
                        padding: '2px 4px',
                        borderRadius: '2px',
                        minWidth: '120px'
                    }}
                >
                    <option value="">
                        {this.availablePorts.length === 0
                            ? 'No ports found'
                            : 'Select Port...'}
                    </option>
                    {this.availablePorts.map(port => (
                        <option key={port.path} value={port.path}>
                            {port.path}{port.manufacturer ? ` (${port.manufacturer})` : ''}
                        </option>
                    ))}
                </select>

                {/* Baud Rate Selector */}
                <select
                    value={this.baudRate.toString()}
                    onChange={e => { this.baudRate = parseInt(e.target.value); this.update(); }}
                    disabled={this.connected}
                    style={{
                        background: 'var(--theia-input-background)',
                        color: 'var(--theia-input-foreground)',
                        border: '1px solid var(--theia-border-color)',
                        padding: '2px 4px',
                        borderRadius: '2px'
                    }}
                >
                    <option value="9600">9600</option>
                    <option value="19200">19200</option>
                    <option value="38400">38400</option>
                    <option value="57600">57600</option>
                    <option value="115200">115200</option>
                    <option value="230400">230400</option>
                    <option value="460800">460800</option>
                    <option value="921600">921600</option>
                </select>

                {/* Connect / Disconnect Button */}
                <button
                    onClick={() => this.connected ? this.doDisconnect() : this.doConnect()}
                    style={{
                        background: this.connected ? '#e74c3c' : '#27ae60',
                        color: 'white',
                        border: 'none',
                        padding: '2px 12px',
                        borderRadius: '2px',
                        cursor: 'pointer',
                        fontWeight: 'bold'
                    }}
                >
                    {this.connected ? 'Disconnect' : 'Connect'}
                </button>

                {/* Refresh Ports */}
                <button
                    onClick={() => this.refreshPorts()}
                    title="Refresh port list"
                    disabled={this.refreshing}
                    style={{
                        background: 'var(--theia-input-background)',
                        color: 'var(--theia-input-foreground)',
                        border: '1px solid var(--theia-border-color)',
                        padding: '2px 8px',
                        borderRadius: '2px',
                        cursor: this.refreshing ? 'wait' : 'pointer'
                    }}
                >
                    ↻
                </button>

                {/* Clear Console */}
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

            {/* Console Output */}
            <div
                ref={el => { if (el) {el.scrollTop = el.scrollHeight; } }}
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
                    <span style={{ opacity: 0.5 }}>
                        Serial Monitor — Select a port and click Connect
                        {this.availablePorts.length === 0 &&
                            '\nNo serial ports detected. Connect your board via USB.'}
                    </span> :
                    this.lines.map((line, i) => <div key={i}>{line}</div>)
                }
            </div>

            {/* Send Input */}
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
                    disabled={!this.connected}
                    style={{
                        flex: 1,
                        background: 'var(--theia-input-background)',
                        color: 'var(--theia-input-foreground)',
                        border: '1px solid var(--theia-border-color)',
                        padding: '4px 8px',
                        borderRadius: '2px',
                        fontFamily: 'monospace',
                        opacity: this.connected ? 1 : 0.5
                    }}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && this.connected) {
                            const input = e.currentTarget.value;
                            if (input.trim()) {
                                this.doSendData(input);
                                e.currentTarget.value = '';
                            }
                        }
                    }}
                />
            </div>
        </div>;
    }
}
