"""
STM32 code generator (stub).

STM32 support is planned but not yet implemented. This stub
generates a placeholder file explaining that the target is not
yet supported.
"""

from __future__ import annotations

from typing import Dict

from .base import BaseCodeGenerator
from ..ast_nodes import Program


class STM32CodeGenerator(BaseCodeGenerator):
    """Stub generator for STM32 targets (not yet implemented)."""

    def __init__(self, program: Program, **kwargs):
        super().__init__(program, target="stm32", **kwargs)

    def generate(self) -> Dict[str, str]:
        return {
            "main.cpp": (
                "// ============================================================\n"
                "// STM32 FIRMWARE GENERATION IS NOT YET IMPLEMENTED\n"
                "// ============================================================\n"
                "//\n"
                "// The STM32 target requires external WiFi module support\n"
                "// and a different HAL layer. Contributions welcome!\n"
                "//\n"
                "// For now, use the ESP32 target or implement the STM32\n"
                "// code generator in airo_compiler/codegen/stm32.py\n"
                "//\n"
            ),
        }
