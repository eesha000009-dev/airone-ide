"""
Airo Compiler — .airo to C++ transpiler for ESP32/ESP8266

Full, production-ready transpiler that matches the TypeScript transpiler's
capabilities.  Uses AST-based parsing of .airo files and generates complete
.ino.cpp / .ino Arduino sketches.

Usage:
    python -m airo_compiler <file.airo> --target esp32 --output <output_dir>
    python -m airo_compiler --template
"""

import sys
import os
import re
import argparse
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Set, Dict, Tuple
from urllib.parse import urlparse


# ═══════════════════════════════════════════════════════════════════════════
#  AST Node Types
# ═══════════════════════════════════════════════════════════════════════════

@dataclass
class ParsedPin:
    name: str
    number: int
    mode: str  # 'input' | 'output' | 'INPUT_PULLUP'


@dataclass
class ParsedVariable:
    name: str
    raw_value: str
    is_string: bool
    is_float: bool


# ─── Loop Statement Types ───────────────────────────────────────────────

@dataclass
class ReadForStmt:
    duration: str
    body: list = field(default_factory=list)  # List of loop stmts


@dataclass
class ActForStmt:
    duration: str
    body: list = field(default_factory=list)


@dataclass
class AskStmt:
    condition: str
    then_body: list = field(default_factory=list)
    else_body: list = field(default_factory=list)


@dataclass
class SendDataStmt:
    url_var: str


@dataclass
class SaveToStmt:
    target: str
    value: str


@dataclass
class CallStmt:
    variable: str


@dataclass
class PinWriteStmt:
    pin: str
    value: str


@dataclass
class PinRefStmt:
    pin: str


# Any loop statement
LoopStmt = (ReadForStmt, ActForStmt, AskStmt, SendDataStmt,
            SaveToStmt, CallStmt, PinWriteStmt, PinRefStmt)


# ─── Library Mapping ────────────────────────────────────────────────────

@dataclass
class LibMapping:
    includes: List[str]       # C++ #include paths (e.g. '<WiFi.h>')
    arduino_libs: List[str]   # Arduino library names for install


LIBRARY_MAP: Dict[str, LibMapping] = {
    'body/comm/wifi.airo': LibMapping(
        includes=['<WiFi.h>', '<WebSocketsClient.h>', '<ArduinoJson.h>'],
        arduino_libs=['WebSockets', 'ArduinoJson'],
    ),
    'body/actuation/servo.airo': LibMapping(
        includes=['<Servo.h>'],
        arduino_libs=[],
    ),
    'body/actuation/upper-right-hands.airo': LibMapping(
        includes=['<Servo.h>'],
        arduino_libs=[],
    ),
    'body/sight/eyes.airo': LibMapping(
        includes=['<esp_camera.h>'],
        arduino_libs=['esp32-camera'],
    ),
    'body/hearing/ears.airo': LibMapping(
        includes=['<driver/i2s.h>'],
        arduino_libs=[],
    ),
    'body/other_sensors/ultrasonic.airo': LibMapping(
        includes=[],
        arduino_libs=[],
    ),
}


# ─── WebSocket URL Parts ───────────────────────────────────────────────

@dataclass
class WsUrlParts:
    host: str
    port: int
    path: str
    use_ssl: bool


# ─── Generation Context ────────────────────────────────────────────────

@dataclass
class GenContext:
    sketch_name: str
    includes: List[str]
    pins: List[ParsedPin]
    variables: List[ParsedVariable]
    loop_stmts: list  # List of LoopStmt subtypes
    needs_wifi: bool
    needs_websocket: bool
    has_ultrasonic: bool
    library_calls: List[str]
    uses_servo: bool


# ┐─────────────────────────────────────────────────────────────────────────
#  Extracted Sections
# └─────────────────────────────────────────────────────────────────────────

@dataclass
class Sections:
    library: str
    pins: str
    variables: str
    loop: str


# ═══════════════════════════════════════════════════════════════════════════
#  Transpile Result
# ═══════════════════════════════════════════════════════════════════════════

@dataclass
class TranspileResult:
    success: bool
    cpp_code: str
    required_libraries: List[str]
    errors: List[str]


# ═══════════════════════════════════════════════════════════════════════════
#  AiroTranspiler
# ═══════════════════════════════════════════════════════════════════════════

class AiroTranspiler:
    """Full .airo → C++ transpiler matching the TypeScript reference."""

    # ─── Public API ────────────────────────────────────────────────────

    def transpile(self, airo_code: str, sketch_name: str) -> TranspileResult:
        errors: List[str] = []
        required_libraries: List[str] = []

        # 1. Extract sections
        sections = self._extract_sections(airo_code)
        if not sections.library.strip():
            errors.append('Warning: Missing #library# section — no body modules imported')
        if not sections.pins.strip():
            errors.append('Error: Missing Pin defi section — every .airo file must define pins')
        if not sections.loop.strip():
            errors.append('Error: Missing loop section — every .airo file must have a main loop')

        # 2. Parse library calls
        library_calls = self._parse_library_section(sections.library)

        # 3. Parse pin definitions
        pins = self._parse_pin_section(sections.pins, errors)

        # 4. Parse variables
        variables = self._parse_variable_section(sections.variables, errors)

        # 5. Parse loop body
        loop_stmts = self._parse_loop_body(sections.loop, pins, variables)

        # 6. Determine features
        needs_wifi = (any(v.name == 'wifi_ssid' for v in variables)
                      or 'body/comm/wifi.airo' in library_calls)
        needs_websocket = (any(v.name == 'brain_url' for v in variables)
                           or self._tree_has_send_data(loop_stmts))
        has_ultrasonic = (any(p.name == 'trig' and p.mode == 'output' for p in pins)
                          and any(p.name == 'echo' and p.mode == 'input' for p in pins))
        uses_servo = any(
            l in ('body/actuation/servo.airo', 'body/actuation/upper-right-hands.airo')
            for l in library_calls
        )

        # 7. Resolve includes and required libraries
        includes: Set[str] = set()
        includes.add('<Arduino.h>')

        for call in library_calls:
            mapping = LIBRARY_MAP.get(call)
            if mapping:
                for inc in mapping.includes:
                    includes.add(inc)
                for lib in mapping.arduino_libs:
                    if lib not in required_libraries:
                        required_libraries.append(lib)

        if needs_wifi:
            includes.add('<WiFi.h>')
        if needs_websocket:
            includes.add('<WebSocketsClient.h>')
            includes.add('<ArduinoJson.h>')
            if 'WebSockets' not in required_libraries:
                required_libraries.append('WebSockets')
            if 'ArduinoJson' not in required_libraries:
                required_libraries.append('ArduinoJson')

        # 8. Generate C++ code
        ctx = GenContext(
            sketch_name=sketch_name,
            includes=sorted(includes, key=lambda x: (0 if x == '<Arduino.h>' else 1, x)),
            pins=pins,
            variables=variables,
            loop_stmts=loop_stmts,
            needs_wifi=needs_wifi,
            needs_websocket=needs_websocket,
            has_ultrasonic=has_ultrasonic,
            library_calls=library_calls,
            uses_servo=uses_servo,
        )

        cpp_code = self._generate_cpp(ctx)

        has_errors = any(e.startswith('Error:') for e in errors)
        return TranspileResult(
            success=not has_errors,
            cpp_code=cpp_code,
            required_libraries=required_libraries,
            errors=errors,
        )

    # ─── Section Extraction ────────────────────────────────────────────

    def _extract_sections(self, code: str) -> Sections:
        lines = code.split('\n')

        library_start = -1
        pin_start = -1
        variables_start = -1
        loop_start = -1

        for i, line in enumerate(lines):
            trimmed = line.strip()
            if trimmed == '#library#' or trimmed.startswith('#library#'):
                if library_start == -1:
                    library_start = i
            elif trimmed.startswith('Pin defi'):
                if pin_start == -1:
                    pin_start = i
            elif trimmed == '#variables#' or trimmed.startswith('#variables#'):
                if variables_start == -1:
                    variables_start = i
            elif re.match(r'^loop\s*\{', trimmed) or trimmed == 'loop' or trimmed.startswith('loop '):
                if loop_start == -1:
                    loop_start = i

        # Library section: from #library# to next section
        library_end = self._earliest_positive(
            [pin_start, variables_start, loop_start], len(lines))
        library_content = ('\n'.join(lines[library_start + 1:library_end])
                           if library_start >= 0 else '')

        # Pin section: between braces of Pin defi
        pin_content = (self._extract_brace_block_content(lines, pin_start)
                       if pin_start >= 0 else '')

        # Variables section: from #variables# to next section
        variables_end = self._earliest_positive([loop_start], len(lines))
        variables_content = ('\n'.join(lines[variables_start + 1:variables_end])
                             if variables_start >= 0 else '')

        # Loop section: between braces of loop
        loop_content = (self._extract_brace_block_content(lines, loop_start)
                        if loop_start >= 0 else '')

        return Sections(
            library=library_content,
            pins=pin_content,
            variables=variables_content,
            loop=loop_content,
        )

    @staticmethod
    def _earliest_positive(candidates: List[int], fallback: int) -> int:
        positive = [c for c in candidates if c > 0]
        return min(positive) if positive else fallback

    def _extract_brace_block_content(self, lines: List[str], start_line: int) -> str:
        """Extract text between the first pair of matching braces starting at *start_line*."""
        depth = 0
        started = False
        block_start = -1
        block_end = -1

        for i in range(start_line, len(lines)):
            for ch in lines[i]:
                if ch == '{':
                    if not started:
                        block_start = i
                    depth += 1
                    started = True
                elif ch == '}':
                    depth -= 1
                    if depth == 0 and started:
                        block_end = i
                        break
            if block_end >= 0:
                break

        if block_start < 0 or block_end < 0:
            return ''

        block_lines = lines[block_start:block_end + 1]
        joined = '\n'.join(block_lines)
        open_idx = joined.find('{')
        close_idx = joined.rfind('}')
        if open_idx < 0 or close_idx < 0:
            return ''
        return joined[open_idx + 1:close_idx]

    # ─── Library Section Parsing ───────────────────────────────────────

    def _parse_library_section(self, text: str) -> List[str]:
        calls: List[str] = []
        for line in text.split('\n'):
            trimmed = line.strip()
            # Match: # call body/comm/wifi.airo.  OR  call body/comm/wifi.airo.
            m = re.match(r'^#?\s*call\s+(.+?)\.airo\.\s*$', trimmed)
            if m:
                calls.append(m.group(1) + '.airo')
        return calls

    # ─── Pin Section Parsing ───────────────────────────────────────────

    def _parse_pin_section(self, text: str, errors: List[str]) -> List[ParsedPin]:
        pins: List[ParsedPin] = []
        for line in text.split('\n'):
            trimmed = line.strip()
            if not trimmed or trimmed.startswith('#') or trimmed in ('{', '}'):
                continue

            # Format: name = number; mode.
            m = re.match(
                r'^(\w+)\s*=\s*(\d+)\s*;\s*(input|output|INPUT_PULLUP)\s*\.\s*$',
                trimmed, re.IGNORECASE)
            if m:
                mode_raw = m.group(3).lower()
                if mode_raw == 'input_pullup':
                    mode = 'INPUT_PULLUP'
                else:
                    mode = mode_raw  # 'input' or 'output'
                pins.append(ParsedPin(
                    name=m.group(1),
                    number=int(m.group(2)),
                    mode=mode,
                ))
            elif '=' in trimmed and not trimmed.startswith('#'):
                errors.append(f'Warning: Unrecognized pin definition: "{trimmed}"')
        return pins

    # ─── Variable Section Parsing ──────────────────────────────────────

    def _parse_variable_section(self, text: str, errors: List[str]) -> List[ParsedVariable]:
        variables: List[ParsedVariable] = []
        for line in text.split('\n'):
            trimmed = line.strip()
            if not trimmed or trimmed.startswith('#'):
                continue

            # Format: name = value.   (value ends with ".")
            m = re.match(r'^(\w+)\s*=\s*(.+?)\s*\.\s*$', trimmed)
            if m:
                name = m.group(1)
                raw = m.group(2).strip()
                is_string = raw.startswith('"') and raw.endswith('"')
                is_float = (not is_string) and bool(re.match(r'^-?\d+\.\d+$', raw))
                variables.append(ParsedVariable(
                    name=name,
                    raw_value=raw,
                    is_string=is_string,
                    is_float=is_float,
                ))
            elif '=' in trimmed and not trimmed.startswith('#'):
                errors.append(f'Warning: Unrecognized variable definition: "{trimmed}"')
        return variables

    # ─── Loop Body Parsing ─────────────────────────────────────────────

    def _parse_loop_body(self, text: str, pins: List[ParsedPin],
                         vars_: List[ParsedVariable]) -> list:
        cleaned = self._strip_comments(text)
        return self._scan_statements(cleaned, pins, vars_)

    @staticmethod
    def _strip_comments(text: str) -> str:
        return '\n'.join(
            line for line in text.split('\n')
            if line.strip() not in ('#library#', '#variables#')
            and not line.strip().startswith('#')
        )

    def _scan_statements(self, text: str, pins: List[ParsedPin],
                         vars_: List[ParsedVariable]) -> list:
        stmts: list = []
        pos = 0

        def skip_ws():
            nonlocal pos
            while pos < len(text) and text[pos] in ' \t\n\r':
                pos += 1

        while pos < len(text):
            skip_ws()
            if pos >= len(text):
                break

            remaining = text[pos:]

            # ── read_for(N) { ... } ──────────────────────────────
            m = re.match(r'^read_for\s*\(\s*([^)]+?)\s*\)\s*\{', remaining)
            if m:
                duration = m.group(1).strip()
                pos += m.end()
                open_brace = pos - 1
                close_brace = self._find_matching_brace(text, open_brace)
                body_text = text[pos:close_brace]
                stmts.append(ReadForStmt(
                    duration=duration,
                    body=self._scan_statements(body_text, pins, vars_),
                ))
                pos = close_brace + 1
                continue

            # ── actfor(N) { ... } ────────────────────────────────
            m = re.match(r'^actfor\s*\(\s*([^)]+?)\s*\)\s*\{', remaining)
            if m:
                duration = m.group(1).strip()
                pos += m.end()
                open_brace = pos - 1
                close_brace = self._find_matching_brace(text, open_brace)
                body_text = text[pos:close_brace]
                stmts.append(ActForStmt(
                    duration=duration,
                    body=self._scan_statements(body_text, pins, vars_),
                ))
                pos = close_brace + 1
                continue

            # ── ask condition { ... } [else { ... }] ─────────────
            m = re.match(r'^ask\s+(.+?)\s*\{', remaining)
            if m:
                condition = m.group(1).strip()
                pos += m.end()
                then_open = pos - 1
                then_close = self._find_matching_brace(text, then_open)
                then_text = text[pos:then_close]
                then_body = self._scan_statements(then_text, pins, vars_)
                pos = then_close + 1

                else_body: list = []
                skip_ws()
                after_then = text[pos:].lstrip()
                if after_then.startswith('else'):
                    else_idx = text[pos:].find('else')
                    pos += else_idx + 4
                    skip_ws()
                    if pos < len(text) and text[pos] == '{':
                        pos += 1  # skip {
                        else_open = pos - 1
                        else_close = self._find_matching_brace(text, else_open)
                        else_text = text[pos:else_close]
                        else_body = self._scan_statements(else_text, pins, vars_)
                        pos = else_close + 1

                stmts.append(AskStmt(
                    condition=condition,
                    then_body=then_body,
                    else_body=else_body,
                ))
                continue

            # ── senddatato(url). ─────────────────────────────────
            m = re.match(r'^senddatato\s*\(\s*([^)]+?)\s*\)\s*\.', remaining)
            if m:
                stmts.append(SendDataStmt(url_var=m.group(1).strip()))
                pos += m.end()
                continue

            # ── saveto var = value. ──────────────────────────────
            m = re.match(r'^saveto\s+(\w+)\s*=\s*(.+?)\s*\.', remaining)
            if m:
                stmts.append(SaveToStmt(
                    target=m.group(1),
                    value=m.group(2).strip(),
                ))
                pos += m.end()
                continue

            # ── call var. ────────────────────────────────────────
            m = re.match(r'^call\s+(\w+)\s*\.', remaining)
            if m:
                stmts.append(CallStmt(variable=m.group(1)))
                pos += m.end()
                continue

            # ── pin = value.  (pin write: led = HIGH.) ───────────
            m = re.match(r'^(\w+)\s*=\s*(\w+)\s*\.', remaining)
            if m:
                stmts.append(PinWriteStmt(pin=m.group(1), value=m.group(2)))
                pos += m.end()
                continue

            # ── pin.  (bare pin reference: sensor.) ──────────────
            m = re.match(r'^(\w+)\s*\.', remaining)
            if m:
                stmts.append(PinRefStmt(pin=m.group(1)))
                pos += m.end()
                continue

            # Skip unrecognized character
            pos += 1

        return stmts

    @staticmethod
    def _find_matching_brace(text: str, open_pos: int) -> int:
        """Find the position of the ``}`` that matches the ``{`` at *open_pos*."""
        depth = 0
        for i in range(open_pos, len(text)):
            if text[i] == '{':
                depth += 1
            elif text[i] == '}':
                depth -= 1
                if depth == 0:
                    return i
        return len(text)  # unmatched — return end

    # ─── Feature Detection ─────────────────────────────────────────────

    def _tree_has_send_data(self, stmts: list) -> bool:
        for s in stmts:
            if isinstance(s, SendDataStmt):
                return True
            if isinstance(s, ReadForStmt) and self._tree_has_send_data(s.body):
                return True
            if isinstance(s, ActForStmt) and self._tree_has_send_data(s.body):
                return True
            if isinstance(s, AskStmt):
                if self._tree_has_send_data(s.then_body) or self._tree_has_send_data(s.else_body):
                    return True
        return False

    # ═══════════════════════════════════════════════════════════════════
    #  C++ Code Generation
    # ═══════════════════════════════════════════════════════════════════

    def _generate_cpp(self, ctx: GenContext) -> str:
        L: List[str] = []
        I = lambda n: '    ' * n

        # ── File header ───────────────────────────────────────────
        L.append('/*')
        L.append(f' * Generated by Airone IDE from {ctx.sketch_name}.airo')
        L.append(' * Target: ESP32 (Arduino framework)')
        L.append(' *')
        L.append(' * DO NOT EDIT — regenerate from the .airo source.')
        L.append(' */')

        # ── Includes ──────────────────────────────────────────────
        L.append('')
        L.append('// ─── Includes ─────────────────────────────────────────────────────────────')
        for inc in ctx.includes:
            L.append(f'#include {inc}')

        # ── Pin definitions ───────────────────────────────────────
        if ctx.pins:
            L.append('')
            L.append('// ─── Pin Definitions ──────────────────────────────────────────────────────')
            for pin in ctx.pins:
                L.append(f'const int pin_{pin.name} = {pin.number};')

        # ── Servo objects ─────────────────────────────────────────
        servo_pins = self._get_servo_pins(ctx)
        if servo_pins:
            L.append('')
            L.append('// ─── Servo Objects ────────────────────────────────────────────────────────')
            for sp in servo_pins:
                L.append(f'Servo servo_{sp.name};')

        # ── User variables ────────────────────────────────────────
        if ctx.variables:
            L.append('')
            L.append('// ─── Variables ────────────────────────────────────────────────────────────')
            for v in ctx.variables:
                cpp_type = 'String' if v.is_string else ('float' if v.is_float else 'int')
                L.append(f'{cpp_type} {v.name} = {v.raw_value};')

        # ── Sensor variables ──────────────────────────────────────
        input_pins = [p for p in ctx.pins if p.mode == 'input']
        if input_pins:
            L.append('')
            L.append('// ─── Sensor Variables ─────────────────────────────────────────────────────')
            for ip in input_pins:
                L.append(f'int var_{ip.name} = 0;')

        # ── WebSocket client ──────────────────────────────────────
        if ctx.needs_websocket:
            L.append('')
            L.append('// ─── WebSocket Client ─────────────────────────────────────────────────────')
            L.append('WebSocketsClient webSocket;')

        # ── Helper: ultrasonic distance ───────────────────────────
        if ctx.has_ultrasonic:
            L.append('')
            L.append('// ─── Helper: Ultrasonic Distance ──────────────────────────────────────────')
            L.append('long measureDistance(int trigPin, int echoPin) {')
            L.append(f'{I(1)}digitalWrite(trigPin, LOW);')
            L.append(f'{I(1)}delayMicroseconds(2);')
            L.append(f'{I(1)}digitalWrite(trigPin, HIGH);')
            L.append(f'{I(1)}delayMicroseconds(10);')
            L.append(f'{I(1)}digitalWrite(trigPin, LOW);')
            L.append(f'{I(1)}long duration = pulseIn(echoPin, HIGH, 30000);')
            L.append(f'{I(1)}if (duration == 0) return -1;')
            L.append(f'{I(1)}return duration * 0.034 / 2;')
            L.append('}')

        # ── WebSocket event handler ───────────────────────────────
        if ctx.needs_websocket:
            L.append('')
            L.append('// ─── WebSocket Event Handler ──────────────────────────────────────────────')
            L.append('void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {')
            L.append(f'{I(1)}switch(type) {{')
            L.append(f'{I(2)}case WStype_DISCONNECTED:')
            L.append(f'{I(3)}Serial.println("[WS] Disconnected!");')
            L.append(f'{I(3)}break;')
            L.append(f'{I(2)}case WStype_CONNECTED:')
            L.append(f'{I(3)}Serial.println("[WS] Connected!");')
            L.append(f'{I(3)}break;')
            L.append(f'{I(2)}case WStype_TEXT: {{')
            L.append(f'{I(3)}DynamicJsonDocument _cmd(1024);')
            L.append(f'{I(3)}deserializeJson(_cmd, payload, length);')
            output_pins = [p for p in ctx.pins if p.mode == 'output']
            for op in output_pins:
                if op in servo_pins:
                    L.append(f'{I(3)}if (_cmd.containsKey("{op.name}")) {{')
                    L.append(f'{I(4)}int _val = _cmd["{op.name}"].as<int>();')
                    L.append(f'{I(4)}servo_{op.name}.write(_val);')
                    L.append(f'{I(3)}}}')
                else:
                    L.append(f'{I(3)}if (_cmd.containsKey("{op.name}")) {{')
                    L.append(f'{I(4)}int _val = _cmd["{op.name}"].as<int>();')
                    L.append(f'{I(4)}digitalWrite(pin_{op.name}, _val);')
                    L.append(f'{I(3)}}}')
            L.append(f'{I(3)}break;')
            L.append(f'{I(2)}}}')
            L.append(f'{I(2)}default:')
            L.append(f'{I(3)}break;')
            L.append(f'{I(1)}}}')
            L.append('}')

        # ── setup() ───────────────────────────────────────────────
        L.append('')
        L.append('// ─── Setup ────────────────────────────────────────────────────────────────')
        L.append('void setup() {')
        L.append(f'{I(1)}Serial.begin(115200);')
        L.append(f'{I(1)}delay(100);')
        L.append('')

        # Pin modes
        if ctx.pins:
            L.append(f'{I(1)}// Pin modes')
            for pin in ctx.pins:
                if pin.mode == 'INPUT_PULLUP':
                    mode_str = 'INPUT_PULLUP'
                elif pin.mode == 'input':
                    mode_str = 'INPUT'
                else:
                    mode_str = 'OUTPUT'
                L.append(f'{I(1)}pinMode(pin_{pin.name}, {mode_str});')
            L.append('')

        # Servo attach
        if servo_pins:
            L.append(f'{I(1)}// Servo attach')
            for sp in servo_pins:
                L.append(f'{I(1)}servo_{sp.name}.attach(pin_{sp.name});')
            L.append('')

        # WiFi
        if ctx.needs_wifi:
            ssid_var = next((v for v in ctx.variables if v.name == 'wifi_ssid'), None)

            L.append(f'{I(1)}// WiFi connection')
            if ssid_var:
                L.append(f'{I(1)}WiFi.begin(wifi_ssid.c_str(), wifi_password.c_str());')
            else:
                L.append(f'{I(1)}// WARNING: wifi_ssid not defined in .airo variables')
                L.append(f'{I(1)}WiFi.begin("", "");')
            L.append(f'{I(1)}Serial.print("Connecting to WiFi");')
            L.append(f'{I(1)}int _wifiTimeout = 0;')
            L.append(f'{I(1)}while (WiFi.status() != WL_CONNECTED && _wifiTimeout < 40) {{')
            L.append(f'{I(2)}delay(500);')
            L.append(f'{I(2)}Serial.print(".");')
            L.append(f'{I(2)}_wifiTimeout++;')
            L.append(f'{I(1)}}}')
            L.append(f'{I(1)}if (WiFi.status() == WL_CONNECTED) {{')
            L.append(f'{I(2)}Serial.println();')
            L.append(f'{I(2)}Serial.print("WiFi connected! IP: ");')
            L.append(f'{I(2)}Serial.println(WiFi.localIP());')

            # WebSocket
            if ctx.needs_websocket:
                brain_var = next((v for v in ctx.variables if v.name == 'brain_url'), None)
                L.append('')
                L.append(f'{I(2)}// WebSocket connection')
                if brain_var:
                    url_str = brain_var.raw_value.strip('"')
                    url_parts = self._parse_websocket_url(url_str)
                    if url_parts:
                        if url_parts.use_ssl:
                            L.append(f'{I(2)}webSocket.beginSSL("{url_parts.host}", {url_parts.port}, "{url_parts.path}");')
                        else:
                            L.append(f'{I(2)}webSocket.begin("{url_parts.host}", {url_parts.port}, "{url_parts.path}");')
                    else:
                        L.append(f'{I(2)}// WARNING: Could not parse brain_url — falling back to direct string')
                        L.append(f'{I(2)}webSocket.beginSSL(brain_url.c_str(), 443, "/");')
                else:
                    L.append(f'{I(2)}// WARNING: brain_url not defined in .airo variables')
                L.append(f'{I(2)}webSocket.onEvent(webSocketEvent);')
                L.append(f'{I(2)}webSocket.setReconnectInterval(5000);')

            L.append(f'{I(1)}}} else {{')
            L.append(f'{I(2)}Serial.println();')
            L.append(f'{I(2)}Serial.println("WiFi connection failed!");')
            L.append(f'{I(1)}}}')

        L.append('}')

        # ── loop() ────────────────────────────────────────────────
        L.append('')
        L.append('// ─── Loop ─────────────────────────────────────────────────────────────────')
        L.append('void loop() {')

        if ctx.needs_websocket:
            L.append(f'{I(1)}webSocket.loop();')

        for stmt in ctx.loop_stmts:
            L.append(self._generate_stmt(stmt, 1, ctx))

        L.append('}')

        return '\n'.join(L)

    # ─── Servo Pin Helper ─────────────────────────────────────────────

    @staticmethod
    def _get_servo_pins(ctx: GenContext) -> List[ParsedPin]:
        if not ctx.uses_servo:
            return []
        return [
            p for p in ctx.pins
            if p.mode == 'output' and re.search(r'servo|motor|hand|arm|leg', p.name, re.IGNORECASE)
        ]

    # ─── Statement Code Generation ────────────────────────────────────

    def _generate_stmt(self, stmt, indent: int, ctx: GenContext) -> str:
        I = lambda n: '    ' * (n + indent)
        input_pins = [p for p in ctx.pins if p.mode == 'input']
        servo_pins = self._get_servo_pins(ctx)

        # ── read_for ──────────────────────────────────────────────
        if isinstance(stmt, ReadForStmt):
            L: List[str] = []
            dur = self._translate_rvalue(stmt.duration, ctx.pins, ctx.variables)
            L.append(f'{I(0)}// read_for({stmt.duration})')
            if stmt.duration.strip() == '0':
                L.append(f'{I(0)}{{')
                for s in stmt.body:
                    if isinstance(s, PinRefStmt):
                        L.append(self._generate_pin_read(s.pin, indent + 1, ctx))
                L.append(f'{I(0)}}}')
            else:
                L.append(f'{I(0)}{{')
                L.append(f'{I(1)}unsigned long _read_start = millis();')
                L.append(f'{I(1)}while (millis() - _read_start < {dur}) {{')
                for s in stmt.body:
                    if isinstance(s, PinRefStmt):
                        L.append(self._generate_pin_read(s.pin, indent + 2, ctx))
                L.append(f'{I(2)}yield();')
                L.append(f'{I(1)}}}')
                L.append(f'{I(0)}}}')
            return '\n'.join(L)

        # ── actfor ────────────────────────────────────────────────
        if isinstance(stmt, ActForStmt):
            L = []
            dur = self._translate_rvalue(stmt.duration, ctx.pins, ctx.variables)
            L.append(f'{I(0)}// actfor({stmt.duration})')
            L.append(f'{I(0)}{{')
            L.append(f'{I(1)}unsigned long _act_start = millis();')
            L.append(f'{I(1)}while (millis() - _act_start < {dur}) {{')
            for s in stmt.body:
                if isinstance(s, PinRefStmt):
                    pin_def = next((p for p in ctx.pins if p.name == s.pin), None)
                    if pin_def and pin_def.mode == 'output':
                        if pin_def in servo_pins:
                            L.append(f'{I(2)}servo_{s.pin}.write(90); // default angle')
                        else:
                            L.append(f'{I(2)}digitalWrite(pin_{s.pin}, HIGH);')
            L.append(f'{I(2)}yield();')
            L.append(f'{I(1)}}}')
            L.append(f'{I(0)}}}')
            return '\n'.join(L)

        # ── ask ───────────────────────────────────────────────────
        if isinstance(stmt, AskStmt):
            L = []
            cond = self._translate_condition(stmt.condition, ctx.pins)
            L.append(f'{I(0)}if ({cond}) {{')
            for s in stmt.then_body:
                L.append(self._generate_stmt(s, indent + 1, ctx))
            if stmt.else_body:
                L.append(f'{I(0)}}} else {{')
                for s in stmt.else_body:
                    L.append(self._generate_stmt(s, indent + 1, ctx))
            L.append(f'{I(0)}}}')
            return '\n'.join(L)

        # ── senddatato ────────────────────────────────────────────
        if isinstance(stmt, SendDataStmt):
            L = []
            L.append(f'{I(0)}// senddatato({stmt.url_var})')
            L.append(f'{I(0)}{{')
            L.append(f'{I(1)}DynamicJsonDocument _doc(1024);')
            for ip in input_pins:
                L.append(f'{I(1)}_doc["{ip.name}"] = var_{ip.name};')
            L.append(f'{I(1)}String _json;')
            L.append(f'{I(1)}serializeJson(_doc, _json);')
            L.append(f'{I(1)}webSocket.sendTXT(_json);')
            L.append(f'{I(0)}}}')
            return '\n'.join(L)

        # ── saveto ────────────────────────────────────────────────
        if isinstance(stmt, SaveToStmt):
            L = []
            target_pin = next((p for p in ctx.pins if p.name == stmt.target), None)
            value_cpp = self._translate_rvalue(stmt.value, ctx.pins, ctx.variables)

            if target_pin:
                if target_pin.mode == 'output':
                    if target_pin in servo_pins:
                        L.append(f'{I(0)}servo_{stmt.target}.write(map({value_cpp}, 0, 4095, 0, 180));')
                    else:
                        L.append(f'{I(0)}analogWrite(pin_{stmt.target}, {value_cpp});')
                else:
                    L.append(f'{I(0)}var_{stmt.target} = {value_cpp};')
            else:
                L.append(f'{I(0)}{stmt.target} = {value_cpp};')
            return '\n'.join(L)

        # ── call ──────────────────────────────────────────────────
        if isinstance(stmt, CallStmt):
            L = []
            v = next((vr for vr in ctx.variables if vr.name == stmt.variable), None)
            if v and not v.is_string:
                L.append(f'{I(0)}delay({stmt.variable});')
            elif v and v.is_string:
                L.append(f'{I(0)}// call {stmt.variable} — skipped (not a number variable)')
            else:
                L.append(f'{I(0)}delay({stmt.variable});')
            return '\n'.join(L)

        # ── pin_write ─────────────────────────────────────────────
        if isinstance(stmt, PinWriteStmt):
            L = []
            pin_def = next((p for p in ctx.pins if p.name == stmt.pin), None)
            value_cpp = self._translate_rvalue(stmt.value, ctx.pins, ctx.variables)

            if pin_def and pin_def.mode == 'output':
                if pin_def in servo_pins and stmt.value in ('HIGH', 'LOW'):
                    angle = '180' if stmt.value == 'HIGH' else '0'
                    L.append(f'{I(0)}servo_{stmt.pin}.write({angle});')
                else:
                    L.append(f'{I(0)}digitalWrite(pin_{stmt.pin}, {value_cpp});')
            elif pin_def and pin_def.mode == 'input':
                L.append(f'{I(0)}var_{stmt.pin} = {value_cpp};')
            else:
                L.append(f'{I(0)}{stmt.pin} = {value_cpp};')
            return '\n'.join(L)

        # ── pin_ref (bare reference) ──────────────────────────────
        if isinstance(stmt, PinRefStmt):
            pin_def = next((p for p in ctx.pins if p.name == stmt.pin), None)
            if pin_def and pin_def.mode == 'input':
                return self._generate_pin_read(stmt.pin, indent, ctx)
            elif pin_def and pin_def.mode == 'output':
                if pin_def in servo_pins:
                    return f'{I(0)}servo_{stmt.pin}.write(90); // activate'
                return f'{I(0)}digitalWrite(pin_{stmt.pin}, HIGH);'
            return f'{I(0)}// pin_ref: {stmt.pin}'

        return f'{I(0)}// unknown statement'

    # ─── Pin Read Generation ──────────────────────────────────────────

    def _generate_pin_read(self, pin_name: str, indent: int, ctx: GenContext) -> str:
        I = lambda n: '    ' * (n + indent)
        pin_def = next((p for p in ctx.pins if p.name == pin_name), None)
        if not pin_def or pin_def.mode != 'input':
            return f'{I(0)}// pin_ref: {pin_name} (not an input pin)'

        # Special case: ultrasonic echo pin
        if pin_name == 'echo' and ctx.has_ultrasonic:
            return f'{I(0)}var_echo = measureDistance(pin_trig, pin_echo);'

        return f'{I(0)}var_{pin_name} = analogRead(pin_{pin_name});'

    # ─── Translation Helpers ───────────────────────────────────────────

    def _translate_condition(self, condition: str, pins: List[ParsedPin]) -> str:
        """Translate a .airo condition expression to a C++ expression."""
        result = condition
        input_pins = sorted(
            [p for p in pins if p.mode == 'input'],
            key=lambda p: len(p.name),
            reverse=True,
        )
        for pin in input_pins:
            result = re.sub(
                r'\b' + re.escape(pin.name) + r'\b',
                f'var_{pin.name}',
                result,
            )
        return result

    def _translate_rvalue(self, value: str, pins: List[ParsedPin],
                          vars_: List[ParsedVariable]) -> str:
        """Translate a right-hand value to C++."""
        # Constants pass through
        if value in ('HIGH', 'LOW'):
            return value

        # Numeric literal
        if re.match(r'^-?\d+(\.\d+)?$', value):
            return value

        # String literal
        if value.startswith('"') and value.endswith('"'):
            return value

        # Input pin reference → var_name
        if any(p.name == value and p.mode == 'input' for p in pins):
            return f'var_{value}'

        # Output pin reference → pin_name
        if any(p.name == value and p.mode == 'output' for p in pins):
            return f'pin_{value}'

        # Known variable
        if any(v.name == value for v in vars_):
            return value

        # Fallback
        return value

    # ─── WebSocket URL Parsing ─────────────────────────────────────────

    @staticmethod
    def _parse_websocket_url(url: str) -> Optional[WsUrlParts]:
        """Parse a WebSocket URL into host, port, path, and SSL flag."""
        wss_match = re.match(r'^wss://([^/:]+)(?::(\d+))?(/.*)?$', url)
        ws_match = re.match(r'^ws://([^/:]+)(?::(\d+))?(/.*)?$', url)

        match = wss_match or ws_match
        if not match:
            return None

        use_ssl = bool(wss_match)
        host = match.group(1)
        port = int(match.group(2)) if match.group(2) else (443 if use_ssl else 80)
        path = match.group(3) or '/'

        return WsUrlParts(host=host, port=port, path=path, use_ssl=use_ssl)


# ═══════════════════════════════════════════════════════════════════════════
#  Template & CLI
# ═══════════════════════════════════════════════════════════════════════════

def get_template():
    """Return the default .airo sketch template."""
    return '''# ============================================
# AIRONE ROBOT CONFIGURATION
# ============================================

#library#
# Import body modules for your robot
# call body/actuation/upper-right-hands.airo.
# call body/sight/eyes.airo.
# call body/hearing/ears.airo.
# call body/speech/mouth.airo.
# call body/other_sensors/temperature.airo.

Pin defi {
    # pin_name = pin_number; mode.
    # mode: input (brings data in / senses) or output (makes action)
    ledpin = 2; output.
    # temperature_sensor = 35; input.
    # ultrasonic = 34; input.
    # servo_right = 13; output.
}

#variables#
# Brain URL — where your AI brain lives
brain_url = "wss://your-brain.local:8080".
call brain_url.

# Aliases (short names for body modules)
# body/sight/eyes.airo = eyes.
# body/hearing/ears.airo = ears.

# ============================================
# MAIN LOOP — The robot runs this forever
# SENSE → THINK → ACT
# ============================================
loop {
    # Phase 1: SENSE — Read all input sensors
    # Only place sensors/modules that bring in data or sense
    read_for(1000) {
        # temperature.
        # eyes.
        # ears.
    }

    # Phase 2: THINK — Send data to brain via WebSocket
    senddatato(brain_url).

    # Phase 3: ACT — Execute brain commands
    # Only place output modules here (things that make actions)
    actfor(1000) {
        ledpin.
        # servo_right.
    }
}
'''


def compile_file(file_path: str, target: str = 'esp32', output_dir: str = 'build',
                 wifi_ssid: str = None, wifi_pass: str = None) -> int:
    """Compile an .airo file to C++ (.ino.cpp + .ino)."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        base_name = Path(file_path).stem
        transpiler = AiroTranspiler()
        result = transpiler.transpile(content, base_name)

        # If WiFi credentials are supplied via CLI, inject them
        if wifi_ssid and result.success:
            # Add wifi_ssid / wifi_password variables if not already present
            lines = result.cpp_code.split('\n')
            # Find the variable section marker and inject before setup
            var_section_idx = None
            for i, line in enumerate(lines):
                if '// ─── Variables' in line:
                    var_section_idx = i
                    break

            has_ssid = 'wifi_ssid' in result.cpp_code
            has_pass = 'wifi_password' in result.cpp_code

            inject_lines = []
            if not has_ssid:
                inject_lines.append(f'String wifi_ssid = "{wifi_ssid}";')
            if not has_pass:
                inject_lines.append(f'String wifi_password = "{wifi_pass or ""}";')

            if inject_lines and var_section_idx is not None:
                # Insert after the section header
                for j, il in enumerate(inject_lines):
                    lines.insert(var_section_idx + 1 + j, il)
                result.cpp_code = '\n'.join(lines)

        # Create output directory
        os.makedirs(output_dir, exist_ok=True)

        # Write .ino.cpp output
        cpp_file = os.path.join(output_dir, f'{base_name}.ino.cpp')
        with open(cpp_file, 'w', encoding='utf-8') as f:
            f.write(result.cpp_code)

        # Write .ino file that includes the .ino.cpp
        ino_file = os.path.join(output_dir, f'{base_name}.ino')
        with open(ino_file, 'w', encoding='utf-8') as f:
            f.write(f'// Auto-generated by Airone IDE\n')
            f.write(f'#include "{base_name}.ino.cpp"\n')

        # Print summary
        status = '✓' if result.success else '✗'
        print(f'{status} Transpiled {file_path} -> {cpp_file}')
        print(f'  Target: {target}')
        print(f'  Libraries: {len(transpiler._parse_library_section(content))}')
        print(f'  Pins: {len(transpiler._parse_pin_section(content, []))}')
        print(f'  Variables: {len(transpiler._parse_variable_section(content, []))}')

        for err in result.errors:
            print(f'  {err}', file=sys.stderr)

        # Output JSON result for machine consumption
        json_result = {
            'success': result.success,
            'output_file': cpp_file,
            'ino_file': ino_file,
            'target': target,
            'required_libraries': result.required_libraries,
            'errors': result.errors,
        }
        result_file = os.path.join(output_dir, f'{base_name}.result.json')
        with open(result_file, 'w', encoding='utf-8') as f:
            json.dump(json_result, f, indent=2)

        return 0 if result.success else 1

    except FileNotFoundError:
        print(f'✗ Error: File not found: {file_path}', file=sys.stderr)
        return 1
    except Exception as e:
        print(f'✗ Error: {str(e)}', file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return 1


def main():
    parser = argparse.ArgumentParser(
        description='Airo Compiler — .airo to C++ transpiler for ESP32/ESP8266'
    )
    parser.add_argument('file', nargs='?', help='Input .airo file')
    parser.add_argument('--target', default='esp32',
                        choices=['esp32', 'esp32s2', 'esp32s3', 'esp32c3', 'esp8266'],
                        help='Target board (default: esp32)')
    parser.add_argument('--output', default='build',
                        help='Output directory (default: build)')
    parser.add_argument('--template', action='store_true',
                        help='Print the default .airo template')
    parser.add_argument('--wifi-ssid', help='WiFi SSID for network features')
    parser.add_argument('--wifi-pass', help='WiFi password for network features')

    args = parser.parse_args()

    if args.template:
        print(get_template())
        return 0

    if not args.file:
        parser.print_help()
        return 1

    return compile_file(
        args.file,
        target=args.target,
        output_dir=args.output,
        wifi_ssid=args.wifi_ssid,
        wifi_pass=args.wifi_pass,
    )


if __name__ == '__main__':
    sys.exit(main())
