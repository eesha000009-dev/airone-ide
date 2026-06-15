"""
Layer 2: Memory Brain — episodic memory + rule learning.

This is the KEY INNOVATION of the Airone system.  No weights, no epochs.
Learning = database operations: INSERT, SELECT, rule generation.

The Memory Brain:
  1. Stores episodes (what the robot saw, what it did, what happened)
  2. Matches current scenes to similar past scenes
  3. Generalizes rules after repeated patterns
  4. Falls back to rules when no episode matches, then escalates to Goal Brain
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from ..storage.episodes import EpisodeStore, Episode
from ..storage.rules import RuleStore, Rule

logger = logging.getLogger(__name__)

# Minimum number of similar episodes with the same outcome to auto-generate a rule
AUTO_RULE_THRESHOLD = 5


class MemoryBrain:
    """Layer 2: Episodic memory and rule-based learning."""

    def __init__(self, episode_store: EpisodeStore, rule_store: RuleStore):
        self._episodes = episode_store
        self._rules = rule_store

    # ------------------------------------------------------------------
    # Main processing entry point
    # ------------------------------------------------------------------

    async def process(
        self,
        robot_id: str,
        scene: Dict[str, Any],
        available_modules: Optional[List[str]] = None,
    ) -> Tuple[Dict[str, Any], str]:
        """Process a scene through the Memory Brain.

        Returns (commands, source) where source indicates where the
        decision came from:
          'memory_exact'  — exact episode match (all succeeded)
          'memory_similar' — similar episodes with mixed outcomes
          'rule'          — matched a stored rule
          'none'          — no match found, escalate to Goal Brain
        """
        # 1. Find similar episodes
        similar = await self._episodes.find_similar(robot_id, scene, limit=5)

        if similar:
            # Check if all similar episodes succeeded with the same action
            success_eps = [ep for ep in similar if ep.outcome == "success"]
            failure_eps = [ep for ep in similar if ep.outcome == "failure"]

            if len(success_eps) >= 3 and len(success_eps) >= len(similar) * 0.6:
                # Strong consensus: repeat the most common successful action
                commands = self._consensus_action(success_eps, available_modules)
                source = "memory_exact"
                logger.info(
                    "[Memory] Robot %s: %d/%d similar episodes succeeded → repeating action",
                    robot_id, len(success_eps), len(similar),
                )
                return commands, source

            if success_eps and failure_eps:
                # Mixed results: use the most successful action but escalate
                commands = self._consensus_action(success_eps, available_modules)
                source = "memory_similar"
                logger.info(
                    "[Memory] Robot %s: mixed results (%d success, %d failure) → suggesting with escalation",
                    robot_id, len(success_eps), len(failure_eps),
                )
                return commands, source

        # 2. No strong episode match — check rules
        matched_rules = await self._rules.match(robot_id, scene)
        if matched_rules:
            # Use the highest-priority rule
            rule = matched_rules[0]
            source = "rule"
            logger.info(
                "[Memory] Robot %s: matched rule '%s' (confidence %.2f)",
                robot_id, rule.name or rule.id, rule.confidence,
            )
            return rule.actions, source

        # 3. No match at all — return empty, caller should escalate to Goal Brain
        logger.info("[Memory] Robot %s: no episode or rule match → escalate to Goal Brain", robot_id)
        return {}, "none"

    # ------------------------------------------------------------------
    # Episode recording
    # ------------------------------------------------------------------

    async def record_episode(
        self,
        robot_id: str,
        scene: Dict[str, Any],
        action_taken: Dict[str, Any],
        outcome: str = "pending",
        notes: str = "",
    ) -> Episode:
        """Record a new episode and check if a rule should be auto-generated."""
        ep = await self._episodes.add(
            robot_id=robot_id,
            scene=scene,
            action_taken=action_taken,
            outcome=outcome,
            notes=notes,
        )
        logger.info("[Memory] Recorded episode %s for robot %s (outcome=%s)", ep.id, robot_id, outcome)

        # Check for auto-rule generation
        if outcome in ("success", "failure"):
            await self._try_auto_generate_rule(robot_id, scene, action_taken, outcome)

        return ep

    async def update_episode_outcome(self, episode_id: str, outcome: str, notes: str = "") -> bool:
        """Update the outcome of a previously recorded episode."""
        return await self._episodes.update_outcome(episode_id, outcome, notes)

    # ------------------------------------------------------------------
    # Rule management
    # ------------------------------------------------------------------

    async def add_rule(
        self,
        robot_id: str,
        conditions: List[Dict[str, Any]],
        actions: Dict[str, Any],
        name: str = "",
        confidence: float = 0.5,
        source: str = "manual",
        priority: int = 0,
    ) -> Rule:
        """Manually add a rule."""
        return await self._rules.add(
            robot_id=robot_id,
            conditions=conditions,
            actions=actions,
            name=name,
            confidence=confidence,
            source=source,
            priority=priority,
        )

    async def get_rules(self, robot_id: str, enabled_only: bool = False) -> List[Rule]:
        return await self._rules.list_by_robot(robot_id, enabled_only=enabled_only)

    async def get_episodes(self, robot_id: str, limit: int = 50) -> List[Episode]:
        return await self._episodes.list_by_robot(robot_id, limit=limit)

    # ------------------------------------------------------------------
    # Auto-rule generation (the "learning" part)
    # ------------------------------------------------------------------

    async def _try_auto_generate_rule(
        self,
        robot_id: str,
        scene: Dict[str, Any],
        action_taken: Dict[str, Any],
        outcome: str,
    ) -> None:
        """After 5 similar episodes with the same outcome, auto-generate a rule.

        This is the core "learning" mechanism: no weights, no epochs,
        just SQL + heuristic generalization.
        """
        similar = await self._episodes.find_similar(robot_id, scene, limit=10)
        same_outcome = [ep for ep in similar if ep.outcome == outcome]

        if len(same_outcome) < AUTO_RULE_THRESHOLD:
            return

        # Check that the actions are consistent across episodes
        action_signatures = set()
        for ep in same_outcome:
            sig = json.dumps(ep.action_taken, sort_keys=True)
            action_signatures.add(sig)

        if len(action_signatures) > 2:
            # Too much variation in actions — not ready for a rule
            return

        # Use the most common action
        from collections import Counter
        sig_counts = Counter(action_signatures)
        best_sig = sig_counts.most_common(1)[0][0]
        best_action = json.loads(best_sig)

        # Generalize conditions from the scenes
        conditions = self._generalize_conditions([ep.scene for ep in same_outcome])

        # Check if a very similar rule already exists
        existing = await self._rules.list_by_robot(robot_id, enabled_only=False)
        for rule in existing:
            if (rule.actions == best_action and
                self._conditions_similar(rule.conditions, conditions)):
                # Update confidence
                ep_ids = list(set(rule.episode_ids + [ep.id for ep in same_outcome]))
                new_conf = min(1.0, 0.5 + len(ep_ids) * 0.05)
                await self._rules.update(
                    rule.id,
                    confidence=new_conf,
                    episode_ids=ep_ids,
                    source=f"auto_generated_from_{len(ep_ids)}_episodes",
                )
                logger.info(
                    "[Memory] Updated existing rule %s (confidence → %.2f) from %d episodes",
                    rule.id, new_conf, len(ep_ids),
                )
                return

        # Create new auto-generated rule
        confidence = 0.5 + len(same_outcome) * 0.05
        ep_ids = [ep.id for ep in same_outcome]
        rule = await self._rules.add(
            robot_id=robot_id,
            conditions=conditions,
            actions=best_action,
            name=f"auto_{outcome}_{scene.get('temperature', 't')}",
            confidence=min(confidence, 0.99),
            source=f"auto_generated_from_{len(same_outcome)}_episodes",
            priority=10,  # auto rules have lower priority than manual
            episode_ids=ep_ids,
        )
        logger.info(
            "[Memory] Auto-generated rule %s from %d episodes (confidence=%.2f): %s",
            rule.id, len(same_outcome), rule.confidence,
            rule.to_human_readable(),
        )

    @staticmethod
    def _generalize_conditions(scenes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Create generalized conditions from a list of similar scenes.

        For numeric fields, generates a range condition (min-max).
        """
        if not scenes:
            return []

        conditions: List[Dict[str, Any]] = []
        # Collect numeric keys that appear in all scenes
        numeric_keys: set = set()
        for scene in scenes:
            for key, val in scene.items():
                if isinstance(val, (int, float)):
                    numeric_keys.add(key)

        common_keys = set(numeric_keys)
        for scene in scenes:
            scene_keys = {k for k, v in scene.items() if isinstance(v, (int, float))}
            common_keys &= scene_keys

        for key in sorted(common_keys):
            values = [float(scene[key]) for scene in scenes]
            min_val = min(values)
            max_val = max(values)

            # Add lower bound
            conditions.append({
                "field": key,
                "op": ">=",
                "value": round(min_val, 1),
            })
            # Add upper bound
            conditions.append({
                "field": key,
                "op": "<=",
                "value": round(max_val, 1),
            })

        return conditions

    @staticmethod
    def _conditions_similar(
        existing: List[Dict[str, Any]],
        new: List[Dict[str, Any]],
        tolerance: float = 0.2,
    ) -> bool:
        """Check if two sets of conditions are roughly similar."""
        if len(existing) != len(new):
            return False
        for e, n in zip(sorted(existing, key=lambda x: x.get("field", "")),
                         sorted(new, key=lambda x: x.get("field", ""))):
            if e.get("field") != n.get("field") or e.get("op") != n.get("op"):
                return False
            ev, nv = e.get("value", 0), n.get("value", 0)
            if isinstance(ev, (int, float)) and isinstance(nv, (int, float)):
                if abs(ev - nv) > max(abs(ev), abs(nv), 1) * tolerance:
                    return False
        return True

    @staticmethod
    def _consensus_action(
        episodes: List[Episode],
        available_modules: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Determine the consensus action from successful episodes.

        For each module, pick the most common action.
        """
        from collections import Counter

        module_actions: Dict[str, Counter] = {}
        for ep in episodes:
            for mod, cmd in ep.action_taken.items():
                if available_modules and mod not in available_modules:
                    continue
                if mod not in module_actions:
                    module_actions[mod] = Counter()
                sig = json.dumps(cmd, sort_keys=True)
                module_actions[mod][sig] += 1

        commands: Dict[str, Any] = {}
        for mod, counter in module_actions.items():
            best_sig = counter.most_common(1)[0][0]
            commands[mod] = json.loads(best_sig)

        return commands
