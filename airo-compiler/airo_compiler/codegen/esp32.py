"""
ESP32 C++ code generator.

Uses Jinja2 templates to generate multi-file C++ firmware for ESP32:
  - main.cpp         – Main loop with WebSocket client
  - pin_map.h        – Pin definitions
  - sensor_reader.h  – Sensor reading functions
  - command_executor.h – Brain command execution (sandboxed)
  - safety_monitor.h – Hard safety checks
  - brain_client.h   – WebSocket communication
"""

from __future__ import annotations

from typing import Dict

from .base import BaseCodeGenerator
from ..ast_nodes import Program


class ESP32CodeGenerator(BaseCodeGenerator):
    """Generates C++ firmware for ESP32 targets."""

    def __init__(self, program: Program, **kwargs):
        super().__init__(program, target="esp32", **kwargs)

    def generate(self) -> Dict[str, str]:
        ctx = self.build_context()
        files = {}

        # Generate each output file from its template
        template_files = [
            ("esp32_main.cpp.j2", "main.cpp"),
            ("esp32_pins.h.j2", "pin_map.h"),
            ("esp32_sensors.h.j2", "sensor_reader.h"),
            ("esp32_commands.h.j2", "command_executor.h"),
            ("esp32_safety.h.j2", "safety_monitor.h"),
            ("esp32_brain.h.j2", "brain_client.h"),
        ]

        for template_name, output_name in template_files:
            try:
                files[output_name] = self.render_template(template_name, ctx)
            except Exception as e:
                # If a template is missing, generate a comment placeholder
                files[output_name] = (
                    f"// Template {template_name} not found or error: {e}\n"
                    f"// Please check the templates directory.\n"
                )

        return files
