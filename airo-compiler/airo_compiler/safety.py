"""
Safety validation and injection for the Airo Compiler.

This module:
  1. Validates the AST at compile time (pin conflicts, mode mismatches)
  2. Injects hard safety checks into the generated firmware
  3. Produces safety reports
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Dict, Set, Tuple

from .ast_nodes import (
    Program, PinDef, LoopBlock, ActForBlock, ReadForBlock,
    ConditionalBlock, Condition,
)


# ── Safety thresholds (hard-coded, brain cannot override) ─────────────

DEFAULT_THRESHOLDS = {
    "temperature_max": 60.0,       # Celsius
    "ultrasonic_min": 20.0,        # cm – human proximity
    "current_max": 2000.0,         # mA – motor overcurrent
    "battery_min": 10.0,           # percent
    "watchdog_timeout_ms": 5000,   # loop freeze detection
    "brain_timeout_ms": 30000,     # brain disconnect safe-mode
}


# ── Sensor type detection ─────────────────────────────────────────────

SENSOR_TYPE_MAP = {
    "temperature": "DHT22",
    "temp": "DHT22",
    "temperature_sensor": "DHT22",
    "ultrasonic": "HC_SR04",
    "camera": "OV2640",
    "microphone": "I2S_MIC",
    "mic": "I2S_MIC",
    "imu": "MPU6050",
    "gyro": "MPU6050",
    "accel": "MPU6050",
}

# Map sensor type to C++ reader function
SENSOR_READER_MAP = {
    "DHT22": "dht.readTemperature()",
    "HC_SR04": "read_ultrasonic_cm(PIN_{pin})",
    "OV2640": "0  /* TODO: camera capture */",
    "I2S_MIC": "0  /* TODO: I2S microphone read */",
    "MPU6050": "0  /* TODO: MPU6050 read */",
    "ANALOG": "analogRead(PIN_{pin})",
    "DIGITAL": "digitalRead(PIN_{pin})",
}


def detect_sensor_type(pin_name: str, pin_def: PinDef) -> str:
    """Auto-detect the sensor type from the pin name and definition."""
    lower = pin_name.lower()
    for key, stype in SENSOR_TYPE_MAP.items():
        if key in lower:
            return stype
    # Default: analog or digital based on mode
    return "ANALOG" if pin_def.mode == "input" else "DIGITAL"


def resolve_sensor_to_pin(sensor_name: str, pin_defs: List[PinDef],
                          aliases: dict) -> Optional[PinDef]:
    """Try to resolve a sensor alias/name to its pin definition.

    Resolution strategy:
    1. Direct match: sensor_name == pin.name
    2. Keyword match: sensor_name contains a keyword from SENSOR_TYPE_MAP
       that also appears in a pin name
    3. Alias path match: the alias module path contains a keyword that
       matches a pin name
    """
    # 1. Direct match
    for p in pin_defs:
        if p.name == sensor_name:
            return p

    # 2. Keyword-based fuzzy matching
    alias_path = aliases.get(sensor_name, "").lower()

    for p in pin_defs:
        p_lower = p.name.lower()
        if sensor_name.lower() in p_lower or p_lower in sensor_name.lower():
            return p

    # 3. Alias path matching
    for p in pin_defs:
        p_key = p.name.lower().replace("_", "")
        if p_key in alias_path.replace("/", "").replace("_", "").replace("-", ""):
            return p
        for key in SENSOR_TYPE_MAP:
            if key in alias_path and key in p.name.lower():
                return p

    return None


# ── Validation result ─────────────────────────────────────────────────

@dataclass
class SafetyViolation:
    severity: str   # "error" or "warning"
    message: str
    line: int = 0
    col: int = 0


@dataclass
class SafetyReport:
    errors: List[SafetyViolation] = field(default_factory=list)
    warnings: List[SafetyViolation] = field(default_factory=list)

    @property
    def has_errors(self) -> bool:
        return len(self.errors) > 0

    def __str__(self) -> str:
        lines = []
        for e in self.errors:
            lines.append(f"  ERROR  L{e.line}: {e.message}")
        for w in self.warnings:
            lines.append(f"  WARN   L{w.line}: {w.message}")
        return "\n".join(lines)


# ── Validator ─────────────────────────────────────────────────────────

class SafetyValidator:
    """Validates an .airo program's AST for safety issues."""

    def __init__(self, thresholds: Optional[dict] = None):
        self.thresholds = {**DEFAULT_THRESHOLDS, **(thresholds or {})}

    def validate(self, program: Program) -> SafetyReport:
        report = SafetyReport()

        # 1. Pin conflict check (duplicate pin numbers)
        pin_nums: Dict[int, str] = {}
        for pdef in program.pin_definitions:
            if pdef.number in pin_nums:
                report.errors.append(SafetyViolation(
                    severity="error",
                    message=f"Pin {pdef.number} assigned to both '{pin_nums[pdef.number]}' and '{pdef.name}'",
                    line=pdef.line,
                ))
            pin_nums[pdef.number] = pdef.name

        # 2. Mode mismatch: input pins in actfor
        pin_map = {p.name: p for p in program.pin_definitions}
        if program.loop and program.loop.actfor:
            for output_name in program.loop.actfor.outputs:
                if output_name in pin_map and pin_map[output_name].mode == "input":
                    report.errors.append(SafetyViolation(
                        severity="error",
                        message=f"Input pin '{output_name}' listed in actfor (brain cannot control input pins)",
                        line=program.loop.actfor.line,
                    ))

        # 3. Mode mismatch: output pins in read_for
        if program.loop and program.loop.read_for:
            for sensor_name in program.loop.read_for.sensors:
                if sensor_name in pin_map and pin_map[sensor_name].mode == "output":
                    report.warnings.append(SafetyViolation(
                        severity="warning",
                        message=f"Output pin '{sensor_name}' listed in read_for (usually for input sensors)",
                        line=program.loop.read_for.line,
                    ))

        # 4. Brain URL required if senddatato is used
        if program.loop and program.loop.senddatato and not program.brain_url:
            report.errors.append(SafetyViolation(
                severity="error",
                message="senddatato used but brain_url not defined",
                line=program.loop.senddatato.line,
            ))

        # 5. Empty actfor – brain has no control
        if program.loop and program.loop.actfor:
            if not program.loop.actfor.outputs:
                report.warnings.append(SafetyViolation(
                    severity="warning",
                    message="actfor block is empty – brain cannot control any outputs",
                    line=program.loop.actfor.line,
                ))

        # 6. Check for temperature sensor → add thermal protection warning
        has_temp = any("temp" in p.name.lower() for p in program.pin_definitions)
        if has_temp:
            report.warnings.append(SafetyViolation(
                severity="warning",
                message="Temperature sensor detected – thermal protection will be auto-injected",
                line=0,
            ))

        # 7. Detect sensor types
        for pdef in program.pin_definitions:
            pdef.sensor_type = detect_sensor_type(pdef.name, pdef)

        return report


# ── Safety code generation helpers ────────────────────────────────────

def generate_safety_conditions_simple(program: Program) -> List[dict]:
    """Generate safety conditions for the code generator.

    These conditions reference SENSOR NAMES from read_for (not pin names),
    because the SensorData struct uses sensor alias names.
    """
    conditions = []
    output_pins = [p for p in program.pin_definitions if p.mode == "output"]
    output_names = [p.name for p in output_pins]

    sensor_names = []
    if program.loop and program.loop.read_for:
        sensor_names = program.loop.read_for.sensors

    aliases = {a.short_name: a.module_path for a in program.aliases}
    pin_defs = program.pin_definitions

    generated_categories = set()

    # Temperature protection
    temp_sensors = []
    for s in sensor_names:
        if "temp" in s.lower():
            temp_sensors.append(s)
        elif "temp" in aliases.get(s, "").lower():
            temp_sensors.append(s)

    for ts in temp_sensors:
        conditions.append({
            "sensor": ts,
            "operator": ">",
            "threshold": DEFAULT_THRESHOLDS["temperature_max"],
            "action": "emergency_stop",
            "description": f"Thermal protection: {ts} > {DEFAULT_THRESHOLDS['temperature_max']}C",
            "outputs_to_kill": output_names,
        })

    if temp_sensors:
        generated_categories.add("temp")

    if "temp" not in generated_categories:
        for p in pin_defs:
            if "temp" in p.name.lower():
                conditions.append({
                    "sensor": p.name,
                    "operator": ">",
                    "threshold": DEFAULT_THRESHOLDS["temperature_max"],
                    "action": "emergency_stop",
                    "description": f"Thermal protection: {p.name} > {DEFAULT_THRESHOLDS['temperature_max']}C",
                    "outputs_to_kill": output_names,
                })
                generated_categories.add("temp")
                break

    # Ultrasonic proximity
    ultra_sensors = []
    for s in sensor_names:
        if "ultrasonic" in s.lower() or "distance" in s.lower():
            ultra_sensors.append(s)
        elif "ultrasonic" in aliases.get(s, "").lower():
            ultra_sensors.append(s)
        elif "eyes" in s.lower() and "ultrasonic" in aliases.get(s, "").lower():
            ultra_sensors.append(s)

    for s in sensor_names:
        alias_path = aliases.get(s, "").lower()
        if s not in ultra_sensors and ("ultrasonic" in alias_path or "distance" in alias_path):
            ultra_sensors.append(s)

    for us in ultra_sensors:
        conditions.append({
            "sensor": us,
            "operator": "<",
            "threshold": DEFAULT_THRESHOLDS["ultrasonic_min"],
            "action": "emergency_stop",
            "description": f"Proximity alert: {us} < {DEFAULT_THRESHOLDS['ultrasonic_min']}cm",
            "outputs_to_kill": output_names,
        })

    if ultra_sensors:
        generated_categories.add("ultrasonic")

    if "ultrasonic" not in generated_categories:
        for p in pin_defs:
            if "ultrasonic" in p.name.lower():
                conditions.append({
                    "sensor": p.name,
                    "operator": "<",
                    "threshold": DEFAULT_THRESHOLDS["ultrasonic_min"],
                    "action": "emergency_stop",
                    "description": f"Proximity alert: {p.name} < {DEFAULT_THRESHOLDS['ultrasonic_min']}cm",
                    "outputs_to_kill": output_names,
                })
                generated_categories.add("ultrasonic")
                break

    # User-defined safety rules
    for rule in program.safety_rules:
        if isinstance(rule, ConditionalBlock) and rule.condition:
            cond = rule.condition
            conditions.append({
                "sensor": str(cond.left),
                "operator": cond.operator,
                "threshold": cond.right,
                "action": "user_rule",
                "description": f"User safety rule: {cond.left} {cond.operator} {cond.right}",
                "outputs_to_kill": output_names,
            })

    return conditions
