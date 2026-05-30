"""
Code generator package for the Airo Compiler.

Each target platform has its own generator module.
"""

from .base import BaseCodeGenerator
from .esp32 import ESP32CodeGenerator
from .stm32 import STM32CodeGenerator

__all__ = ["BaseCodeGenerator", "ESP32CodeGenerator", "STM32CodeGenerator"]

# Map target names to generator classes
TARGET_MAP = {
    "esp32": ESP32CodeGenerator,
    "stm32": STM32CodeGenerator,
}


def get_generator(target: str):
    """Return the code generator class for the given target."""
    cls = TARGET_MAP.get(target)
    if cls is None:
        raise ValueError(f"Unknown target: {target!r}. Supported: {list(TARGET_MAP.keys())}")
    return cls
