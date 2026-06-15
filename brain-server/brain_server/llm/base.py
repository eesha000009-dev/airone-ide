"""
Abstract base class for LLM providers.

Every provider must implement `generate()` which receives a prompt
built from robot context and returns a structured LLMResponse.

The Airone system uses a natural language prompt format for senddatato:
  "Currently, the input sensors read:
   (sensor_name: value, sensor_name: value, ...),
   What do you want to do to:
   (output_module_1, output_module_2, ...)."

The brain's AI reads this prompt and responds with JSON commands.
"""

from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class LLMResponse:
    """Structured response from an LLM provider."""
    commands: Dict[str, Any]       # module_name -> {action, value/angle}
    reasoning: str = ""
    confidence: float = 0.0
    model: str = ""
    raw_response: str = ""


class BaseLLMProvider(ABC):
    """All LLM providers implement this interface."""

    provider_name: str = "base"

    def __init__(self, api_key: Optional[str] = None, endpoint: Optional[str] = None, **kwargs: Any):
        self.api_key = api_key
        self.endpoint = endpoint
        self.extra = kwargs

    @abstractmethod
    async def generate(self, prompt: str, system_prompt: str = "") -> LLMResponse:
        """Send a prompt and return a structured response."""
        ...

    @abstractmethod
    async def test_connection(self) -> Dict[str, Any]:
        """Test that the provider is reachable. Returns {success, model, error?}."""
        ...

    # ------------------------------------------------------------------
    # Natural language prompt parser
    # ------------------------------------------------------------------

    @staticmethod
    def parse_natural_language_prompt(text: str) -> Dict[str, Any]:
        """Parse the natural language prompt sent by the ESP32 via senddatato.

        Format:
            Currently, the input sensors read:
            (sensor_name: value, sensor_name: value, ...),
            What do you want to do to:
            (output_module_1, output_module_2, ...).

        Returns:
            {
                "input_sensors_read": {"sensor_name": value, ...},
                "output_modules_available": ["module1", "module2", ...],
                "ask_question": "" or the question text if present,
                "ask_context": "" or the context if present,
            }
        """
        result = {
            "input_sensors_read": {},
            "output_modules_available": [],
            "ask_question": "",
            "ask_context": "",
        }

        # Extract input sensors section
        # Pattern: "Currently, the input sensors read:\n(sensor_data),"
        sensors_match = re.search(
            r"Currently, the input sensors read:\s*\n?\s*\(([^)]*)\)",
            text,
            re.IGNORECASE
        )
        if sensors_match:
            sensor_text = sensors_match.group(1).strip()
            if sensor_text and sensor_text.lower() not in ("no input sensors configured", ""):
                # Parse "sensor_name: value, sensor_name: value"
                for pair in sensor_text.split(","):
                    pair = pair.strip()
                    if ":" in pair:
                        key, _, val = pair.partition(":")
                        key = key.strip()
                        val = val.strip().rstrip(",")
                        # Try to convert to number
                        try:
                            val = float(val)
                            if val == int(val):
                                val = int(val)
                        except (ValueError, TypeError):
                            pass
                        result["input_sensors_read"][key] = val

        # Extract output modules section
        # Pattern: "What do you want to do to:\n(module1, module2, ...)."
        outputs_match = re.search(
            r"What do you want to do to:\s*\n?\s*\(([^)]*)\)",
            text,
            re.IGNORECASE
        )
        if outputs_match:
            output_text = outputs_match.group(1).strip()
            if output_text and output_text.lower() not in ("no output modules configured", ""):
                # Parse "module1, module2, module3"
                for mod in output_text.split(","):
                    mod = mod.strip().rstrip(".")
                    if mod:
                        result["output_modules_available"].append(mod)

        # Extract ask() question if present
        ask_match = re.search(
            r"Also, the robot asks:\s*(.+?)(?:\s*\(Context:\s*(.+?)\))?$",
            text,
            re.IGNORECASE | re.MULTILINE
        )
        if ask_match:
            result["ask_question"] = ask_match.group(1).strip()
            result["ask_context"] = ask_match.group(2).strip() if ask_match.group(2) else ""

        return result

    # ------------------------------------------------------------------
    # Shared prompt builder (for LLM providers that need structured context)
    # ------------------------------------------------------------------

    @staticmethod
    def build_prompt(
        robot: Optional[Dict[str, Any]] = None,
        pins: Optional[List[Dict[str, Any]]] = None,
        sensor_data: Optional[Dict[str, Any]] = None,
        recent_episodes: Optional[List[Dict[str, Any]]] = None,
        current_goal: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Build a rich context prompt for the LLM.

        This method is used by LLM providers (GPT-4, Claude, Ollama) that
        receive the natural language prompt from the robot and need additional
        context to make decisions.
        """
        parts: List[str] = []

        # Robot identity
        if robot:
            parts.append(f"You are controlling a {robot.get('type', 'unknown')} robot "
                         f"named {robot.get('name', 'unknown')}.")
            if robot.get("purpose"):
                parts.append(f"Purpose: {robot['purpose']}")
            if robot.get("environment"):
                parts.append(f"Environment: {robot['environment']}")

        # Hardware map with descriptions
        if pins:
            parts.append("\nAvailable hardware:")
            for pin in pins:
                desc = pin.get("description") or "No description"
                parts.append(f"  {pin['pin_name']} (pin {pin['pin_number']}, {pin['mode']}): {desc}")

        # Current sensor readings (from natural language prompt or structured data)
        if sensor_data:
            # If the sensor data contains a raw prompt, pass it through
            raw_prompt = sensor_data.get("_raw_prompt", "")
            if raw_prompt:
                parts.append(f"\n{raw_prompt}")
            else:
                sensors = sensor_data.get("input_sensors_read", {})
                if sensors:
                    parts.append(f"\nCurrently, the input sensors read:")
                    parts.append(f"({_format_sensor_values(sensors)}),")
                available = sensor_data.get("output_modules_available", [])
                if available:
                    parts.append(f"What do you want to do to:")
                    parts.append(f"({', '.join(available)}).")

        # Recent episodes
        if recent_episodes:
            parts.append("\nRecent similar episodes:")
            for i, ep in enumerate(recent_episodes[:5]):
                parts.append(
                    f"  Episode {i+1}: scene={_json_indent(ep.get('scene', {}))}, "
                    f"action={_json_indent(ep.get('action_taken', {}))}, "
                    f"outcome={ep.get('outcome', 'unknown')}"
                )

        # Current goal
        if current_goal:
            parts.append(f"\nCurrent goal: {current_goal.get('description', 'none')}")
            if current_goal.get("reasoning"):
                parts.append(f"Reasoning so far: {current_goal['reasoning']}")

        parts.append(
            "\nRespond with ONLY a JSON object mapping module names to commands. "
            'Example: {"ledpin": {"action": "digitalwrite", "value": 1}, '
            '"urhands": {"action": "servo", "angle": 45}}'
        )

        return "\n".join(parts)

    # ------------------------------------------------------------------
    # Build prompt from the natural language text the ESP32 sends
    # ------------------------------------------------------------------

    @staticmethod
    def build_prompt_from_nl(nl_text: str, robot: Optional[Dict[str, Any]] = None,
                              pins: Optional[List[Dict[str, Any]]] = None,
                              recent_episodes: Optional[List[Dict[str, Any]]] = None,
                              current_goal: Optional[Dict[str, Any]] = None) -> str:
        """Build a complete LLM prompt from the ESP32's natural language message.

        The ESP32 sends: "Currently, the input sensors read: (...), What do you want to do to: (...)."
        We add robot identity, hardware descriptions, and ask the LLM to respond with JSON commands.
        """
        parts: List[str] = []

        # System context
        if robot:
            parts.append(f"You are controlling a {robot.get('type', 'unknown')} robot "
                         f"named {robot.get('name', 'unknown')}.")
            if robot.get("purpose"):
                parts.append(f"Purpose: {robot['purpose']}")
            if robot.get("environment"):
                parts.append(f"Environment: {robot['environment']}")

        # Hardware map with user descriptions
        if pins:
            parts.append("\nAvailable hardware:")
            for pin in pins:
                desc = pin.get("description") or "No description"
                parts.append(f"  {pin['pin_name']} (pin {pin['pin_number']}, {pin['mode']}): {desc}")

        # The actual sensor data prompt from the ESP32
        parts.append(f"\n{nl_text}")

        # Recent episodes for context
        if recent_episodes:
            parts.append("\nRecent similar episodes:")
            for i, ep in enumerate(recent_episodes[:5]):
                parts.append(
                    f"  Episode {i+1}: sensors={_json_indent(ep.get('scene', {}))}, "
                    f"action={_json_indent(ep.get('action_taken', {}))}, "
                    f"outcome={ep.get('outcome', 'unknown')}"
                )

        # Current goal
        if current_goal:
            parts.append(f"\nCurrent goal: {current_goal.get('description', 'none')}")

        parts.append(
            "\nRespond with ONLY a JSON object mapping module names to commands. "
            'Example: {"ledpin": {"action": "digitalwrite", "value": 1}, '
            '"urhands": {"action": "servo", "angle": 45}}'
        )

        return "\n".join(parts)


def _format_sensor_values(sensors: Any) -> str:
    """Format sensor values as a comma-separated string."""
    if isinstance(sensors, dict):
        parts = []
        for k, v in sensors.items():
            if isinstance(v, dict):
                # Nested sensor data
                val = v.get("value", v.get("data", str(v)))
                parts.append(f"{k}: {val}")
            else:
                parts.append(f"{k}: {v}")
        return ", ".join(parts)
    return str(sensors)


def _json_indent(obj: Any) -> str:
    return json.dumps(obj, indent=2)
