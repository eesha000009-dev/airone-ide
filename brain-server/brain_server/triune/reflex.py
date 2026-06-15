"""
Layer 1: Reflex Brain — deterministic, server-side safety checks.

These are NOT the firmware-level safety checks (those are compiled into the
robot and cannot be disabled).  These are server-side checks that supplement
the firmware safety and can be updated without reflashing.

All reflex checks are deterministic: given the same sensor input, they always
produce the same output.  They execute before any other brain layer and can
override commands from higher layers.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class ReflexCondition:
    """A single reflex safety condition."""
    name: str
    field: str           # sensor field to check
    op: str              # comparison operator: >, <, >=, <=, ==, !=
    threshold: float     # threshold value
    action: str          # 'all_off', 'return_to_charge', 'stop_actuators', 'custom'
    override_commands: Optional[Dict[str, Any]] = None
    message: str = ""

    def evaluate(self, scene: Dict[str, Any]) -> bool:
        value = scene.get(self.field)
        if value is None:
            return False
        try:
            val = float(value)
        except (ValueError, TypeError):
            return False
        ops = {
            ">": val > self.threshold,
            "<": val < self.threshold,
            ">=": val >= self.threshold,
            "<=": val <= self.threshold,
            "==": val == self.threshold,
            "!=": val != self.threshold,
        }
        return ops.get(self.op, False)


@dataclass
class ReflexResult:
    """Result of a reflex check pass."""
    triggered: bool = False
    overrides: Dict[str, Any] = field(default_factory=dict)
    messages: List[str] = field(default_factory=list)
    emergency: bool = False  # True if emergency stop triggered


class ReflexBrain:
    """Layer 1: Safety reflexes that override all other brain decisions.

    These checks are server-side, deterministic, and cannot be bypassed
    by the Memory or Goal layers.  They are however *configurable* —
    new conditions can be added without reflashing robot firmware.
    """

    def __init__(self):
        self._conditions: List[ReflexCondition] = []
        self._emergency_stopped: set = set()  # robot_ids under emergency stop
        self._load_default_conditions()

    # -- Default safety conditions --

    def _load_default_conditions(self) -> None:
        """Load the built-in safety reflex conditions."""
        defaults = [
            ReflexCondition(
                name="thermal_shutdown",
                field="temperature",
                op=">",
                threshold=60.0,
                action="all_off",
                override_commands={"_emergency_stop": {"action": "halt", "value": 1}},
                message="CRITICAL: Temperature > 60°C — forcing all outputs OFF",
            ),
            ReflexCondition(
                name="thermal_warning",
                field="temperature",
                op=">",
                threshold=45.0,
                action="stop_actuators",
                message="WARNING: Temperature > 45°C — stopping actuators",
            ),
            ReflexCondition(
                name="proximity_emergency",
                field="ultrasonic",
                op="<",
                threshold=20.0,
                action="all_off",
                override_commands={"_emergency_stop": {"action": "halt", "value": 1}},
                message="CRITICAL: Human proximity < 20cm — forcing all actuators OFF",
            ),
            ReflexCondition(
                name="proximity_caution",
                field="ultrasonic",
                op="<",
                threshold=40.0,
                action="stop_actuators",
                message="CAUTION: Object proximity < 40cm — stopping actuators",
            ),
            ReflexCondition(
                name="battery_critical",
                field="battery",
                op="<",
                threshold=10.0,
                action="return_to_charge",
                message="CRITICAL: Battery < 10% — forcing return to charging station",
            ),
            ReflexCondition(
                name="battery_low",
                field="battery",
                op="<",
                threshold=20.0,
                action="stop_actuators",
                message="WARNING: Battery < 20% — stopping non-essential actuators",
            ),
        ]
        self._conditions = defaults

    # -- Public API --

    def add_condition(self, condition: ReflexCondition) -> None:
        """Add a new reflex condition (server-side, no firmware flash needed)."""
        self._conditions.append(condition)
        logger.info("Reflex condition added: %s", condition.name)

    def remove_condition(self, name: str) -> bool:
        """Remove a reflex condition by name."""
        before = len(self._conditions)
        self._conditions = [c for c in self._conditions if c.name != name]
        return len(self._conditions) < before

    def list_conditions(self) -> List[Dict[str, Any]]:
        """Return all current reflex conditions."""
        return [
            {
                "name": c.name,
                "field": c.field,
                "op": c.op,
                "threshold": c.threshold,
                "action": c.action,
                "message": c.message,
            }
            for c in self._conditions
        ]

    def check(self, robot_id: str, scene: Dict[str, Any]) -> ReflexResult:
        """Run all reflex checks for a given robot's sensor scene.

        Returns a ReflexResult with any overrides that MUST be applied
        before the commands are sent to the robot.
        """
        result = ReflexResult()

        # Emergency stop takes absolute priority
        if robot_id in self._emergency_stopped:
            result.triggered = True
            result.emergency = True
            result.overrides = {"_emergency_stop": {"action": "halt", "value": 1}}
            result.messages.append(f"Emergency stop active for robot {robot_id}")
            return result

        for cond in self._conditions:
            if cond.evaluate(scene):
                result.triggered = True
                msg = cond.message or f"Reflex '{cond.name}' triggered"
                result.messages.append(msg)
                logger.warning("[Reflex] %s (robot=%s)", msg, robot_id)

                if cond.action == "all_off":
                    result.emergency = True
                    result.overrides = cond.override_commands or {
                        "_emergency_stop": {"action": "halt", "value": 1}
                    }
                    # All-off trumps everything — return immediately
                    return result

                if cond.action == "return_to_charge":
                    result.overrides["_return_to_charge"] = {"action": "navigate", "target": "charging_station"}
                    # Continue checking — there might be an all_off too

                if cond.action == "stop_actuators":
                    # We mark actuators for override but don't return yet
                    if "_emergency_stop" not in result.overrides:
                        result.overrides["_actuator_stop"] = {"action": "halt_actuators", "value": 1}

        return result

    def apply_overrides(
        self,
        commands: Dict[str, Any],
        reflex_result: ReflexResult,
    ) -> Dict[str, Any]:
        """Apply reflex overrides to the commands that higher brain layers produced.

        Reflex layer wins unconditionally.
        """
        if not reflex_result.triggered:
            return commands

        if reflex_result.emergency:
            # Emergency stop: clear ALL commands, add the emergency stop signal
            return dict(reflex_result.overrides)

        # Non-emergency overrides: merge, reflex wins for any conflicting keys
        merged = dict(commands)
        for key, value in reflex_result.overrides.items():
            merged[key] = value

        return merged

    # -- Emergency stop management --

    def emergency_stop(self, robot_id: Optional[str] = None) -> None:
        """Activate emergency stop for a robot (or all robots)."""
        if robot_id:
            self._emergency_stopped.add(robot_id)
            logger.critical("[Reflex] EMERGENCY STOP activated for robot %s", robot_id)
        else:
            # When called with None, the caller should handle stopping all
            logger.critical("[Reflex] EMERGENCY STOP requested for ALL robots")

    def release_emergency_stop(self, robot_id: str) -> None:
        """Release emergency stop for a specific robot."""
        self._emergency_stopped.discard(robot_id)
        logger.info("[Reflex] Emergency stop released for robot %s", robot_id)

    def is_emergency_stopped(self, robot_id: str) -> bool:
        return robot_id in self._emergency_stopped
