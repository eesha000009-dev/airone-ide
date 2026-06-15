"""
Layer 3: Goal Brain — high-level planning with LLM integration.

The Goal Brain:
  - Receives high-level goals from the user in plain English
  - Breaks goals into sub-goals
  - Uses LLMs (GPT-4, Claude, local LLaMA) for reasoning
  - Sends sub-goal commands to the Memory Layer
  - Tracks goal progress and completion
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from ..storage.goals import GoalStore, Goal
from ..llm.base import BaseLLMProvider, LLMResponse
from ..llm.rule_engine import RuleEngineProvider
from ..llm.openai_provider import OpenAIProvider
from ..llm.claude_provider import ClaudeProvider
from ..llm.ollama_provider import OllamaProvider

logger = logging.getLogger(__name__)


class GoalBrain:
    """Layer 3: Goal processing and LLM integration."""

    def __init__(self, goal_store: GoalStore):
        self._goals = goal_store
        self._providers: Dict[str, BaseLLMProvider] = {}
        self._active_provider: str = "rule-based"
        self._register_default_providers()

    def _register_default_providers(self) -> None:
        self._providers["rule-based"] = RuleEngineProvider()
        self._providers["openai"] = OpenAIProvider()
        self._providers["claude"] = ClaudeProvider()
        self._providers["ollama"] = OllamaProvider()

    # ------------------------------------------------------------------
    # Provider management
    # ------------------------------------------------------------------

    def set_provider(self, name: str, provider: BaseLLMProvider) -> None:
        """Register or replace an LLM provider."""
        self._providers[name] = provider
        logger.info("[Goal] Registered provider: %s", name)

    def set_active_provider(self, name: str) -> bool:
        """Set the currently active LLM provider."""
        if name in self._providers:
            self._active_provider = name
            logger.info("[Goal] Active provider set to: %s", name)
            return True
        logger.warning("[Goal] Unknown provider: %s", name)
        return False

    def get_active_provider(self) -> str:
        return self._active_provider

    def list_providers(self) -> List[Dict[str, Any]]:
        """Return info about all registered providers."""
        result = []
        for name, provider in self._providers.items():
            result.append({
                "name": name,
                "provider_name": provider.provider_name,
                "active": name == self._active_provider,
                "has_api_key": bool(provider.api_key),
                "endpoint": provider.endpoint,
            })
        return result

    def configure_provider(self, name: str, api_key: Optional[str] = None,
                           endpoint: Optional[str] = None, model: Optional[str] = None) -> bool:
        """Configure a provider's credentials / endpoint."""
        if name not in self._providers:
            return False
        provider = self._providers[name]
        if api_key is not None:
            provider.api_key = api_key
            # Reset client so it re-initializes with new key
            if hasattr(provider, '_client'):
                provider._client = None
        if endpoint is not None:
            provider.endpoint = endpoint
        if model is not None and hasattr(provider, 'model'):
            provider.model = model
        logger.info("[Goal] Configured provider %s", name)
        return True

    async def test_provider(self, name: str) -> Dict[str, Any]:
        """Test connectivity to a provider."""
        provider = self._providers.get(name)
        if not provider:
            return {"success": False, "error": f"Unknown provider: {name}"}
        return await provider.test_connection()

    # ------------------------------------------------------------------
    # Goal management
    # ------------------------------------------------------------------

    async def create_goal(
        self,
        robot_id: str,
        description: str,
        priority: int = 0,
        parent_goal: Optional[str] = None,
    ) -> Goal:
        """Create a new goal for a robot.

        If the goal requires LLM decomposition, this will be done
        lazily when the goal is activated.
        """
        goal = await self._goals.add(
            robot_id=robot_id,
            description=description,
            priority=priority,
            parent_goal=parent_goal,
        )
        logger.info("[Goal] Created goal %s for robot %s: %s", goal.id, robot_id, description)
        return goal

    async def get_active_goal(self, robot_id: str) -> Optional[Goal]:
        return await self._goals.get_active(robot_id)

    async def list_goals(self, robot_id: str, status: Optional[str] = None) -> List[Goal]:
        return await self._goals.list_by_robot(robot_id, status=status)

    async def update_goal_status(self, goal_id: str, status: str, reasoning: str = "") -> bool:
        return await self._goals.update_status(goal_id, status, reasoning=reasoning)

    # ------------------------------------------------------------------
    # Goal processing via LLM
    # ------------------------------------------------------------------

    async def process_goal(
        self,
        robot_id: str,
        goal: Goal,
        sensor_data: Dict[str, Any],
        robot: Optional[Dict[str, Any]] = None,
        pins: Optional[List[Dict[str, Any]]] = None,
        recent_episodes: Optional[List[Dict[str, Any]]] = None,
    ) -> LLMResponse:
        """Process a goal through the active LLM provider.

        The prompt to the LLM includes:
          - The natural language prompt from the ESP32 (if available):
            "Currently, the input sensors read: (...), What do you want to do to: (...)."
          - Robot identity (name, type, purpose, environment)
          - Hardware map (pin names, descriptions)
          - Recent episodes
          - Current goal
        """
        provider = self._providers.get(self._active_provider)
        if provider is None:
            provider = self._providers["rule-based"]

        # Special handling for rule-based (works on structured data, not text)
        if isinstance(provider, RuleEngineProvider):
            return await provider.process_sensors(
                sensor_data=sensor_data,
                available_modules=sensor_data.get("output_modules_available", []),
                pins=pins,
            )

        # Build prompt — use the natural language prompt from the ESP32 if available
        raw_prompt = sensor_data.get("_raw_prompt", "")
        if raw_prompt:
            # The ESP32 sent a natural language prompt — use it directly
            prompt = BaseLLMProvider.build_prompt_from_nl(
                nl_text=raw_prompt,
                robot=robot,
                pins=pins,
                recent_episodes=recent_episodes,
                current_goal=goal.to_dict(),
            )
        else:
            # Fallback: build structured prompt from sensor data
            prompt = BaseLLMProvider.build_prompt(
                robot=robot,
                pins=pins,
                sensor_data=sensor_data,
                recent_episodes=recent_episodes,
                current_goal=goal.to_dict(),
            )

        # Mark goal as in progress
        if goal.status == "pending":
            await self._goals.update_status(goal.id, "in_progress")

        llm_response = await provider.generate(prompt)

        # Update goal with LLM reasoning
        if llm_response.reasoning:
            await self._goals.update_status(goal.id, "in_progress", reasoning=llm_response.reasoning)

        return llm_response

    async def decompose_goal(
        self,
        goal: Goal,
        robot: Optional[Dict[str, Any]] = None,
        pins: Optional[List[Dict[str, Any]]] = None,
    ) -> List[Goal]:
        """Use the LLM to break a high-level goal into sub-goals."""
        provider = self._providers.get(self._active_provider)
        if provider is None or isinstance(provider, RuleEngineProvider):
            # Can't decompose with rule engine — return the goal as-is
            return [goal]

        prompt = (
            f"Break this robot goal into sub-goals. "
            f"Robot: {robot.get('name', 'unknown') if robot else 'unknown'}. "
            f"Goal: {goal.description}. "
            f"Respond with a JSON array of sub-goal descriptions. "
            f'Example: ["Turn towards the red object", "Move arm to reach it", "Close gripper"]'
        )

        llm_response = await provider.generate(prompt, system_prompt=(
            "You are a robot planning AI. Break goals into 2-5 actionable sub-goals. "
            "Respond with ONLY a JSON array of strings."
        ))

        # Parse sub-goals from response
        sub_goal_descriptions = self._parse_sub_goals(llm_response.raw_response)

        sub_goals: List[Goal] = []
        for i, desc in enumerate(sub_goal_descriptions):
            sg = await self._goals.add(
                robot_id=goal.robot_id,
                description=desc,
                priority=goal.priority - (i + 1),  # lower priority than parent
                parent_goal=goal.id,
            )
            await self._goals.add_sub_goal(goal.id, sg.id)
            sub_goals.append(sg)

        if sub_goals:
            logger.info("[Goal] Decomposed goal %s into %d sub-goals", goal.id, len(sub_goals))

        return sub_goals

    @staticmethod
    def _parse_sub_goals(text: str) -> List[str]:
        """Parse a JSON array of sub-goal descriptions from LLM output."""
        import re
        try:
            result = json.loads(text)
            if isinstance(result, list):
                return [str(item) for item in result if isinstance(item, (str, int, float))]
        except json.JSONDecodeError:
            pass
        # Try to find a JSON array in the text
        match = re.search(r"\[[\s\S]*?\]", text)
        if match:
            try:
                result = json.loads(match.group())
                if isinstance(result, list):
                    return [str(item) for item in result if isinstance(item, (str, int, float))]
            except json.JSONDecodeError:
                pass
        # Fall back to splitting by newlines
        lines = [line.strip().lstrip("0123456789.-) ") for line in text.strip().split("\n") if line.strip()]
        return lines
