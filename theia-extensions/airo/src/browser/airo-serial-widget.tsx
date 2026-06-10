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
 * Known ESP32 USB-to-UART vendor IDs.
 */
const ESP_VENDOR_IDS = new Set([
    '10c4',  // Silicon Labs CP210x
    '1a86',  // QinHeng CH340 / CH9102
    '0403',  // FTDI FT232
    '303a',  // Espressif built-in USB (ESP32-S2/S3/C3 native USB)
    '2e8a',  // Raspberry Pi Pico (RP2040 running ESP firmware)
]);

/**
 * Normalize a vendor/product ID by removing '0x' prefix and lowercasing.
 */
function normalizeId(id: string | undefined): string {
    return (id || '').toLowerCase().replace(/^0x/, '');
}

/**
 * Check if a port's VID matches known ESP32 USB bridge chips.
 */
function isEspPort(port: SerialPort): boolean {
    const vid = normalizeId(port.getInfo().vendorId);
    return ESP_VENDOR_IDS.has(vid);
}

/**
 * Serial Monitor widget that uses the Web Serial API directly in the
 * frontend for connection, reading, and writing.
 *
 * Key features:
 * - Real connection verification (port signals check + VID/PID detection)
 * - Automatic disconnect detection via navigator.serial 'disconnect' event
 * - ESP32 board auto-detection with clear status indicators
 * - Backend port listing (PowerShell WMI / ls /dev) + Web Serial ports
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
    private connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'verifying' = 'disconnected';
    private connectedPortType: 'esp32' | 'serial' | 'unknown' = 'unknown';
    private refreshTimer: number | undefined;
    private disconnectHandler: ((ev: SerialEvent) => void) | undefined;

    // ─── Web Serial API state ──────────────────────────────────────────
    private webSerialPort: SerialPort | undefined;
    private webSerialReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    private webSerialWriter: WritableStreamDefaultWriter<Uint8Array> | undefined;
    private webSerialReadableStream: ReadableStream<Uint8Array> | undefined;
    private webSerialWritableStream: WritableStream<Uint8Array> | undefined;
    private readLoopActive: boolean = false;
    private webSerialLineBuffer: string = '';
    private keepaliveTimer: number | undefined;

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

        // Listen for USB serial device disconnection events
        if (this.isWebSerialAvailable()) {
            this.disconnectHandler = (ev: SerialEvent) => {
                const disconnectedPort = ev.target;
                if (this.webSerialPort === disconnectedPort) {
                    this.lines.push('⚠ USB device physically disconnected!');
                    this.forceDisconnect();
                }
            };
            navigator.serial.addEventListener('disconnect', this.disconnectHandler);
        }
    }

    protected onCloseRequest(msg: Message): void {
        super.onCloseRequest(msg);
        if (this.refreshTimer !== undefined) {
            clearInterval(this.refreshTimer);
        }
        // Remove disconnect listener
        if (this.disconnectHandler && this.isWebSerialAvailable()) {
            try {
                navigator.serial.removeEventListener('disconnect', this.disconnectHandler);
            } catch { /* ignore */ }
            this.disconnectHandler = undefined;
        }
        if (this.connectionStatus === 'connected' || this.connectionStatus === 'verifying') {
            this.doDisconnect().catch(() => { /* ignore */ });
        }
    }

    /** Check if Web Serial API is available */
    private isWebSerialAvailable(): boolean {
        return typeof navigator !== 'undefined' && 'serial' in navigator;
    }

    /** Detect if running inside Electron */
    private isElectron(): boolean {
        return typeof navigator !== 'undefined' &&
            (navigator.userAgent.includes('Electron') || navigator.userAgent.includes('airone'));
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
     * Connection flow:
     * 1. Obtain a SerialPort (from authorized ports or requestPort)
     * 2. Open the port
     * 3. Verify the connection (check VID/PID, try port signals)
     * 4. Set up read loop + disconnect listener
     * 5. Start keepalive pings to detect silent disconnections
     */
    protected async doConnect(): Promise<void> {
        if (!this.isWebSerialAvailable()) {
            this.lines.push('✗ Web Serial API not available.');
            this.lines.push('  Please use the Airone Electron app or a Chromium-based browser.');
            this.update();
            return;
        }

        this.connectionStatus = 'connecting';
        this.connectedPortType = 'unknown';
        this.update();

        try {
            let port: SerialPort | undefined;

            // ── Step 1: Obtain a SerialPort ────────────────────────────
            port = await this.obtainPort();

            if (!port) {
                this.connectionStatus = 'disconnected';
                this.update();
                return;
            }

            // ── Step 2: Open the port ──────────────────────────────────
            this.lines.push(`  Opening ${this.baudRate} baud...`);
            this.update();

            try {
                await port.open({ baudRate: this.baudRate });
            } catch (openErr: unknown) {
                const openMsg = openErr instanceof Error ? openErr.message : String(openErr);
                // If the port is already open, it might be from a stale session
                if (openMsg.includes('already open')) {
                    this.lines.push('  ⚠ Port was already open. Closing and retrying...');
                    this.update();
                    try { await port.close(); } catch { /* ignore */ }
                    await port.open({ baudRate: this.baudRate });
                } else {
                    throw openErr;
                }
            }

            this.webSerialPort = port;

            // ── Step 3: Verify the connection ──────────────────────────
            this.connectionStatus = 'verifying';
            this.update();

            const verification = await this.verifyConnection(port);
            this.connectedPortType = verification.type;

            if (!verification.isReal) {
                // Port opened but no real device detected
                this.lines.push(`⚠ ${verification.message}`);
                this.lines.push('  The port is open but may not have a device attached.');
                this.lines.push('  Data will appear here if the device starts sending.');
            } else {
                this.lines.push(`✓ ${verification.message}`);
            }

            // ── Step 4: Set up streams ─────────────────────────────────
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

            // Build display name with board type
            const portInfo = port.getInfo();
            const typeLabel = this.connectedPortType === 'esp32' ? ' [ESP32]' :
                this.connectedPortType === 'serial' ? ' [USB-Serial]' : '';
            const displayName = this.selectedPort ||
                `VID:${portInfo.vendorId || '?'} PID:${portInfo.productId || '?'}`;
            this.lines.push(`✓ Connected to ${displayName}${typeLabel} at ${this.baudRate} baud`);

            // Start the read loop
            this.startReadLoop();

            // Start keepalive to detect silent disconnections
            this.startKeepalive();

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
            } else if (msg.includes('open') && msg.includes('already')) {
                this.lines.push('  • The port is already open in another connection');
                this.lines.push('  • Disconnect first, then try again');
            }

            // Clean up on error
            await this.cleanupWebSerial();
        }
        this.update();
    }

    /**
     * Obtain a SerialPort by matching authorized ports first,
     * then falling back to requestPort().
     */
    private async obtainPort(): Promise<SerialPort | undefined> {
        let port: SerialPort | undefined;

        // Strategy 1: Try previously authorized ports by VID/PID match
        const selectedInfo = this.availablePorts.find(p => p.path === this.selectedPort);
        if (selectedInfo && (selectedInfo.vendorId || selectedInfo.productId)) {
            const webPorts = await navigator.serial.getPorts();
            for (const wp of webPorts) {
                const wpVid = normalizeId(wp.getInfo().vendorId);
                const wpPid = normalizeId(wp.getInfo().productId);
                const selVid = normalizeId(selectedInfo.vendorId);
                const selPid = normalizeId(selectedInfo.productId);
                if (wpVid === selVid && wpPid === selPid) {
                    port = wp;
                    this.lines.push(`  Matched authorized Web Serial port (VID:${wpVid} PID:${wpPid})`);
                    break;
                }
            }
        }

        // Strategy 2: requestPort() — in Electron, auto-selected by handler
        if (!port) {
            try {
                if (this.isElectron()) {
                    this.lines.push('  Requesting serial port access (auto-select via Electron)...');
                } else {
                    this.lines.push('  Select your ESP32 board in the port picker dialog...');
                }
                this.update();
                port = await navigator.serial.requestPort();
            } catch (err: unknown) {
                if (err instanceof DOMException && err.name === 'NotFoundError') {
                    // In Electron: no serial ports found by Chromium
                    // In browser: user cancelled the dialog
                    if (this.isElectron()) {
                        this.lines.push('✗ No serial ports detected by Web Serial API.');
                        this.lines.push('  Possible causes:');
                        this.lines.push('  • The board is not connected via USB');
                        this.lines.push('  • USB drivers are not installed (check Device Manager)');
                        this.lines.push('  • Another program is using the port');
                        this.lines.push('  • Try: unplug USB, wait 3 seconds, plug back in');
                    } else {
                        this.lines.push('  Port selection cancelled.');
                    }
                    this.update();
                    return undefined;
                }
                throw err;
            }
        }

        if (!port) {
            this.lines.push('✗ No port selected.');
            this.update();
            return undefined;
        }

        return port;
    }

    /**
     * Verify that a serial port has a real device attached.
     *
     * Checks:
     * 1. VID/PID match against known ESP32 USB bridge chips
     * 2. Port signal states (DTR/RTS/CTS/DSR/CD/RI) — if signals are
     *    all zero, the port may be a ghost device with no hardware
     * 3. Attempt a small read with timeout to detect if data flows
     */
    private async verifyConnection(port: SerialPort): Promise<{
        isReal: boolean;
        type: 'esp32' | 'serial' | 'unknown';
        message: string;
    }> {
        const portInfo = port.getInfo();
        const vid = normalizeId(portInfo.vendorId);
        const pid = normalizeId(portInfo.productId);

        // Check 1: ESP32 VID/PID detection
        if (ESP_VENDOR_IDS.has(vid)) {
            const chipNames: Record<string, string> = {
                '10c4': 'CP210x',
                '1a86': 'CH340/CH9102',
                '0403': 'FT232',
                '303a': 'ESP32 native USB',
                '2e8a': 'RP2040',
            };
            const chipName = chipNames[vid] || 'Unknown';
            return {
                isReal: true,
                type: 'esp32',
                message: `ESP32 board detected (${chipName} USB bridge, VID:${vid} PID:${pid})`,
            };
        }

        // Check 2: Try reading port signals
        // Web Serial API provides getSignals() to check DTR, CTS, DSR, CD, RI
        let hasSignals = false;
        try {
            const signals = await port.getSignals();
            // If any signal is asserted, there's likely real hardware
            if (signals && (signals.dataCarrierDetect || signals.clearToSend ||
                signals.dataSetReady || signals.ringIndicator)) {
                hasSignals = true;
            }
            console.log('[AiroSerial] Port signals:', JSON.stringify(signals));
        } catch {
            // getSignals may not be available on all platforms
        }

        // Check 3: Any VID/PID at all means USB enumeration found something
        if (vid || pid) {
            return {
                isReal: hasSignals || !!vid,
                type: 'serial',
                message: hasSignals
                    ? `USB serial device detected (VID:${vid} PID:${pid})`
                    : `USB device found (VID:${vid} PID:${pid}) — hardware status uncertain`,
            };
        }

        // No VID/PID — could be a virtual port or ghost device
        return {
            isReal: false,
            type: 'unknown',
            message: 'No USB device identified on this port. It may be a virtual/generic port.',
        };
    }

    /**
     * Start a periodic keepalive check. Every 3 seconds, verify that
     * the port is still readable. If the USB device was removed but the
     * disconnect event didn't fire, this will catch it.
     */
    private startKeepalive(): void {
        this.stopKeepalive();
        this.keepaliveTimer = window.setInterval(() => {
            if (this.webSerialPort && this.connectionStatus === 'connected') {
                // If the port's readable stream is gone, the device was disconnected
                if (!this.webSerialPort.readable) {
                    this.lines.push('⚠ Port became unreadable — device likely disconnected.');
                    this.forceDisconnect();
                }
            }
        }, 3000);
    }

    private stopKeepalive(): void {
        if (this.keepaliveTimer !== undefined) {
            clearInterval(this.keepaliveTimer);
            this.keepaliveTimer = undefined;
        }
    }

    /**
     * Force disconnect without user interaction.
     * Called when the USB device is physically removed or the port becomes
     * unreadable.
     */
    private forceDisconnect(): void {
        this.readLoopActive = false;
        this.webSerialLineBuffer = '';
        this.stopKeepalive();

        // Clean up synchronously as best we can
        if (this.webSerialReader) {
            try { this.webSerialReader.cancel(); } catch { /* ignore */ }
            this.webSerialReader = undefined;
        }
        this.webSerialReadableStream = undefined;

        if (this.webSerialWriter) {
            try { this.webSerialWriter.close(); } catch { /* ignore */ }
            this.webSerialWriter = undefined;
        }
        this.webSerialWritableStream = undefined;

        if (this.webSerialPort) {
            try { this.webSerialPort.close(); } catch { /* ignore */ }
            this.webSerialPort = undefined;
        }

        this.connectionStatus = 'disconnected';
        this.connectedPortType = 'unknown';
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
                    // Don't show error if we're disconnecting or device was lost
                    if (!msg.includes('reader has been canceled') &&
                        !msg.includes('The device has been lost') &&
                        !msg.includes('frame was aborted')) {
                        this.lines.push(`⚠ Read error: ${msg}`);
                    }
                }
            } finally {
                // If we exit the loop while still "connected", the port was likely disconnected
                if (this.readLoopActive && this.connectionStatus === 'connected') {
                    this.lines.push('⚠ Serial port disconnected unexpectedly.');
                    this.forceDisconnect();
                }
            }
        };

        readLoop();
    }

    /** Disconnect from the current serial port */
    protected async doDisconnect(): Promise<void> {
        this.readLoopActive = false;
        this.webSerialLineBuffer = '';
        this.stopKeepalive();

        await this.cleanupWebSerial();

        this.connectionStatus = 'disconnected';
        this.connectedPortType = 'unknown';
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
            // If sending fails, the device was likely disconnected
            if (msg.includes('network error') || msg.includes('The device has been lost')) {
                this.lines.push('⚠ Device appears disconnected.');
                this.forceDisconnect();
            }
        }
        this.update();
    }

    // ─── Render ────────────────────────────────────────────────────────

    protected render(): React.ReactNode {
        const statusColors: Record<string, string> = {
            disconnected: '#e74c3c',
            connecting: '#f39c12',
            connected: '#27ae60',
            verifying: '#3498db'
        };
        const statusLabels: Record<string, string> = {
            disconnected: 'Disconnected',
            connecting: 'Connecting...',
            connected: this.connectedPortType === 'esp32' ? 'ESP32 Connected' :
                this.connectedPortType === 'serial' ? 'Serial Connected' : 'Connected',
            verifying: 'Verifying...'
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
                    disabled={this.connectionStatus === 'connected' || this.connectionStatus === 'verifying'}
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
                    {this.availablePorts.map(port => {
                        const vid = normalizeId(port.vendorId);
                        const isEsp = ESP_VENDOR_IDS.has(vid);
                        return <option key={port.path} value={port.path}>
                            {port.path}{port.manufacturer ? ` (${port.manufacturer})` : ''}
                            {isEsp ? ' ★' : ''}
                        </option>;
                    })}
                </select>

                {/* Baud Rate Selector */}
                <select
                    value={this.baudRate.toString()}
                    onChange={e => { this.baudRate = parseInt(e.target.value); this.update(); }}
                    disabled={this.connectionStatus === 'connected' || this.connectionStatus === 'verifying'}
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
                    onClick={() => this.connectionStatus === 'connected' || this.connectionStatus === 'verifying'
                        ? this.doDisconnect() : this.doConnect()}
                    disabled={!webSerialAvailable}
                    style={{
                        background: (this.connectionStatus === 'connected' || this.connectionStatus === 'verifying') ? '#e74c3c' : '#27ae60',
                        color: 'white',
                        border: 'none',
                        padding: '2px 12px',
                        borderRadius: '2px',
                        cursor: webSerialAvailable ? 'pointer' : 'not-allowed',
                        fontWeight: 'bold',
                        opacity: webSerialAvailable ? 1 : 0.5
                    }}
                >
                    {(this.connectionStatus === 'connected' || this.connectionStatus === 'verifying') ? 'Disconnect' : 'Connect'}
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
