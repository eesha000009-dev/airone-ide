"""
Rule-based fallback provider for the Goal Brain.

This provider requires no external API and works entirely offline.
It uses simple deterministic rules to generate commands from sensor data.
This is the default provider and always works.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from .base import BaseLLMProvider, LLMResponse

logger = logging.getLogger(__name__)


class RuleEngineProvider(BaseLLMProvider):
    """Built-in rule-based processing. No API needed, always works."""

    provider_name = "rule-based"

    def __init__(self, **kwargs: Any):
        super().__init__(**kwargs)

    async def generate(self, prompt: str, system_prompt: str = "") -> LLMResponse:
        """The rule engine doesn't parse prompts — use `process_sensors()` directly."""
        return LLMResponse(
            commands={},
            reasoning="Rule engine does not parse text prompts; use process_sensors()",
            confidence=0.0,
            model=self.provider_name,
        )

    async def test_connection(self) -> Dict[str, Any]:
        return {"success": True, "model": self.provider_name, "note": "Always available"}

    async def process_sensors(
        self,
        sensor_data: Dict[str, Any],
        available_modules: Optional[list] = None,
        pins: Optional[list] = None,
    ) -> LLMResponse:
        """Process sensor readings with built-in rules.

        This is the main entry point for the rule engine — it does NOT
        use text prompts but instead works directly on structured data.
        """
        commands: Dict[str, Any] = {}
        sensors = sensor_data.get("input_sensors_read", sensor_data)
        available = available_modules or sensor_data.get("output_modules_available", [])
        pin_names = [p["pin_name"] for p in (pins or [])] if pins else []

        def has(mod: str) -> bool:
            return mod in available or mod in pin_names

        reasoning_parts: list[str] = []

        # Temperature rule
        temp = sensors.get("temperature") or sensors.get("temperature_sensor")
        if temp is not None:
            try:
                temp = float(temp)
            except (ValueError, TypeError):
                temp = None
        if temp is not None and has("ledpin"):
            if temp > 30:
                commands["ledpin"] = {"action": "digitalwrite", "value": 1}
                reasoning_parts.append(f"Temperature {temp}°C > 30 → LED ON (warning)")
            elif temp < 25:
                commands["ledpin"] = {"action": "digitalwrite", "value": 0}
                reasoning_parts.append(f"Temperature {temp}°C < 25 → LED OFF (normal)")

        # Ultrasonic / proximity rule
        distance = sensors.get("ultrasonic") or sensors.get("distance")
        if distance is not None:
            try:
                distance = float(distance)
            except (ValueError, TypeError):
                distance = None
        if distance is not None and has("urhands"):
            if distance < 50:
                commands["urhands"] = {"action": "servo", "angle": 45}
                reasoning_parts.append(f"Object at {distance}cm < 50 → Hand reaching")
            elif distance > 100:
                commands["urhands"] = {"action": "servo", "angle": 0}
                reasoning_parts.append(f"No object nearby ({distance}cm) → Hand resting")

        # Walking demo (leg servo cycling)
        if has("llleg") and "llleg" not in commands:
            import random
            angle = random.randint(30, 90)
            commands["llleg"] = {"action": "servo", "angle": angle}
            reasoning_parts.append(f"Walking demo → llleg servo({angle})")

        n = len(sensors) if isinstance(sensors, dict) else 0
        reasoning = f"Rule-based: processed {n} sensors, issued {len(commands)} commands"
        if reasoning_parts:
            reasoning += ". " + "; ".join(reasoning_parts)

        return LLMResponse(
            commands=commands,
            reasoning=reasoning,
            confidence=0.85,
            model=self.provider_name,
        )
