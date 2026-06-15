"""
Rule storage and matching for the Memory Brain.

Rules are human-readable, editable, and auto-generated from repeated
episodic patterns.  Stored in SQLite as structured records.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import aiosqlite

# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

_RULES_SCHEMA = """
CREATE TABLE IF NOT EXISTS rules (
    id            TEXT PRIMARY KEY,
    robot_id      TEXT NOT NULL,
    name          TEXT DEFAULT '',
    conditions    TEXT NOT NULL,       -- JSON: list of {field, op, value}
    actions       TEXT NOT NULL,       -- JSON: dict of module -> {action, value/angle}
    confidence    REAL DEFAULT 0.5,
    source        TEXT DEFAULT 'manual',  -- 'manual' | 'auto_generated_from_N_episodes'
    priority      INTEGER DEFAULT 0,   -- higher = checked first
    enabled       INTEGER DEFAULT 1,
    episode_ids   TEXT DEFAULT '[]',   -- JSON list of episode IDs that generated this rule
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rules_robot_id  ON rules(robot_id);
CREATE INDEX IF NOT EXISTS idx_rules_enabled    ON rules(enabled);
CREATE INDEX IF NOT EXISTS idx_rules_priority   ON rules(priority DESC);
"""

# ---------------------------------------------------------------------------
# Rule helper
# ---------------------------------------------------------------------------

class Rule:
    """Immutable representation of a single rule."""

    __slots__ = ("id", "robot_id", "name", "conditions", "actions",
                 "confidence", "source", "priority", "enabled",
                 "episode_ids", "created_at", "updated_at")

    def __init__(
        self,
        id: str,
        robot_id: str,
        name: str,
        conditions: List[Dict[str, Any]],
        actions: Dict[str, Any],
        confidence: float = 0.5,
        source: str = "manual",
        priority: int = 0,
        enabled: bool = True,
        episode_ids: Optional[List[str]] = None,
        created_at: Optional[str] = None,
        updated_at: Optional[str] = None,
    ):
        self.id = id
        self.robot_id = robot_id
        self.name = name
        self.conditions = conditions
        self.actions = actions
        self.confidence = confidence
        self.source = source
        self.priority = priority
        self.enabled = enabled
        self.episode_ids = episode_ids or []
        self.created_at = created_at or datetime.now(timezone.utc).isoformat()
        self.updated_at = updated_at or datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "robot_id": self.robot_id,
            "name": self.name,
            "conditions": self.conditions,
            "actions": self.actions,
            "confidence": self.confidence,
            "source": self.source,
            "priority": self.priority,
            "enabled": self.enabled,
            "episode_ids": self.episode_ids,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    def to_human_readable(self) -> str:
        """Return a human-readable representation of this rule."""
        cond_parts = []
        for c in self.conditions:
            cond_parts.append(f"{c['field']} {c['op']} {c['value']}")
        cond_str = " AND ".join(cond_parts) if cond_parts else "true"

        act_parts = []
        for mod, cmd in self.actions.items():
            if "angle" in cmd:
                act_parts.append(f"{mod} = {cmd['action']}({cmd['angle']})")
            else:
                act_parts.append(f"{mod} = {cmd['action']}({cmd.get('value', '')})")
        act_str = ", ".join(act_parts) if act_parts else "no-op"

        return (
            f"IF {cond_str}\n"
            f"THEN {act_str}\n"
            f"CONFIDENCE: {self.confidence:.2f}\n"
            f"SOURCE: {self.source}"
        )

    @classmethod
    def from_row(cls, row: Dict[str, Any]) -> "Rule":
        return cls(
            id=row["id"],
            robot_id=row["robot_id"],
            name=row["name"] or "",
            conditions=json.loads(row["conditions"]) if isinstance(row["conditions"], str) else row["conditions"],
            actions=json.loads(row["actions"]) if isinstance(row["actions"], str) else row["actions"],
            confidence=row["confidence"],
            source=row["source"],
            priority=row["priority"],
            enabled=bool(row["enabled"]),
            episode_ids=json.loads(row["episode_ids"]) if isinstance(row["episode_ids"], str) else (row["episode_ids"] or []),
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
        )


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------

class RuleStore:
    """Async SQLite-backed rule storage."""

    def __init__(self, db_path: str = "brain_server.db"):
        self._db_path = db_path
        self._db: Optional[aiosqlite.Connection] = None

    # -- lifecycle --

    async def init(self) -> None:
        self._db = await aiosqlite.connect(self._db_path)
        self._db.row_factory = aiosqlite.Row
        await self._db.executescript(_RULES_SCHEMA)
        await self._db.commit()

    async def close(self) -> None:
        if self._db:
            await self._db.close()
            self._db = None

    # -- CRUD --

    async def add(
        self,
        robot_id: str,
        conditions: List[Dict[str, Any]],
        actions: Dict[str, Any],
        name: str = "",
        confidence: float = 0.5,
        source: str = "manual",
        priority: int = 0,
        episode_ids: Optional[List[str]] = None,
        rule_id: Optional[str] = None,
    ) -> Rule:
        rule = Rule(
            id=rule_id or f"rule_{uuid.uuid4().hex[:12]}",
            robot_id=robot_id,
            name=name,
            conditions=conditions,
            actions=actions,
            confidence=confidence,
            source=source,
            priority=priority,
            episode_ids=episode_ids or [],
        )
        assert self._db is not None
        await self._db.execute(
            """
            INSERT INTO rules (id, robot_id, name, conditions, actions,
                               confidence, source, priority, enabled, episode_ids)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
            """,
            (rule.id, rule.robot_id, rule.name,
             json.dumps(rule.conditions), json.dumps(rule.actions),
             rule.confidence, rule.source, rule.priority,
             json.dumps(rule.episode_ids)),
        )
        await self._db.commit()
        return rule

    async def get(self, rule_id: str) -> Optional[Rule]:
        assert self._db is not None
        cur = await self._db.execute("SELECT * FROM rules WHERE id = ?", (rule_id,))
        row = await cur.fetchone()
        if row is None:
            return None
        return Rule.from_row(dict(row))

    async def list_by_robot(self, robot_id: str, enabled_only: bool = False) -> List[Rule]:
        assert self._db is not None
        if enabled_only:
            cur = await self._db.execute(
                "SELECT * FROM rules WHERE robot_id = ? AND enabled = 1 ORDER BY priority DESC",
                (robot_id,),
            )
        else:
            cur = await self._db.execute(
                "SELECT * FROM rules WHERE robot_id = ? ORDER BY priority DESC",
                (robot_id,),
            )
        rows = await cur.fetchall()
        return [Rule.from_row(dict(r)) for r in rows]

    async def update(self, rule_id: str, **kwargs: Any) -> bool:
        """Update arbitrary fields on a rule."""
        assert self._db is not None
        allowed = {"name", "conditions", "actions", "confidence", "source",
                    "priority", "enabled", "episode_ids"}
        sets: List[str] = []
        vals: List[Any] = []
        for key, val in kwargs.items():
            if key in allowed:
                if key in ("conditions", "actions", "episode_ids"):
                    val = json.dumps(val)
                sets.append(f"{key} = ?")
                vals.append(val)
        if not sets:
            return False
        sets.append("updated_at = datetime('now')")
        vals.append(rule_id)
        await self._db.execute(
            f"UPDATE rules SET {', '.join(sets)} WHERE id = ?", vals
        )
        await self._db.commit()
        return True

    async def delete(self, rule_id: str) -> bool:
        assert self._db is not None
        await self._db.execute("DELETE FROM rules WHERE id = ?", (rule_id,))
        await self._db.commit()
        return True

    # -- matching --

    async def match(self, robot_id: str, scene: Dict[str, Any]) -> List[Rule]:
        """Return all enabled rules whose conditions match the current scene.

        Conditions are evaluated as:  field <op> value
        Supported ops: >, <, >=, <=, ==, !=
        """
        rules = await self.list_by_robot(robot_id, enabled_only=True)
        matched: List[Rule] = []
        for rule in rules:
            if self._conditions_match(rule.conditions, scene):
                matched.append(rule)
        return matched

    @staticmethod
    def _conditions_match(conditions: List[Dict[str, Any]], scene: Dict[str, Any]) -> bool:
        """Evaluate all conditions against a scene dict."""
        for cond in conditions:
            field = cond.get("field", "")
            op = cond.get("op", "==")
            threshold = cond.get("value", 0)
            actual = scene.get(field)
            if actual is None:
                return False  # field not present in scene → condition fails
            try:
                actual_num = float(actual)
                threshold_num = float(threshold)
            except (ValueError, TypeError):
                # Fall back to string comparison
                actual_num = actual
                threshold_num = threshold
            if op == ">" and not (actual_num > threshold_num):
                return False
            elif op == "<" and not (actual_num < threshold_num):
                return False
            elif op == ">=" and not (actual_num >= threshold_num):
                return False
            elif op == "<=" and not (actual_num <= threshold_num):
                return False
            elif op == "==" and not (actual_num == threshold_num):
                return False
            elif op == "!=" and not (actual_num != threshold_num):
                return False
        return True
