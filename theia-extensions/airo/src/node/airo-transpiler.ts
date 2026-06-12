/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Airone Proprietary License, which is available in the project root.
 *
 * SPDX-License-Identifier: Proprietary
 ********************************************************************************/

// ─── Public Result Interface ───────────────────────────────────────────────

export interface TranspileResult {
    success: boolean;
    cppCode: string;
    requiredLibraries: string[];
    errors: string[];
}

// ─── Internal AST Types ────────────────────────────────────────────────────

interface ParsedPin {
    name: string;
    number: number;
    mode: 'input' | 'output' | 'INPUT_PULLUP';
}

interface ParsedVariable {
    name: string;
    rawValue: string;       // The literal value as written in .airo
    isString: boolean;
    isFloat: boolean;
}

// Loop-body statement types

type LoopStmt =
    | ReadForStmt
    | ActForStmt
    | AskStmt
    | SendDataStmt
    | SaveToStmt
    | CallStmt
    | PinWriteStmt
    | PinRefStmt;

interface ReadForStmt   { kind: 'read_for';  duration: string; body: LoopStmt[]; }
interface ActForStmt    { kind: 'actfor';    duration: string; body: LoopStmt[]; }
interface AskStmt       { kind: 'ask';       condition: string; thenBody: LoopStmt[]; elseBody: LoopStmt[]; }
interface SendDataStmt  { kind: 'senddatato'; urlVar: string; }
interface SaveToStmt    { kind: 'saveto';    target: string; value: string; }
interface CallStmt      { kind: 'call';      variable: string; }
interface PinWriteStmt  { kind: 'pin_write';  pin: string; value: string; }
interface PinRefStmt    { kind: 'pin_ref';    pin: string; }   // bare pin name ending with "."

// ─── Library / Include Mapping ─────────────────────────────────────────────

interface LibMapping {
    includes: string[];     // C++ #include paths (e.g. '<WiFi.h>')
    arduinoLibs: string[];  // Arduino library names for install
}

const LIBRARY_MAP: Record<string, LibMapping> = {
    'body/comm/wifi.airo': {
        includes: ['<WiFi.h>', '<WebSocketsClient.h>', '<ArduinoJson.h>'],
        arduinoLibs: ['WebSockets', 'ArduinoJson'],
    },
    'body/actuation/servo.airo': {
        includes: ['<ESP32Servo.h>'],
        arduinoLibs: ['ESP32Servo'],
    },
    'body/actuation/upper-right-hands.airo': {
        includes: ['<ESP32Servo.h>'],
        arduinoLibs: ['ESP32Servo'],
    },
    'body/sight/eyes.airo': {
        includes: ['<esp_camera.h>'],
        arduinoLibs: ['esp32-camera'],
    },
    'body/hearing/ears.airo': {
        includes: ['<driver/i2s.h>'],
        arduinoLibs: [],
    },
    'body/other_sensors/ultrasonic.airo': {
        includes: [],
        arduinoLibs: [],
    },
};

// ─── WebSocket URL Parts ───────────────────────────────────────────────────

interface WsUrlParts {
    host: string;
    port: number;
    path: string;
    useSSL: boolean;
}

// ─── Generation Context ────────────────────────────────────────────────────

interface GenContext {
    sketchName: string;
    includes: string[];
    pins: ParsedPin[];
    variables: ParsedVariable[];
    loopStmts: LoopStmt[];
    needsWifi: boolean;
    needsWebSocket: boolean;
    hasUltrasonic: boolean;
    libraryCalls: string[];
    usesServo: boolean;
}

// ─── Extracted Sections ────────────────────────────────────────────────────

interface Sections {
    library: string;
    pins: string;
    variables: string;
    loop: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  AiroTranspiler
// ═══════════════════════════════════════════════════════════════════════════

export class AiroTranspiler {

    // ─── Public API ────────────────────────────────────────────────────────

    transpile(airoCode: string, sketchName: string): TranspileResult {
        const errors: string[] = [];
        const requiredLibraries: string[] = [];

        // 1. Extract sections
        const sections = this.extractSections(airoCode);
        if (!sections.library.trim()) {
            errors.push('Warning: Missing #library# section — no body modules imported');
        }
        if (!sections.pins.trim()) {
            errors.push('Error: Missing Pin defi section — every .airo file must define pins');
        }
        if (!sections.loop.trim()) {
            errors.push('Error: Missing loop section — every .airo file must have a main loop');
        }

        // 2. Parse library calls
        const libraryCalls = this.parseLibrarySection(sections.library);

        // 3. Parse pin definitions
        const pins = this.parsePinSection(sections.pins, errors);

        // 4. Parse variables
        const variables = this.parseVariableSection(sections.variables, errors);

        // 5. Parse loop body
        const loopStmts = this.parseLoopBody(sections.loop, pins, variables);

        // 6. Determine features
        const needsWifi = variables.some(v => v.name === 'wifi_ssid')
            || libraryCalls.includes('body/comm/wifi.airo');
        const needsWebSocket = variables.some(v => v.name === 'brain_url')
            || this.treeHasSendData(loopStmts);
        const hasUltrasonic = pins.some(p => p.name === 'trig' && p.mode === 'output')
            && pins.some(p => p.name === 'echo' && p.mode === 'input');
        const usesServo = libraryCalls.some(l =>
            l === 'body/actuation/servo.airo' || l === 'body/actuation/upper-right-hands.airo'
        ) || pins.some(p =>
            p.mode === 'output' && /servo|motor|hand|arm|leg/i.test(p.name)
        );

        // 7. Resolve includes and required libraries
        const includes = new Set<string>();
        includes.add('<Arduino.h>');

        for (const call of libraryCalls) {
            const mapping = LIBRARY_MAP[call];
            if (mapping) {
                for (const inc of mapping.includes) includes.add(inc);
                for (const lib of mapping.arduinoLibs) {
                    if (!requiredLibraries.includes(lib)) requiredLibraries.push(lib);
                }
            }
        }

        if (needsWifi) includes.add('<WiFi.h>');
        if (needsWebSocket) {
            includes.add('<WebSocketsClient.h>');
            includes.add('<ArduinoJson.h>');
            if (!requiredLibraries.includes('WebSockets')) requiredLibraries.push('WebSockets');
            if (!requiredLibraries.includes('ArduinoJson')) requiredLibraries.push('ArduinoJson');
        }
        if (usesServo) {
            includes.add('<ESP32Servo.h>');
            if (!requiredLibraries.includes('ESP32Servo')) requiredLibraries.push('ESP32Servo');
        }

        // 8. Generate C++ code
        const ctx: GenContext = {
            sketchName,
            includes: Array.from(includes),
            pins,
            variables,
            loopStmts,
            needsWifi,
            needsWebSocket,
            hasUltrasonic,
            libraryCalls,
            usesServo,
        };

        const cppCode = this.generateCpp(ctx);

        const hasErrors = errors.some(e => e.startsWith('Error:'));
        return {
            success: !hasErrors,
            cppCode,
            requiredLibraries,
            errors,
        };
    }

    // ─── Section Extraction ────────────────────────────────────────────────

    private extractSections(code: string): Sections {
        const lines = code.split('\n');

        let libraryStart = -1;
        let pinStart = -1;
        let variablesStart = -1;
        let loopStart = -1;

        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed === '#library#' || trimmed.startsWith('#library#')) {
                if (libraryStart === -1) libraryStart = i;
            } else if (trimmed.startsWith('Pin defi')) {
                if (pinStart === -1) pinStart = i;
            } else if (trimmed === '#variables#' || trimmed.startsWith('#variables#')) {
                if (variablesStart === -1) variablesStart = i;
            } else if (/^loop\s*\{/.test(trimmed) || trimmed === 'loop' || trimmed.startsWith('loop ')) {
                if (loopStart === -1) loopStart = i;
            }
        }

        // Library section: from #library# to next section
        const libraryEnd = this.earliestPositive([pinStart, variablesStart, loopStart], lines.length);
        const libraryContent = libraryStart >= 0
            ? lines.slice(libraryStart + 1, libraryEnd).join('\n')
            : '';

        // Pin section: between braces of Pin defi
        const pinContent = pinStart >= 0
            ? this.extractBraceBlockContent(lines, pinStart)
            : '';

        // Variables section: from #variables# to next section
        const variablesEnd = this.earliestPositive([loopStart], lines.length);
        const variablesContent = variablesStart >= 0
            ? lines.slice(variablesStart + 1, variablesEnd).join('\n')
            : '';

        // Loop section: between braces of loop
        const loopContent = loopStart >= 0
            ? this.extractBraceBlockContent(lines, loopStart)
            : '';

        return { library: libraryContent, pins: pinContent, variables: variablesContent, loop: loopContent };
    }

    /** Returns the smallest value from `candidates` that is > 0, or `fallback`. */
    private earliestPositive(candidates: number[], fallback: number): number {
        const positive = candidates.filter(c => c > 0);
        return positive.length > 0 ? Math.min(...positive) : fallback;
    }

    /** Extract text between the first pair of matching braces starting at `startLine`. */
    private extractBraceBlockContent(lines: string[], startLine: number): string {
        let depth = 0;
        let started = false;
        let blockStart = -1;
        let blockEnd = -1;

        for (let i = startLine; i < lines.length; i++) {
            for (const ch of lines[i]) {
                if (ch === '{') {
                    if (!started) blockStart = i;
                    depth++;
                    started = true;
                } else if (ch === '}') {
                    depth--;
                    if (depth === 0 && started) {
                        blockEnd = i;
                        break;
                    }
                }
            }
            if (blockEnd >= 0) break;
        }

        if (blockStart < 0 || blockEnd < 0) return '';

        // Re-join and extract content between the first { and last }
        const blockLines = lines.slice(blockStart, blockEnd + 1);
        const joined = blockLines.join('\n');
        const openIdx = joined.indexOf('{');
        const closeIdx = joined.lastIndexOf('}');
        if (openIdx < 0 || closeIdx < 0) return '';
        return joined.substring(openIdx + 1, closeIdx);
    }

    // ─── Library Section Parsing ───────────────────────────────────────────

    private parseLibrarySection(text: string): string[] {
        const calls: string[] = [];
        const lines = text.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            // Match: # call body/comm/wifi.airo.
            const match = trimmed.match(/^#\s*call\s+(.+?)\.airo\.\s*$/);
            if (match) {
                calls.push(match[1] + '.airo');
            }
        }
        return calls;
    }

    // ─── Pin Section Parsing ───────────────────────────────────────────────

    private parsePinSection(text: string, errors: string[]): ParsedPin[] {
        const pins: ParsedPin[] = [];
        const lines = text.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#') || trimmed === '{' || trimmed === '}') continue;

            // Format: name = number; mode.
            const match = trimmed.match(/^(\w+)\s*=\s*(\d+)\s*;\s*(input|output|INPUT_PULLUP)\s*\.\s*$/);
            if (match) {
                const mode = match[3].toLowerCase() as 'input' | 'output' | 'input_pullup';
                pins.push({
                    name: match[1],
                    number: parseInt(match[2], 10),
                    mode: mode === 'input_pullup' ? 'INPUT_PULLUP' : (mode as 'input' | 'output'),
                });
            } else if (trimmed.includes('=') && !trimmed.startsWith('#')) {
                // Looks like a pin def but doesn't match the pattern
                errors.push(`Warning: Unrecognized pin definition: "${trimmed}"`);
            }
        }

        return pins;
    }

    // ─── Variable Section Parsing ──────────────────────────────────────────

    private parseVariableSection(text: string, errors: string[]): ParsedVariable[] {
        const vars: ParsedVariable[] = [];
        const lines = text.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;

            // Format: name = value.
            const match = trimmed.match(/^(\w+)\s*=\s*(.+?)\s*\.\s*$/);
            if (match) {
                const name = match[1];
                const raw = match[2].trim();
                const isString = raw.startsWith('"') && raw.endsWith('"');
                const isFloat = !isString && /^\d+\.\d+$/.test(raw);
                vars.push({ name, rawValue: raw, isString, isFloat });
            } else if (trimmed.includes('=') && !trimmed.startsWith('#')) {
                errors.push(`Warning: Unrecognized variable definition: "${trimmed}"`);
            }
        }

        return vars;
    }

    // ─── Loop Body Parsing ─────────────────────────────────────────────────

    private parseLoopBody(text: string, pins: ParsedPin[], vars: ParsedVariable[]): LoopStmt[] {
        const cleaned = this.stripComments(text);
        return this.scanStatements(cleaned, pins, vars);
    }

    private stripComments(text: string): string {
        return text.split('\n')
            .filter(line => {
                const trimmed = line.trim();
                // Keep section markers (shouldn't appear in loop body, but be safe)
                if (trimmed === '#library#' || trimmed === '#variables#') return false;
                // Drop full-line comments
                if (trimmed.startsWith('#')) return false;
                return true;
            })
            .join('\n');
    }

    private scanStatements(text: string, pins: ParsedPin[], vars: ParsedVariable[]): LoopStmt[] {
        const stmts: LoopStmt[] = [];
        let pos = 0;

        const skipWs = (): void => {
            while (pos < text.length && /\s/.test(text[pos])) pos++;
        };

        while (pos < text.length) {
            skipWs();
            if (pos >= text.length) break;

            const remaining = text.substring(pos);

            // ── read_for(N) { ... } ──────────────────────────────────
            const readForMatch = remaining.match(/^read_for\s*\(\s*([^)]+?)\s*\)\s*\{/);
            if (readForMatch) {
                const duration = readForMatch[1].trim();
                pos += readForMatch[0].length;
                const openBrace = pos - 1;
                const closeBrace = this.findMatchingBrace(text, openBrace);
                const bodyText = text.substring(pos, closeBrace);
                stmts.push({
                    kind: 'read_for',
                    duration,
                    body: this.scanStatements(bodyText, pins, vars),
                });
                pos = closeBrace + 1;
                continue;
            }

            // ── actfor(N) { ... } ────────────────────────────────────
            const actForMatch = remaining.match(/^actfor\s*\(\s*([^)]+?)\s*\)\s*\{/);
            if (actForMatch) {
                const duration = actForMatch[1].trim();
                pos += actForMatch[0].length;
                const openBrace = pos - 1;
                const closeBrace = this.findMatchingBrace(text, openBrace);
                const bodyText = text.substring(pos, closeBrace);
                stmts.push({
                    kind: 'actfor',
                    duration,
                    body: this.scanStatements(bodyText, pins, vars),
                });
                pos = closeBrace + 1;
                continue;
            }

            // ── ask condition { ... } [else { ... }] ─────────────────
            const askMatch = remaining.match(/^ask\s+(.+?)\s*\{/);
            if (askMatch) {
                const condition = askMatch[1].trim();
                pos += askMatch[0].length;
                const thenOpen = pos - 1;
                const thenClose = this.findMatchingBrace(text, thenOpen);
                const thenText = text.substring(pos, thenClose);
                const thenBody = this.scanStatements(thenText, pins, vars);
                pos = thenClose + 1;

                let elseBody: LoopStmt[] = [];
                skipWs();
                const afterThen = text.substring(pos).trimStart();
                if (afterThen.startsWith('else')) {
                    pos += text.substring(pos).indexOf('else') + 4;
                    skipWs();
                    if (pos < text.length && text[pos] === '{') {
                        pos++; // skip {
                        const elseOpen = pos - 1;
                        const elseClose = this.findMatchingBrace(text, elseOpen);
                        const elseText = text.substring(pos, elseClose);
                        elseBody = this.scanStatements(elseText, pins, vars);
                        pos = elseClose + 1;
                    }
                }

                stmts.push({ kind: 'ask', condition, thenBody, elseBody });
                continue;
            }

            // ── senddatato(url). ─────────────────────────────────────
            const sendMatch = remaining.match(/^senddatato\s*\(\s*([^)]+?)\s*\)\s*\./);
            if (sendMatch) {
                stmts.push({ kind: 'senddatato', urlVar: sendMatch[1].trim() });
                pos += sendMatch[0].length;
                continue;
            }

            // ── saveto var = value. ──────────────────────────────────
            const saveMatch = remaining.match(/^saveto\s+(\w+)\s*=\s*(.+?)\s*\./);
            if (saveMatch) {
                stmts.push({ kind: 'saveto', target: saveMatch[1], value: saveMatch[2].trim() });
                pos += saveMatch[0].length;
                continue;
            }

            // ── call var. ────────────────────────────────────────────
            const callMatch = remaining.match(/^call\s+(\w+)\s*\./);
            if (callMatch) {
                stmts.push({ kind: 'call', variable: callMatch[1] });
                pos += callMatch[0].length;
                continue;
            }

            // ── pin = value.  (pin write: led = HIGH.) ───────────────
            const pinWriteMatch = remaining.match(/^(\w+)\s*=\s*(\w+)\s*\./);
            if (pinWriteMatch) {
                stmts.push({ kind: 'pin_write', pin: pinWriteMatch[1], value: pinWriteMatch[2] });
                pos += pinWriteMatch[0].length;
                continue;
            }

            // ── pin.  (bare pin reference: sensor.) ──────────────────
            const pinRefMatch = remaining.match(/^(\w+)\s*\./);
            if (pinRefMatch) {
                stmts.push({ kind: 'pin_ref', pin: pinRefMatch[1] });
                pos += pinRefMatch[0].length;
                continue;
            }

            // Skip unrecognized character
            pos++;
        }

        return stmts;
    }

    /** Find the position of the `}` that matches the `{` at `openPos`. */
    private findMatchingBrace(text: string, openPos: number): number {
        let depth = 0;
        for (let i = openPos; i < text.length; i++) {
            if (text[i] === '{') depth++;
            else if (text[i] === '}') {
                depth--;
                if (depth === 0) return i;
            }
        }
        return text.length; // unmatched — return end
    }

    // ─── Feature Detection ─────────────────────────────────────────────────

    private treeHasSendData(stmts: LoopStmt[]): boolean {
        for (const s of stmts) {
            if (s.kind === 'senddatato') return true;
            if (s.kind === 'read_for' && this.treeHasSendData(s.body)) return true;
            if (s.kind === 'actfor' && this.treeHasSendData(s.body)) return true;
            if (s.kind === 'ask') {
                if (this.treeHasSendData(s.thenBody) || this.treeHasSendData(s.elseBody)) return true;
            }
        }
        return false;
    }

    // ─── C++ Code Generation ───────────────────────────────────────────────

    private generateCpp(ctx: GenContext): string {
        const L: string[] = [];
        const I = (n: number) => '    '.repeat(n);

        // ── File header ───────────────────────────────────────────────
        L.push('/*');
        L.push(` * Generated by Airone IDE from ${ctx.sketchName}.airo`);
        L.push(' * Target: ESP32 (Arduino framework)');
        L.push(' *');
        L.push(' * DO NOT EDIT — regenerate from the .airo source.');
        L.push(' */');

        // ── Includes ──────────────────────────────────────────────────
        L.push('');
        L.push('// ─── Includes ─────────────────────────────────────────────────────────────');
        for (const inc of ctx.includes) {
            L.push(`#include ${inc}`);
        }

        // ── Pin definitions ───────────────────────────────────────────
        if (ctx.pins.length > 0) {
            L.push('');
            L.push('// ─── Pin Definitions ──────────────────────────────────────────────────────');
            for (const pin of ctx.pins) {
                L.push(`const int pin_${pin.name} = ${pin.number};`);
            }
        }

        // ── Servo objects ─────────────────────────────────────────────
        const servoPins = ctx.usesServo
            ? ctx.pins.filter(p =>
                p.mode === 'output' &&
                /servo|motor|hand|arm|leg/i.test(p.name)
              )
            : [];
        if (servoPins.length > 0) {
            L.push('');
            L.push('// ─── Servo Objects ────────────────────────────────────────────────────────');
            for (const sp of servoPins) {
                L.push(`Servo servo_${sp.name};`);
            }
        }

        // ── User variables ────────────────────────────────────────────
        if (ctx.variables.length > 0) {
            L.push('');
            L.push('// ─── Variables ────────────────────────────────────────────────────────────');
            for (const v of ctx.variables) {
                const cppType = v.isString ? 'String' : (v.isFloat ? 'float' : 'int');
                L.push(`${cppType} ${v.name} = ${v.rawValue};`);
            }
        }

        // ── Sensor variables ──────────────────────────────────────────
        const inputPins = ctx.pins.filter(p => p.mode === 'input');
        if (inputPins.length > 0) {
            L.push('');
            L.push('// ─── Sensor Variables ─────────────────────────────────────────────────────');
            for (const ip of inputPins) {
                L.push(`int var_${ip.name} = 0;`);
            }
        }

        // ── WebSocket client ──────────────────────────────────────────
        if (ctx.needsWebSocket) {
            L.push('');
            L.push('// ─── WebSocket Client ─────────────────────────────────────────────────────');
            L.push('WebSocketsClient webSocket;');
        }

        // ── Helper: ultrasonic distance ───────────────────────────────
        if (ctx.hasUltrasonic) {
            L.push('');
            L.push('// ─── Helper: Ultrasonic Distance ──────────────────────────────────────────');
            L.push('long measureDistance(int trigPin, int echoPin) {');
            L.push(`${I(1)}digitalWrite(trigPin, LOW);`);
            L.push(`${I(1)}delayMicroseconds(2);`);
            L.push(`${I(1)}digitalWrite(trigPin, HIGH);`);
            L.push(`${I(1)}delayMicroseconds(10);`);
            L.push(`${I(1)}digitalWrite(trigPin, LOW);`);
            L.push(`${I(1)}long duration = pulseIn(echoPin, HIGH, 30000);`);
            L.push(`${I(1)}if (duration == 0) return -1;`);
            L.push(`${I(1)}return duration * 0.034 / 2;`);
            L.push('}');
        }

        // ── WebSocket event handler ───────────────────────────────────
        if (ctx.needsWebSocket) {
            L.push('');
            L.push('// ─── WebSocket Event Handler ──────────────────────────────────────────────');
            L.push('void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {');
            L.push(`${I(1)}switch(type) {`);
            L.push(`${I(2)}case WStype_DISCONNECTED:`);
            L.push(`${I(3)}Serial.println("[WS] Disconnected!");`);
            L.push(`${I(3)}break;`);
            L.push(`${I(2)}case WStype_CONNECTED:`);
            L.push(`${I(3)}Serial.println("[WS] Connected!");`);
            L.push(`${I(3)}break;`);
            L.push(`${I(2)}case WStype_TEXT: {`);
            L.push(`${I(3)}JsonDocument _cmd;`);
            L.push(`${I(3)}deserializeJson(_cmd, payload, length);`);
            // Generate command handlers for output pins
            const outputPins = ctx.pins.filter(p => p.mode === 'output');
            for (const op of outputPins) {
                if (servoPins.includes(op)) {
                    L.push(`${I(3)}if (_cmd.containsKey("${op.name}")) {`);
                    L.push(`${I(4)}int _val = _cmd["${op.name}"].as<int>();`);
                    L.push(`${I(4)}servo_${op.name}.write(_val);`);
                    L.push(`${I(3)}}`);
                } else {
                    L.push(`${I(3)}if (_cmd.containsKey("${op.name}")) {`);
                    L.push(`${I(4)}int _val = _cmd["${op.name}"].as<int>();`);
                    L.push(`${I(4)}digitalWrite(pin_${op.name}, _val);`);
                    L.push(`${I(3)}}`);
                }
            }
            L.push(`${I(3)}break;`);
            L.push(`${I(2)}}`);
            L.push(`${I(2)}default:`);
            L.push(`${I(3)}break;`);
            L.push(`${I(1)}}`);
            L.push('}');
        }

        // ── setup() ──────────────────────────────────────────────────
        L.push('');
        L.push('// ─── Setup ────────────────────────────────────────────────────────────────');
        L.push('void setup() {');
        L.push(`${I(1)}Serial.begin(115200);`);
        L.push(`${I(1)}delay(100);`);
        L.push('');

        // Pin modes
        if (ctx.pins.length > 0) {
            L.push(`${I(1)}// Pin modes`);
            for (const pin of ctx.pins) {
                const modeStr = pin.mode === 'INPUT_PULLUP' ? 'INPUT_PULLUP'
                    : pin.mode === 'input' ? 'INPUT' : 'OUTPUT';
                L.push(`${I(1)}pinMode(pin_${pin.name}, ${modeStr});`);
            }
            L.push('');
        }

        // Servo attach
        if (servoPins.length > 0) {
            L.push(`${I(1)}// Servo attach`);
            for (const sp of servoPins) {
                L.push(`${I(1)}servo_${sp.name}.attach(pin_${sp.name});`);
            }
            L.push('');
        }

        // WiFi
        if (ctx.needsWifi) {
            const ssidVar = ctx.variables.find(v => v.name === 'wifi_ssid');

            L.push(`${I(1)}// WiFi connection`);
            if (ssidVar) {
                L.push(`${I(1)}WiFi.begin(wifi_ssid.c_str(), wifi_password.c_str());`);
            } else {
                L.push(`${I(1)}// WARNING: wifi_ssid not defined in .airo variables`);
                L.push(`${I(1)}WiFi.begin("", "");`);
            }
            L.push(`${I(1)}Serial.print("Connecting to WiFi");`);
            L.push(`${I(1)}int _wifiTimeout = 0;`);
            L.push(`${I(1)}while (WiFi.status() != WL_CONNECTED && _wifiTimeout < 40) {`);
            L.push(`${I(2)}delay(500);`);
            L.push(`${I(2)}Serial.print(".");`);
            L.push(`${I(2)}_wifiTimeout++;`);
            L.push(`${I(1)}}`);
            L.push(`${I(1)}if (WiFi.status() == WL_CONNECTED) {`);
            L.push(`${I(2)}Serial.println();`);
            L.push(`${I(2)}Serial.print("WiFi connected! IP: ");`);
            L.push(`${I(2)}Serial.println(WiFi.localIP());`);

            // WebSocket
            if (ctx.needsWebSocket) {
                const brainVar = ctx.variables.find(v => v.name === 'brain_url');
                L.push('');
                L.push(`${I(2)}// WebSocket connection`);
                if (brainVar) {
                    const urlStr = brainVar.rawValue.replace(/^"|"$/g, '');
                    const urlParts = this.parseWebSocketUrl(urlStr);
                    if (urlParts) {
                        if (urlParts.useSSL) {
                            L.push(`${I(2)}webSocket.beginSSL("${urlParts.host}", ${urlParts.port}, "${urlParts.path}");`);
                        } else {
                            L.push(`${I(2)}webSocket.begin("${urlParts.host}", ${urlParts.port}, "${urlParts.path}");`);
                        }
                    } else {
                        L.push(`${I(2)}// WARNING: Could not parse brain_url — falling back to direct string`);
                        L.push(`${I(2)}webSocket.beginSSL(brain_url.c_str(), 443, "/");`);
                    }
                } else {
                    L.push(`${I(2)}// WARNING: brain_url not defined in .airo variables`);
                }
                L.push(`${I(2)}webSocket.onEvent(webSocketEvent);`);
                L.push(`${I(2)}webSocket.setReconnectInterval(5000);`);
            }

            L.push(`${I(1)}} else {`);
            L.push(`${I(2)}Serial.println();`);
            L.push(`${I(2)}Serial.println("WiFi connection failed!");`);
            L.push(`${I(1)}}`);
        }

        L.push('}');

        // ── loop() ──────────────────────────────────────────────────
        L.push('');
        L.push('// ─── Loop ─────────────────────────────────────────────────────────────────');
        L.push('void loop() {');

        // WebSocket.loop() must be called every iteration
        if (ctx.needsWebSocket) {
            L.push(`${I(1)}webSocket.loop();`);
        }

        // Generate loop body statements
        for (const stmt of ctx.loopStmts) {
            L.push(this.generateStmt(stmt, 1, ctx));
        }

        L.push('}');

        return L.join('\n');
    }

    // ─── Statement Code Generation ─────────────────────────────────────────

    private generateStmt(stmt: LoopStmt, indent: number, ctx: GenContext): string {
        const I = (n: number) => '    '.repeat(n + indent);
        const inputPins = ctx.pins.filter(p => p.mode === 'input');
        const servoPins = ctx.usesServo
            ? ctx.pins.filter(p => p.mode === 'output' && /servo|motor|hand|arm|leg/i.test(p.name))
            : [];

        switch (stmt.kind) {

            // ── read_for ──────────────────────────────────────────────
            case 'read_for': {
                const L: string[] = [];
                const dur = this.translateRvalue(stmt.duration, ctx.pins, ctx.variables);
                L.push(`${I(0)}// read_for(${stmt.duration})`);
                if (stmt.duration === '0' || stmt.duration.trim() === '0') {
                    // Read once, no loop
                    L.push(`${I(0)}{`);
                    for (const s of stmt.body) {
                        if (s.kind === 'pin_ref') {
                            // Route pin references based on pin mode:
                            // - Input pins: read their value
                            // - Output pins: preserve them via generateStmt (don't drop)
                            const pinDef = ctx.pins.find(p => p.name === s.pin);
                            if (pinDef && pinDef.mode === 'input') {
                                L.push(this.generatePinRead(s.pin, indent + 1, ctx));
                            } else {
                                L.push(this.generateStmt(s, indent + 1, ctx));
                            }
                        } else {
                            // Process all other statements (senddatato, ask, saveto, pin_write, call)
                            L.push(this.generateStmt(s, indent + 1, ctx));
                        }
                    }
                    L.push(`${I(0)}}`);
                } else {
                    L.push(`${I(0)}{`);
                    L.push(`${I(1)}unsigned long _read_start = millis();`);
                    L.push(`${I(1)}while (millis() - _read_start < ${dur}) {`);
                    for (const s of stmt.body) {
                        if (s.kind === 'pin_ref') {
                            // Route pin references based on pin mode
                            const pinDef = ctx.pins.find(p => p.name === s.pin);
                            if (pinDef && pinDef.mode === 'input') {
                                L.push(this.generatePinRead(s.pin, indent + 2, ctx));
                            } else {
                                L.push(this.generateStmt(s, indent + 2, ctx));
                            }
                        } else {
                            // Process all other statements (senddatato, ask, saveto, pin_write, call)
                            L.push(this.generateStmt(s, indent + 2, ctx));
                        }
                    }
                    L.push(`${I(2)}yield();`);
                    L.push(`${I(1)}}`);
                    L.push(`${I(0)}}`);
                }
                return L.join('\n');
            }

            // ── actfor ────────────────────────────────────────────────
            case 'actfor': {
                const L: string[] = [];
                const dur = this.translateRvalue(stmt.duration, ctx.pins, ctx.variables);
                L.push(`${I(0)}// actfor(${stmt.duration})`);
                if (stmt.duration === '0' || stmt.duration.trim() === '0') {
                    // Act once, no loop
                    L.push(`${I(0)}{`);
                    for (const s of stmt.body) {
                        if (s.kind === 'pin_ref') {
                            L.push(this.generatePinActuate(s.pin, indent + 1, ctx, servoPins));
                        } else {
                            // Process all other statement types (pin_write, ask, senddatato, etc.)
                            L.push(this.generateStmt(s, indent + 1, ctx));
                        }
                    }
                    L.push(`${I(0)}}`);
                } else {
                    L.push(`${I(0)}{`);
                    L.push(`${I(1)}unsigned long _act_start = millis();`);
                    L.push(`${I(1)}while (millis() - _act_start < ${dur}) {`);
                    for (const s of stmt.body) {
                        if (s.kind === 'pin_ref') {
                            L.push(this.generatePinActuate(s.pin, indent + 2, ctx, servoPins));
                        } else {
                            // Process all other statement types (pin_write, ask, senddatato, etc.)
                            L.push(this.generateStmt(s, indent + 2, ctx));
                        }
                    }
                    L.push(`${I(2)}yield();`);
                    L.push(`${I(1)}}`);
                    L.push(`${I(0)}}`);
                }
                return L.join('\n');
            }

            // ── ask ───────────────────────────────────────────────────
            case 'ask': {
                const L: string[] = [];
                const cond = this.translateCondition(stmt.condition, ctx.pins);
                L.push(`${I(0)}if (${cond}) {`);
                for (const s of stmt.thenBody) {
                    L.push(this.generateStmt(s, indent + 1, ctx));
                }
                if (stmt.elseBody.length > 0) {
                    L.push(`${I(0)}} else {`);
                    for (const s of stmt.elseBody) {
                        L.push(this.generateStmt(s, indent + 1, ctx));
                    }
                }
                L.push(`${I(0)}}`);
                return L.join('\n');
            }

            // ── senddatato ────────────────────────────────────────────
            case 'senddatato': {
                const L: string[] = [];
                L.push(`${I(0)}// senddatato(${stmt.urlVar})`);
                L.push(`${I(0)}{`);
                L.push(`${I(1)}JsonDocument _doc;`);
                for (const ip of inputPins) {
                    L.push(`${I(1)}_doc["${ip.name}"] = var_${ip.name};`);
                }
                L.push(`${I(1)}String _json;`);
                L.push(`${I(1)}serializeJson(_doc, _json);`);
                L.push(`${I(1)}webSocket.sendTXT(_json);`);
                L.push(`${I(0)}}`);
                return L.join('\n');
            }

            // ── saveto ────────────────────────────────────────────────
            case 'saveto': {
                const L: string[] = [];
                const targetPin = ctx.pins.find(p => p.name === stmt.target);
                const valueCpp = this.translateRvalue(stmt.value, ctx.pins, ctx.variables);

                if (targetPin) {
                    if (targetPin.mode === 'output') {
                        if (servoPins.includes(targetPin)) {
                            // Servo write: determine if the source value is a raw ADC reading
                            // or already an angle. If the source is an input pin variable (var_xxx),
                            // map from ADC range; otherwise write directly as an angle.
                            const sourceIsInputPin = ctx.pins.some(p =>
                                p.mode === 'input' && p.name === stmt.value.trim()
                            );
                            if (sourceIsInputPin) {
                                // Map raw ADC value (0-4095 for ESP32 12-bit) to servo angle (0-180)
                                L.push(`${I(0)}servo_${stmt.target}.write(map(${valueCpp}, 0, 4095, 0, 180));`);
                            } else {
                                // Value is already an angle or numeric — write directly
                                L.push(`${I(0)}servo_${stmt.target}.write(${valueCpp});`);
                            }
                        } else if (stmt.value === 'HIGH' || stmt.value === 'LOW') {
                            // Digital write for HIGH/LOW values
                            L.push(`${I(0)}digitalWrite(pin_${stmt.target}, ${valueCpp});`);
                        } else {
                            // For other numeric values on digital output pins, use digitalWrite
                            // (analogWrite is not standard on ESP32 Arduino — use ledcWrite instead)
                            L.push(`${I(0)}digitalWrite(pin_${stmt.target}, ${valueCpp});`);
                        }
                    } else {
                        L.push(`${I(0)}var_${stmt.target} = ${valueCpp};`);
                    }
                } else {
                    L.push(`${I(0)}${stmt.target} = ${valueCpp};`);
                }
                return L.join('\n');
            }

            // ── call ──────────────────────────────────────────────────
            case 'call': {
                const L: string[] = [];
                const v = ctx.variables.find(vr => vr.name === stmt.variable);
                if (v && !v.isString) {
                    L.push(`${I(0)}delay(${stmt.variable});`);
                } else if (v && v.isString) {
                    // call on a string variable doesn't make sense as delay — skip
                    L.push(`${I(0)}// call ${stmt.variable} — skipped (not a number variable)`);
                } else {
                    // Might be a pin or unknown — treat as delay
                    L.push(`${I(0)}delay(${stmt.variable});`);
                }
                return L.join('\n');
            }

            // ── pin_write ─────────────────────────────────────────────
            case 'pin_write': {
                const L: string[] = [];
                const pinDef = ctx.pins.find(p => p.name === stmt.pin);
                const valueCpp = this.translateRvalue(stmt.value, ctx.pins, ctx.variables);

                if (pinDef && pinDef.mode === 'output') {
                    if (servoPins.includes(pinDef)) {
                        // For servo pins, numeric values are angles; HIGH/LOW are treated as digital
                        if (stmt.value === 'HIGH' || stmt.value === 'LOW') {
                            // HIGH/LOW on a servo pin → use as digital write (not angle)
                            L.push(`${I(0)}digitalWrite(pin_${stmt.pin}, ${valueCpp});`);
                        } else {
                            // Numeric value → servo angle
                            L.push(`${I(0)}servo_${stmt.pin}.write(${valueCpp});`);
                        }
                    } else {
                        L.push(`${I(0)}digitalWrite(pin_${stmt.pin}, ${valueCpp});`);
                    }
                } else if (pinDef && pinDef.mode === 'input') {
                    L.push(`${I(0)}var_${stmt.pin} = ${valueCpp};`);
                } else {
                    L.push(`${I(0)}${stmt.pin} = ${valueCpp};`);
                }
                return L.join('\n');
            }

            // ── pin_ref (bare reference) ──────────────────────────────
            case 'pin_ref': {
                // Outside read_for/actfor, a bare pin reference is ambiguous.
                // For input pins, do a read; for output pins, activate.
                const pinDef = ctx.pins.find(p => p.name === stmt.pin);
                if (pinDef && pinDef.mode === 'input') {
                    return this.generatePinRead(stmt.pin, indent, ctx);
                } else if (pinDef && pinDef.mode === 'output') {
                    if (servoPins.includes(pinDef)) {
                        // For servos: look for a user-defined variable to use as the angle.
                        // Checks: pin_angle, pin (int variable), then defaults to 90° neutral.
                        const resolvedAngle = this.resolveServoDefault(stmt.pin, ctx);
                        return `${I(0)}servo_${stmt.pin}.write(${resolvedAngle});`;
                    }
                    // For digital output: activate (write HIGH)
                    return `${I(0)}digitalWrite(pin_${stmt.pin}, HIGH);`;
                }
                return `${I(0)}// pin_ref: ${stmt.pin}`;
            }

            default:
                return `${I(0)}// unknown statement`;
        }
    }

    /** Generate a single sensor-read line for a pin name. */
    private generatePinRead(pinName: string, indent: number, ctx: GenContext): string {
        const I = (n: number) => '    '.repeat(n + indent);
        const pinDef = ctx.pins.find(p => p.name === pinName);
        if (!pinDef || pinDef.mode !== 'input') {
            return `${I(0)}// pin_ref: ${pinName} (not an input pin)`;
        }

        // Special case: ultrasonic echo pin
        if (pinName === 'echo' && ctx.hasUltrasonic) {
            return `${I(0)}var_echo = measureDistance(pin_trig, pin_echo);`;
        }

        // Default: analogRead (ESP32 ADC)
        return `${I(0)}var_${pinName} = analogRead(pin_${pinName});`;
    }

    /**
     * Generate C++ code to actuate a pin (used in actfor blocks).
     *
     * For output pins: writes HIGH for digital, angle for servo (from variable or default).
     * For input pins: reads the pin value (same as generatePinRead).
     *
     * NOTE: Bare pin references in actfor use default activation values.
     * For specific values, use pin_write syntax: `pin = value.`
     */
    private generatePinActuate(pinName: string, indent: number, ctx: GenContext, servoPins: ParsedPin[]): string {
        const I = (n: number) => '    '.repeat(n + indent);
        const pinDef = ctx.pins.find(p => p.name === pinName);
        if (!pinDef) {
            return `${I(0)}// pin_ref: ${pinName} (unknown pin)`;
        }

        if (pinDef.mode === 'output') {
            if (servoPins.includes(pinDef)) {
                // For servos: look for a user-defined variable to use as the angle.
                const resolvedAngle = this.resolveServoDefault(pinName, ctx);
                return `${I(0)}servo_${pinName}.write(${resolvedAngle});`;
            } else {
                return `${I(0)}digitalWrite(pin_${pinName}, HIGH);`;
            }
        }

        // Input pins in actfor context: read their value
        return this.generatePinRead(pinName, indent, ctx);
    }

    // ─── Translation Helpers ───────────────────────────────────────────────

    /**
     * Resolve the default angle for a servo pin.
     *
     * Priority:
     *  1. Variable named `<pin>_angle` (e.g., `servo_pin_angle`)
     *  2. Variable named the same as the pin (e.g., `servo_pin`) if it's a non-string variable
     *  3. Hardcoded default: 90 (neutral/center position)
     */
    private resolveServoDefault(pinName: string, ctx: GenContext): string {
        // Check for <pin>_angle variable
        const angleVar = ctx.variables.find(v => v.name === pinName + '_angle');
        if (angleVar) {
            return `${pinName}_angle`;
        }
        // Check for a variable with the exact pin name (non-string)
        const pinVar = ctx.variables.find(v => v.name === pinName && !v.isString);
        if (pinVar) {
            return pinName;
        }
        // Default: 90° center/neutral position
        return '90';
    }

    /** Translate a .airo condition expression to a C++ expression. */
    private translateCondition(condition: string, pins: ParsedPin[]): string {
        let result = condition;

        // Replace input pin names with var_ references (word-boundary safe)
        const inputPins = pins.filter(p => p.mode === 'input');
        // Sort longest-first so e.g. "sensor_a" is replaced before "sensor"
        const sorted = [...inputPins].sort((a, b) => b.name.length - a.name.length);
        for (const pin of sorted) {
            result = result.replace(new RegExp(`\\b${this.escapeRegex(pin.name)}\\b`, 'g'), `var_${pin.name}`);
        }

        return result;
    }

    /** Translate a right-hand value (variable name, literal, HIGH/LOW, pin ref) to C++. */
    private translateRvalue(value: string, pins: ParsedPin[], vars: ParsedVariable[]): string {
        // Constants pass through
        if (value === 'HIGH' || value === 'LOW') return value;

        // Numeric literal
        if (/^-?\d+(\.\d+)?$/.test(value)) return value;

        // String literal
        if (value.startsWith('"') && value.endsWith('"')) return value;

        // Input pin reference → var_name
        const inputPin = pins.find(p => p.name === value && p.mode === 'input');
        if (inputPin) return `var_${value}`;

        // Output pin reference → pin_name (the const int)
        const outputPin = pins.find(p => p.name === value && p.mode === 'output');
        if (outputPin) return `pin_${value}`;

        // Known variable
        const v = vars.find(vr => vr.name === value);
        if (v) return value;

        // Fallback: return as-is (could be an expression or unknown identifier)
        return value;
    }

    /** Parse a WebSocket URL into host, port, path, and SSL flag. */
    private parseWebSocketUrl(url: string): WsUrlParts | null {
        const wssMatch = url.match(/^wss:\/\/([^\/:]+)(?::(\d+))?(\/.*)?$/);
        const wsMatch  = url.match(/^ws:\/\/([^\/:]+)(?::(\d+))?(\/.*)?$/);

        const match = wssMatch || wsMatch;
        if (!match) return null;

        const useSSL = !!wssMatch;
        const host = match[1];
        const port = match[2] ? parseInt(match[2], 10) : (useSSL ? 443 : 80);
        const path = match[3] || '/';

        return { host, port, path, useSSL };
    }

    /** Escape special regex characters in a string. */
    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
