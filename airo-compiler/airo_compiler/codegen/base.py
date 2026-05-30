"""
Base code generator class.

All platform-specific generators inherit from this.
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Dict, List, Optional

from jinja2 import Environment, FileSystemLoader, PackageLoader

from ..ast_nodes import Program


class BaseCodeGenerator(ABC):
    """Base class for code generators.

    Subclasses must implement generate() to produce target-specific output.
    """

    def __init__(self, program: Program, target: str, wifi_ssid: str = "YOUR_WIFI_SSID",
                 wifi_pass: str = "YOUR_WIFI_PASSWORD"):
        self.program = program
        self.target = target
        self.wifi_ssid = wifi_ssid
        self.wifi_pass = wifi_pass

        # Set up Jinja2 environment
        template_dir = self._find_template_dir()
        self.jinja_env = Environment(
            loader=FileSystemLoader(str(template_dir)),
            keep_trailing_newline=True,
            trim_blocks=True,
            lstrip_blocks=True,
        )

    def _find_template_dir(self) -> Path:
        """Find the templates directory."""
        # Look relative to this file
        base = Path(__file__).resolve().parent.parent.parent / "templates"
        if base.is_dir():
            return base
        # Fallback: relative to cwd
        cwd_template = Path.cwd() / "templates"
        if cwd_template.is_dir():
            return cwd_template
        raise FileNotFoundError(f"Templates directory not found (tried {base} and {cwd_template})")

    @abstractmethod
    def generate(self) -> Dict[str, str]:
        """Generate code and return a dict of {filename: content}."""
        ...

    def build_context(self) -> dict:
        """Build the common template context from the program AST."""
        from ..safety import (
            detect_sensor_type, SENSOR_READER_MAP,
            generate_safety_conditions_simple, DEFAULT_THRESHOLDS,
        )
        from ..brain_client import parse_brain_url, generate_ask_context

        # Pin definitions
        pin_defs = []
        for p in self.program.pin_definitions:
            stype = p.sensor_type or detect_sensor_type(p.name, p)
            reader = SENSOR_READER_MAP.get(stype, SENSOR_READER_MAP["ANALOG"])
            pin_defs.append({
                "name": p.name,
                "name_upper": p.name.upper(),
                "number": p.number,
                "mode": p.mode,
                "sensor_type": stype,
                "reader_template": reader.replace("PIN_{pin}", f"PIN_{p.name.upper()}"),
            })

        # Pin lookup by name
        pin_by_name = {p.name: p for p in self.program.pin_definitions}

        # Alias map
        alias_map = {}
        for alias in self.program.aliases:
            alias_map[alias.short_name] = alias.module_path

        # Loop data
        sensors = []
        sensor_details = []  # Pre-computed sensor-to-pin mapping for templates
        outputs = []
        output_details = []  # Pre-computed output-to-pin mapping for templates
        read_duration = 1000
        act_duration = 1000
        senddatato = False

        if self.program.loop:
            if self.program.loop.read_for:
                read_duration = self.program.loop.read_for.duration_ms
                sensors = self.program.loop.read_for.sensors
            if self.program.loop.actfor:
                act_duration = self.program.loop.actfor.duration_ms
                outputs = self.program.loop.actfor.outputs
            senddatato = self.program.loop.senddatato is not None

        # Build sensor_details: pre-computed mapping of sensor name → pin info
        # Use resolve_sensor_to_pin to match alias names to pin definitions
        from ..safety import resolve_sensor_to_pin
        for sensor in sensors:
            pdef = resolve_sensor_to_pin(sensor, self.program.pin_definitions, alias_map)
            if pdef:
                stype = pdef.sensor_type or detect_sensor_type(pdef.name, pdef)
                sensor_details.append({
                    "name": sensor,
                    "name_upper": sensor.upper(),
                    "has_pin": True,
                    "sensor_type": stype,
                    "mode": pdef.mode,
                    "pin_number": pdef.number,
                    "resolved_pin_name": pdef.name,
                    "reader_code": self._sensor_reader_code(sensor, pdef, stype),
                })
            else:
                sensor_details.append({
                    "name": sensor,
                    "name_upper": sensor.upper(),
                    "has_pin": False,
                    "sensor_type": "UNKNOWN",
                    "mode": "input",
                    "pin_number": None,
                    "resolved_pin_name": None,
                    "reader_code": f"current_data.{sensor} = 0;  // No pin mapping for {sensor}",
                })

        # Build output_details: pre-computed mapping of output name → pin info
        for output in outputs:
            pdef = pin_by_name.get(output)
            if pdef:
                output_details.append({
                    "name": output,
                    "name_upper": output.upper(),
                    "has_pin": True,
                    "mode": pdef.mode,
                    "pin_number": pdef.number,
                })
            else:
                output_details.append({
                    "name": output,
                    "name_upper": output.upper(),
                    "has_pin": False,
                    "mode": "unknown",
                    "pin_number": None,
                })

        # Brain connection
        brain = parse_brain_url(self.program.brain_url or "")

        # Safety conditions
        safety_conditions = generate_safety_conditions_simple(self.program)

        # Ask statements
        ask_stmts = []
        if self.program.loop:
            from ..ast_nodes import AskStatement
            for stmt in self.program.loop.statements:
                if isinstance(stmt, AskStatement):
                    ask_stmts.append(stmt)
        ask_context = generate_ask_context(ask_stmts)

        # Robot name from filename or variable
        robot_name = "airo_robot"
        for var in self.program.variables:
            if var.name == "robot_name":
                robot_name = str(var.value)
                break

        return {
            "program": self.program,
            "target": self.target,
            "brain_url": self.program.brain_url or "",
            "brain": brain,
            "robot_name": robot_name,
            "pin_defs": pin_defs,
            "pin_by_name": pin_by_name,
            "alias_map": alias_map,
            "imports": [imp.module_path for imp in self.program.imports],
            "sensors": sensors,
            "sensor_details": sensor_details,
            "outputs": outputs,
            "output_details": output_details,
            "read_duration": read_duration,
            "act_duration": act_duration,
            "senddatato": senddatato,
            "safety_conditions": safety_conditions,
            "thresholds": DEFAULT_THRESHOLDS,
            "wifi_ssid": self.wifi_ssid,
            "wifi_pass": self.wifi_pass,
            "has_ask": ask_context["has_ask"],
            "asks": ask_context["asks"],
        }

    @staticmethod
    def _sensor_reader_code(sensor_name: str, pin_def, sensor_type: str) -> str:
        """Generate the C++ read line for a sensor.

        sensor_name: the name used in read_for (may be an alias like "temperature")
        pin_def: the resolved PinDef (may have different name like "temperature_sensor")
        """
        pin_name_upper = pin_def.name.upper()
        if sensor_type == "DHT22":
            return f"current_data.{sensor_name} = dht_{pin_def.name}.readTemperature();  // DHT22 on GPIO{pin_def.number}"
        elif sensor_type == "HC_SR04":
            return f"current_data.{sensor_name} = read_ultrasonic_cm_{pin_def.name}();  // HC-SR04 on GPIO{pin_def.number}"
        elif sensor_type == "OV2640":
            return f"current_data.{sensor_name} = 0;  // TODO: Camera capture on GPIO{pin_def.number}"
        elif sensor_type == "I2S_MIC":
            return f"current_data.{sensor_name} = 0;  // TODO: I2S microphone on GPIO{pin_def.number}"
        elif pin_def.mode == "input":
            return f"current_data.{sensor_name} = analogRead(PIN_{pin_name_upper});  // Analog GPIO{pin_def.number}"
        else:
            return f"current_data.{sensor_name} = 0;  // Output pin, no read"

    def render_template(self, template_name: str, context: dict) -> str:
        """Render a Jinja2 template with the given context."""
        template = self.jinja_env.get_template(template_name)
        return template.render(**context)
