"""
Goal tracking for the Goal Brain layer.

Goals are high-level human intentions ("Pick up the red object") that are
decomposed into sub-goals and tracked through completion.
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

_GOALS_SCHEMA = """
CREATE TABLE IF NOT EXISTS goals (
    id            TEXT PRIMARY KEY,
    robot_id      TEXT NOT NULL,
    description   TEXT NOT NULL,          -- Human-readable goal text
    status        TEXT DEFAULT 'pending', -- pending | in_progress | completed | failed | cancelled
    priority      INTEGER DEFAULT 0,
    parent_goal   TEXT,                   -- NULL for top-level, ID for sub-goals
    sub_goals     TEXT DEFAULT '[]',      -- JSON list of sub-goal IDs
    commands      TEXT DEFAULT '[]',      -- JSON list of command dicts to execute
    reasoning     TEXT DEFAULT '',        -- LLM reasoning text
    confidence    REAL DEFAULT 0.0,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now')),
    completed_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_goals_robot_id ON goals(robot_id);
CREATE INDEX IF NOT EXISTS idx_goals_status    ON goals(status);
CREATE INDEX IF NOT EXISTS idx_goals_parent    ON goals(parent_goal);
"""

# ---------------------------------------------------------------------------
# Goal helper
# ---------------------------------------------------------------------------

class Goal:
    """Immutable representation of a goal."""

    __slots__ = ("id", "robot_id", "description", "status", "priority",
                 "parent_goal", "sub_goals", "commands", "reasoning",
                 "confidence", "created_at", "updated_at", "completed_at")

    def __init__(
        self,
        id: str,
        robot_id: str,
        description: str,
        status: str = "pending",
        priority: int = 0,
        parent_goal: Optional[str] = None,
        sub_goals: Optional[List[str]] = None,
        commands: Optional[List[Dict[str, Any]]] = None,
        reasoning: str = "",
        confidence: float = 0.0,
        created_at: Optional[str] = None,
        updated_at: Optional[str] = None,
        completed_at: Optional[str] = None,
    ):
        self.id = id
        self.robot_id = robot_id
        self.description = description
        self.status = status
        self.priority = priority
        self.parent_goal = parent_goal
        self.sub_goals = sub_goals or []
        self.commands = commands or []
        self.reasoning = reasoning
        self.confidence = confidence
        self.created_at = created_at or datetime.now(timezone.utc).isoformat()
        self.updated_at = updated_at or datetime.now(timezone.utc).isoformat()
        self.completed_at = completed_at

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "robot_id": self.robot_id,
            "description": self.description,
            "status": self.status,
            "priority": self.priority,
            "parent_goal": self.parent_goal,
            "sub_goals": self.sub_goals,
            "commands": self.commands,
            "reasoning": self.reasoning,
            "confidence": self.confidence,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "completed_at": self.completed_at,
        }

    @classmethod
    def from_row(cls, row: Dict[str, Any]) -> "Goal":
        return cls(
            id=row["id"],
            robot_id=row["robot_id"],
            description=row["description"],
            status=row["status"],
            priority=row["priority"],
            parent_goal=row.get("parent_goal"),
            sub_goals=json.loads(row["sub_goals"]) if isinstance(row["sub_goals"], str) else (row["sub_goals"] or []),
            commands=json.loads(row["commands"]) if isinstance(row["commands"], str) else (row["commands"] or []),
            reasoning=row.get("reasoning") or "",
            confidence=row.get("confidence", 0.0),
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
            completed_at=row.get("completed_at"),
        )


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------

class GoalStore:
    """Async SQLite-backed goal storage."""

    def __init__(self, db_path: str = "brain_server.db"):
        self._db_path = db_path
        self._db: Optional[aiosqlite.Connection] = None

    async def init(self) -> None:
        self._db = await aiosqlite.connect(self._db_path)
        self._db.row_factory = aiosqlite.Row
        await self._db.executescript(_GOALS_SCHEMA)
        await self._db.commit()

    async def close(self) -> None:
        if self._db:
            await self._db.close()
            self._db = None

    async def add(
        self,
        robot_id: str,
        description: str,
        priority: int = 0,
        parent_goal: Optional[str] = None,
        commands: Optional[List[Dict[str, Any]]] = None,
        reasoning: str = "",
        confidence: float = 0.0,
        goal_id: Optional[str] = None,
    ) -> Goal:
        goal = Goal(
            id=goal_id or f"goal_{uuid.uuid4().hex[:12]}",
            robot_id=robot_id,
            description=description,
            priority=priority,
            parent_goal=parent_goal,
            commands=commands or [],
            reasoning=reasoning,
            confidence=confidence,
        )
        assert self._db is not None
        await self._db.execute(
            """
            INSERT INTO goals (id, robot_id, description, status, priority,
                               parent_goal, sub_goals, commands, reasoning, confidence)
            VALUES (?, ?, ?, 'pending', ?, ?, '[]', ?, ?, ?)
            """,
            (goal.id, goal.robot_id, goal.description, goal.priority,
             goal.parent_goal, json.dumps(goal.commands),
             goal.reasoning, goal.confidence),
        )
        await self._db.commit()
        return goal

    async def get(self, goal_id: str) -> Optional[Goal]:
        assert self._db is not None
        cur = await self._db.execute("SELECT * FROM goals WHERE id = ?", (goal_id,))
        row = await cur.fetchone()
        if row is None:
            return None
        return Goal.from_row(dict(row))

    async def list_by_robot(self, robot_id: str, status: Optional[str] = None) -> List[Goal]:
        assert self._db is not None
        if status:
            cur = await self._db.execute(
                "SELECT * FROM goals WHERE robot_id = ? AND status = ? ORDER BY priority DESC, created_at ASC",
                (robot_id, status),
            )
        else:
            cur = await self._db.execute(
                "SELECT * FROM goals WHERE robot_id = ? ORDER BY priority DESC, created_at ASC",
                (robot_id,),
            )
        rows = await cur.fetchall()
        return [Goal.from_row(dict(r)) for r in rows]

    async def update_status(self, goal_id: str, status: str, reasoning: str = "") -> bool:
        assert self._db is not None
        now = datetime.now(timezone.utc).isoformat()
        extra = ""
        params: List[Any] = [status]
        if status in ("completed", "failed", "cancelled"):
            extra = ", completed_at = ?"
            params.append(now)
        if reasoning:
            extra += ", reasoning = ?"
            params.append(reasoning)
        params.extend([now, goal_id])
        await self._db.execute(
            f"UPDATE goals SET status = ?{extra}, updated_at = ? WHERE id = ?",
            params,
        )
        await self._db.commit()
        return True

    async def add_sub_goal(self, parent_id: str, sub_goal_id: str) -> bool:
        """Link a sub-goal to its parent."""
        assert self._db is not None
        parent = await self.get(parent_id)
        if parent is None:
            return False
        subs = list(parent.sub_goals)
        if sub_goal_id not in subs:
            subs.append(sub_goal_id)
        await self._db.execute(
            "UPDATE goals SET sub_goals = ?, updated_at = datetime('now') WHERE id = ?",
            (json.dumps(subs), parent_id),
        )
        await self._db.commit()
        return True

    async def delete(self, goal_id: str) -> bool:
        assert self._db is not None
        await self._db.execute("DELETE FROM goals WHERE id = ?", (goal_id,))
        await self._db.commit()
        return True

    async def get_active(self, robot_id: str) -> Optional[Goal]:
        """Get the highest-priority pending or in-progress goal for a robot."""
        assert self._db is not None
        cur = await self._db.execute(
            """SELECT * FROM goals
               WHERE robot_id = ? AND status IN ('pending', 'in_progress')
               ORDER BY priority DESC, created_at ASC LIMIT 1""",
            (robot_id,),
        )
        row = await cur.fetchone()
        if row is None:
            return None
        return Goal.from_row(dict(row))
