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

/**
 * Serial Monitor widget that uses the Web Serial API directly in the
 * frontend for connection, reading, and writing.
 *
 * This replaces the old backend serialport approach which failed in the
 * packaged Electron app because the native `serialport` module couldn't
 * be loaded properly.
 *
 * Port discovery still uses the backend service (which falls back to
 * PowerShell WMI / ls /dev on the OS), but the actual serial
 * communication happens entirely in the browser via navigator.serial.
 */
@injectable()
export class AiroSerialWidget extends ReactWidget {
    static readonly ID = 'airo-serial-monitor';
    static readonly LABEL = 'Serial Monitor';

    @inject(AiroSerialService) protected readonly serialService!: AiroSerialClient;
    @inject(MessageService) protected readonly messageService!: MessageService;

    private lines: string[] = [];
    private selectedPort: string = '';
    private baudRate: number = 115200;
    private availablePorts: SerialPortInfo[] = [];
    private refreshing: boolean = false;
    private connectionStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
    private refreshTimer: number | undefined;

    // ─── Web Serial API state ──────────────────────────────────────────
    private webSerialPort: SerialPort | undefined;
    private webSerialReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    private webSerialWriter: WritableStreamDefaultWriter<Uint8Array> | undefined;
    private webSerialReadableStream: ReadableStream<Uint8Array> | undefined;
    private webSerialWritableStream: WritableStream<Uint8Array> | undefined;
    private readLoopActive: boolean = false;
    private webSerialLineBuffer: string = '';

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
        if (this.connectionStatus === 'connected') {
            this.doDisconnect().catch(() => { /* ignore */ });
        }
    }

    /** Check if Web Serial API is available */
    private isWebSerialAvailable(): boolean {
        return typeof navigator !== 'undefined' && 'serial' in navigator;
    }

    // ─── Port Discovery ────────────────────────────────────────────────

    /** Fetch available ports from the backend (PowerShell WMI / ls /dev) */
    protected async refreshPorts(): Promise<void> {
        if (this.refreshing) {
            return;
        }
        this.refreshing = true;
        try {
            // Get ports from backend (works via PowerShell WMI on Windows)
            this.availablePorts = await this.serialService.listPorts();

            // Also add any Web Serial ports that were previously authorized
            if (this.isWebSerialAvailable()) {
                try {
                    const webPorts = await navigator.serial.getPorts();
                    for (const wp of webPorts) {
                        const info = wp.getInfo();
                        const vid = info.vendorId || '';
                        const pid = info.productId || '';
                        // Check if this port is already in the list
                        const portId = `WebSerial:${vid}:${pid}`;
                        const alreadyListed = this.availablePorts.some(p =>
                            p.vendorId === vid && p.productId === pid
                        );
                        if (!alreadyListed && (vid || pid)) {
                            this.availablePorts.push({
                                path: portId,
                                vendorId: vid,
                                productId: pid,
                                manufacturer: 'Web Serial',
                            });
                        }
                    }
                } catch {
                    // ignore
                }
            }

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

    // ─── Web Serial Connection ─────────────────────────────────────────

    /**
     * Connect to a serial port using the Web Serial API.
     *
     * Two flows:
     * 1. If the selected port starts with "WebSerial:" — use the matching
     *    previously-authorized Web Serial port directly.
     * 2. Otherwise — show the browser's port picker dialog and let the
     *    user select the correct port. We map the backend port path
     *    (e.g. "COM12") to the Web Serial port by VID/PID if possible.
     */
    protected async doConnect(): Promise<void> {
        if (!this.isWebSerialAvailable()) {
            this.lines.push('✗ Web Serial API not available.');
            this.lines.push('  Please use the Airone Electron app or a Chromium-based browser.');
            this.update();
            return;
        }

        this.connectionStatus = 'connecting';
        this.update();

        try {
            let port: SerialPort | undefined;

            // Strategy 1: Try to match a previously authorized Web Serial port
            const selectedInfo = this.availablePorts.find(p => p.path === this.selectedPort);
            if (selectedInfo && (selectedInfo.vendorId || selectedInfo.productId)) {
                const webPorts = await navigator.serial.getPorts();
                for (const wp of webPorts) {
                    const info = wp.getInfo();
                    if (info.vendorId === selectedInfo.vendorId && info.productId === selectedInfo.productId) {
                        port = wp;
                        break;
                    }
                }
            }

            // Strategy 2: Ask the user to pick a port via the browser dialog
            if (!port) {
                try {
                    this.lines.push('  Select your ESP32 board in the port picker dialog...');
                    this.update();
                    port = await navigator.serial.requestPort();
                } catch (err: unknown) {
                    // User cancelled the dialog
                    if (err instanceof DOMException && err.name === 'NotFoundError') {
                        this.connectionStatus = 'disconnected';
                        this.lines.push('  Port selection cancelled.');
                        this.update();
                        return;
                    }
                    throw err;
                }
            }

            if (!port) {
                this.connectionStatus = 'disconnected';
                this.lines.push('✗ No port selected.');
                this.update();
                return;
            }

            // Open the port at the selected baud rate
            await port.open({ baudRate: this.baudRate });

            this.webSerialPort = port;

            // Set up readable stream
            if (port.readable) {
                this.webSerialReadableStream = port.readable;
                this.webSerialReader = this.webSerialReadableStream.getReader();
            }

            // Set up writable stream
            if (port.writable) {
                this.webSerialWritableStream = port.writable;
                this.webSerialWriter = this.webSerialWritableStream.getWriter();
            }

            this.connectionStatus = 'connected';

            // Build display name
            const portInfo = port.getInfo();
            const displayName = this.selectedPort ||
                `VID:${portInfo.vendorId || '?'} PID:${portInfo.productId || '?'}`;
            this.lines.push(`✓ Connected to ${displayName} at ${this.baudRate} baud (Web Serial)`);

            // Start the read loop
            this.startReadLoop();

        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.connectionStatus = 'disconnected';
            this.lines.push(`✗ Connection failed: ${msg}`);

            // Provide helpful error messages
            if (msg.includes('Failed to open') || msg.includes('access denied') || msg.includes('permission')) {
                this.lines.push('  • Make sure no other program is using the port');
                this.lines.push('  • Try disconnecting and reconnecting the USB cable');
                this.lines.push('  • On Windows: close Arduino IDE, Putty, or other serial tools');
            } else if (msg.includes('not supported') || msg.includes('network error')) {
                this.lines.push('  • The port may not support serial communication');
            }

            // Clean up on error
            await this.cleanupWebSerial();
        }
        this.update();
    }

    /**
     * Continuously read data from the serial port and display it.
     * Runs in the background until the port is disconnected or closed.
     */
    private startReadLoop(): void {
        this.readLoopActive = true;
        this.webSerialLineBuffer = '';

        const readLoop = async () => {
            if (!this.webSerialReader || !this.readLoopActive) {
                return;
            }

            try {
                while (this.readLoopActive) {
                    const { value, done } = await this.webSerialReader.read();
                    if (done) {
                        // Stream ended
                        break;
                    }
                    if (value) {
                        // Decode the Uint8Array to text
                        const text = new TextDecoder().decode(value);
                        this.webSerialLineBuffer += text;

                        // Split into lines and display
                        const lines = this.webSerialLineBuffer.split('\n');
                        // Keep the last (possibly incomplete) line in the buffer
                        this.webSerialLineBuffer = lines.pop() || '';

                        for (const line of lines) {
                            if (line.length > 0) {
                                this.lines.push(line);
                            }
                        }

                        // Also push any partial content if it contains \r
                        if (this.webSerialLineBuffer.includes('\r')) {
                            const parts = this.webSerialLineBuffer.split('\r');
                            this.webSerialLineBuffer = parts.pop() || '';
                            for (const part of parts) {
                                if (part.length > 0) {
                                    this.lines.push(part);
                                }
                            }
                        }

                        // Limit buffer to last 500 lines
                        if (this.lines.length > 500) {
                            this.lines = this.lines.slice(-500);
                        }
                        this.update();
                    }
                }
            } catch (err: unknown) {
                if (this.readLoopActive) {
                    const msg = err instanceof Error ? err.message : String(err);
                    // Don't show error if we're disconnecting
                    if (!msg.includes('reader has been canceled') &&
                        !msg.includes('The device has been lost')) {
                        this.lines.push(`⚠ Read error: ${msg}`);
                    }
                }
            } finally {
                // If we exit the loop while still "connected", the port was likely disconnected
                if (this.readLoopActive && this.connectionStatus === 'connected') {
                    this.lines.push('⚠ Serial port disconnected unexpectedly.');
                    this.doDisconnect().catch(() => { /* ignore */ });
                }
            }
        };

        readLoop();
    }

    /** Disconnect from the current serial port */
    protected async doDisconnect(): Promise<void> {
        this.readLoopActive = false;
        this.webSerialLineBuffer = '';

        await this.cleanupWebSerial();

        this.connectionStatus = 'disconnected';
        this.lines.push(`✓ Disconnected`);
        this.update();
    }

    /** Clean up Web Serial resources */
    private async cleanupWebSerial(): Promise<void> {
        // Release writer
        if (this.webSerialWriter) {
            try {
                await this.webSerialWriter.close();
            } catch { /* ignore */ }
            this.webSerialWriter = undefined;
        }
        this.webSerialWritableStream = undefined;

        // Release reader
        if (this.webSerialReader) {
            try {
                await this.webSerialReader.cancel();
            } catch { /* ignore */ }
            this.webSerialReader = undefined;
        }
        this.webSerialReadableStream = undefined;

        // Close the port
        if (this.webSerialPort) {
            try {
                await this.webSerialPort.close();
            } catch { /* ignore — port may already be closed */ }
            this.webSerialPort = undefined;
        }
    }

    /** Send data to the serial port */
    protected async doSendData(data: string): Promise<void> {
        if (this.connectionStatus !== 'connected') {
            this.lines.push('⚠ Not connected — select a port and connect first.');
            this.update();
            return;
        }

        if (!this.webSerialWriter) {
            this.lines.push('✗ Cannot send — serial writer not available.');
            this.update();
            return;
        }

        try {
            const encoder = new TextEncoder();
            await this.webSerialWriter.write(encoder.encode(data + '\n'));
            this.lines.push(`> ${data}`);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.lines.push(`✗ Send error: ${msg}`);
        }
        this.update();
    }

    // ─── Render ────────────────────────────────────────────────────────

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

        const webSerialAvailable = this.isWebSerialAvailable();

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

                {/* Web Serial API indicator */}
                {!webSerialAvailable && (
                    <div style={{
                        fontSize: '10px',
                        color: '#f39c12',
                        background: '#f39c1222',
                        border: '1px solid #f39c12',
                        borderRadius: '2px',
                        padding: '1px 6px'
                    }}>
                        ⚠ Web Serial unavailable
                    </div>
                )}

                {/* Port Selector — populated from backend + Web Serial */}
                <select
                    value={this.selectedPort}
                    onChange={e => { this.selectedPort = e.target.value; this.update(); }}
                    disabled={this.connectionStatus === 'connected'}
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
                    disabled={this.connectionStatus === 'connected'}
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
                    onClick={() => this.connectionStatus === 'connected' ? this.doDisconnect() : this.doConnect()}
                    disabled={!webSerialAvailable}
                    style={{
                        background: this.connectionStatus === 'connected' ? '#e74c3c' : '#27ae60',
                        color: 'white',
                        border: 'none',
                        padding: '2px 12px',
                        borderRadius: '2px',
                        cursor: webSerialAvailable ? 'pointer' : 'not-allowed',
                        fontWeight: 'bold',
                        opacity: webSerialAvailable ? 1 : 0.5
                    }}
                >
                    {this.connectionStatus === 'connected' ? 'Disconnect' : 'Connect'}
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
                        {!webSerialAvailable && '\n⚠ Web Serial API not available — use the Airone Electron app'}
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
                    disabled={this.connectionStatus !== 'connected'}
                    style={{
                        flex: 1,
                        background: 'var(--theia-input-background)',
                        color: 'var(--theia-input-foreground)',
                        border: '1px solid var(--theia-border-color)',
                        padding: '4px 8px',
                        borderRadius: '2px',
                        fontFamily: 'monospace',
                        opacity: this.connectionStatus === 'connected' ? 1 : 0.5
                    }}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && this.connectionStatus === 'connected') {
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
