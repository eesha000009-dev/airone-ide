"""
Triune Brain Orchestrator — coordinates the three brain layers.

Processing order:
  1. Reflex Brain: check for safety violations → can override everything
  2. Memory Brain: match scene to episodes / rules → fast, no LLM
  3. Goal Brain: LLM-based reasoning → only when Memory can't decide

The orchestrator ensures:
  - Reflex always wins (safety first)
  - Memory is consulted before Goal (cheaper, faster)
  - Goal Brain is the fallback for novel situations
  - Every decision is recorded as an episode for future learning
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .reflex import ReflexBrain, ReflexResult
from .memory import MemoryBrain
from .goal import GoalBrain
from ..storage.episodes import EpisodeStore, Episode
from ..storage.rules import RuleStore
from ..storage.goals import GoalStore, Goal

logger = logging.getLogger(__name__)


@dataclass
class BrainResponse:
    """The final response from the Triune Brain to a robot."""
    command_id: str = ""
    timestamp: int = 0
    output_commands: Dict[str, Any] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)
    reflex_triggered: bool = False
    reflex_messages: List[str] = field(default_factory=list)
    decision_source: str = ""  # 'reflex', 'memory_exact', 'memory_similar', 'rule', 'goal', 'none'
    episode_id: str = ""


class TriuneBrain:
    """The Triune Brain orchestrator.

    Coordinates the three layers:
      Layer 1 (Reflex)  — deterministic safety, always checked first
      Layer 2 (Memory)  — episodic + rule-based, no LLM
      Layer 3 (Goal)    — LLM-based reasoning for novel situations
    """

    def __init__(self, db_path: str = "brain_server.db"):
        self._db_path = db_path

        # Storage
        self._episode_store = EpisodeStore(db_path)
        self._rule_store = RuleStore(db_path)
        self._goal_store = GoalStore(db_path)

        # Brain layers
        self.reflex = ReflexBrain()
        self.memory = MemoryBrain(self._episode_store, self._rule_store)
        self.goal = GoalBrain(self._goal_store)

        # Internal state
        self._command_counter = 0
        self._robot_info: Dict[str, Dict[str, Any]] = {}  # robot_id -> robot config
        self._robot_pins: Dict[str, List[Dict[str, Any]]] = {}  # robot_id -> pin list

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def init(self) -> None:
        """Initialize all storage layers."""
        await self._episode_store.init()
        await self._rule_store.init()
        await self._goal_store.init()
        logger.info("[TriuneBrain] Initialized (db=%s)", self._db_path)

    async def close(self) -> None:
        """Close all storage layers."""
        await self._episode_store.close()
        await self._rule_store.close()
        await self._goal_store.close()
        logger.info("[TriuneBrain] Closed")

    # ------------------------------------------------------------------
    # Robot registration
    # ------------------------------------------------------------------

    def register_robot(self, robot_id: str, info: Optional[Dict[str, Any]] = None) -> None:
        """Register a robot with its identity information."""
        self._robot_info[robot_id] = info or {}

    def register_pins(self, robot_id: str, pins: List[Dict[str, Any]]) -> None:
        """Register pin definitions for a robot."""
        self._robot_pins[robot_id] = pins

    def get_robot_info(self, robot_id: str) -> Dict[str, Any]:
        return self._robot_info.get(robot_id, {})

    def get_robot_pins(self, robot_id: str) -> List[Dict[str, Any]]:
        return self._robot_pins.get(robot_id, [])

    # ------------------------------------------------------------------
    # Main processing loop
    # ------------------------------------------------------------------

    async def process(self, robot_id: str, data: Dict[str, Any]) -> BrainResponse:
        """Process incoming sensor data through the Triune Brain.

        This is the main entry point called by the WebSocket server.

        Handles two formats:
          - Natural Language Prompt (from ESP32 senddatato):
            "Currently, the input sensors read: (...), What do you want to do to: (...)."
          - JSON (legacy/structured)

        Flow:
          1. Extract scene from sensor data (parse NL prompt if needed)
          2. Run Reflex Brain checks
          3. If no reflex override, run Memory Brain
          4. If Memory can't decide, run Goal Brain
          5. Apply reflex overrides to final commands
          6. Record the episode
        """
        start_time = time.time()
        self._command_counter += 1

        # Extract sensor data (handles both JSON and natural language formats)
        sensors = data.get("input_sensors_read", {})
        available = data.get("output_modules_available", [])

        # If this came from a natural language prompt, store the raw prompt
        raw_prompt = data.get("_raw_prompt", "")

        # Scene is the sensor snapshot for episode matching
        scene = dict(sensors)

        response = BrainResponse(
            command_id=f"cmd_{self._command_counter}",
            timestamp=int(time.time() * 1000),
        )

        # ---- Layer 1: Reflex Brain ----
        reflex_result = self.reflex.check(robot_id, scene)
        response.reflex_triggered = reflex_result.triggered
        response.reflex_messages = reflex_result.messages

        if reflex_result.emergency:
            # Emergency reflex overrides everything — send immediately
            response.output_commands = self.reflex.apply_overrides({}, reflex_result)
            response.decision_source = "reflex"
            response.metadata = {
                "confidence": 1.0,
                "reasoning": " | ".join(reflex_result.messages),
                "emergency": True,
            }
            # Record the episode with reflex outcome
            ep = await self.memory.record_episode(
                robot_id=robot_id, scene=scene,
                action_taken=response.output_commands,
                outcome="reflex_override",
                notes="; ".join(reflex_result.messages),
            )
            response.episode_id = ep.id
            elapsed = time.time() - start_time
            logger.info("[TriuneBrain] Robot %s: REFLEX override in %.3fms", robot_id, elapsed * 1000)
            return response

        # ---- Layer 2: Memory Brain ----
        commands, source = await self.memory.process(robot_id, scene, available)
        response.decision_source = source

        if source != "none" and commands:
            # Memory Brain found a match
            # Apply reflex overrides (non-emergency)
            commands = self.reflex.apply_overrides(commands, reflex_result)
            response.output_commands = commands
            response.metadata = {
                "confidence": 0.85 if source.startswith("memory") else 0.75,
                "reasoning": f"Decision from {source}",
                "reflex_overrides": reflex_result.messages if reflex_result.triggered else [],
            }

            # Record episode
            ep = await self.memory.record_episode(
                robot_id=robot_id, scene=scene,
                action_taken=commands,
                outcome="pending",
                notes=f"Source: {source}",
            )
            response.episode_id = ep.id

            elapsed = time.time() - start_time
            logger.info(
                "[TriuneBrain] Robot %s: %s decision in %.3fms (%d commands)",
                robot_id, source, elapsed * 1000, len(commands),
            )
            return response

        # ---- Layer 3: Goal Brain ----
        # Memory couldn't decide — use LLM or rule-based fallback
        goal = await self.goal.get_active_goal(robot_id)

        robot_info = self._robot_info.get(robot_id)
        pins = self._robot_pins.get(robot_id, [])

        # Get recent episodes for LLM context
        recent_eps = await self.memory.get_episodes(robot_id, limit=5)
        recent_dicts = [ep.to_dict() for ep in recent_eps]

        llm_response = await self.goal.process_goal(
            robot_id=robot_id,
            goal=goal or Goal(
                id="ad_hoc",
                robot_id=robot_id,
                description="Respond to current sensor state",
            ),
            sensor_data=data,
            robot=robot_info,
            pins=pins,
            recent_episodes=recent_dicts,
        )

        commands = llm_response.commands
        source = "goal"

        # Apply reflex overrides
        commands = self.reflex.apply_overrides(commands, reflex_result)
        response.output_commands = commands
        response.decision_source = source
        response.metadata = {
            "confidence": llm_response.confidence,
            "reasoning": llm_response.reasoning,
            "model": llm_response.model,
            "reflex_overrides": reflex_result.messages if reflex_result.triggered else [],
        }

        # Record episode
        ep = await self.memory.record_episode(
            robot_id=robot_id, scene=scene,
            action_taken=commands,
            outcome="pending",
            notes=f"Source: {source}, Model: {llm_response.model}",
        )
        response.episode_id = ep.id

        elapsed = time.time() - start_time
        logger.info(
            "[TriuneBrain] Robot %s: %s decision via %s in %.3fms (%d commands)",
            robot_id, source, llm_response.model, elapsed * 1000, len(commands),
        )
        return response

    # ------------------------------------------------------------------
    # Emergency stop
    # ------------------------------------------------------------------

    def emergency_stop(self, robot_id: Optional[str] = None) -> Dict[str, Any]:
        """Activate emergency stop for one or all robots."""
        if robot_id:
            self.reflex.emergency_stop(robot_id)
            return {"success": True, "robot_id": robot_id, "action": "emergency_stop"}
        else:
            self.reflex.emergency_stop(None)
            # Stop all known robots
            stopped = list(self._robot_info.keys())
            for rid in stopped:
                self.reflex.emergency_stop(rid)
            return {"success": True, "robot_id": "ALL", "stopped_robots": stopped}

    def release_emergency_stop(self, robot_id: str) -> Dict[str, Any]:
        """Release emergency stop for a robot."""
        self.reflex.release_emergency_stop(robot_id)
        return {"success": True, "robot_id": robot_id, "action": "emergency_release"}

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------

    def get_status(self) -> Dict[str, Any]:
        """Get the current status of the Triune Brain."""
        return {
            "command_counter": self._command_counter,
            "registered_robots": list(self._robot_info.keys()),
            "active_provider": self.goal.get_active_provider(),
            "reflex_conditions": self.reflex.list_conditions(),
            "emergency_stopped": list(self.reflex._emergency_stopped),
        }
