"""
Episode storage — the core of the Memory Brain layer.

Each episode records what the robot experienced, what action was taken,
and what the outcome was.  No neural networks, no weights, no epochs.
Learning = INSERT, SELECT, rule generation.
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

_EPISODES_SCHEMA = """
CREATE TABLE IF NOT EXISTS episodes (
    id            TEXT PRIMARY KEY,
    timestamp     TEXT NOT NULL,
    robot_id      TEXT NOT NULL,
    scene         TEXT NOT NULL,          -- JSON blob of sensor snapshot
    action_taken  TEXT NOT NULL,          -- JSON blob of commands issued
    outcome       TEXT NOT NULL,          -- 'success' | 'failure' | 'surprise' | 'pending'
    notes         TEXT DEFAULT '',
    created_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_episodes_robot_id ON episodes(robot_id);
CREATE INDEX IF NOT EXISTS idx_episodes_outcome  ON episodes(outcome);
CREATE INDEX IF NOT EXISTS idx_episodes_timestamp ON episodes(timestamp);
"""

# ---------------------------------------------------------------------------
# Episode dataclass-like helper
# ---------------------------------------------------------------------------

class Episode:
    """Immutable representation of a single episode."""

    __slots__ = ("id", "timestamp", "robot_id", "scene", "action_taken",
                 "outcome", "notes", "created_at")

    def __init__(
        self,
        id: str,
        timestamp: str,
        robot_id: str,
        scene: Dict[str, Any],
        action_taken: Dict[str, Any],
        outcome: str = "pending",
        notes: str = "",
        created_at: Optional[str] = None,
    ):
        self.id = id
        self.timestamp = timestamp
        self.robot_id = robot_id
        self.scene = scene
        self.action_taken = action_taken
        self.outcome = outcome
        self.notes = notes
        self.created_at = created_at or datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "timestamp": self.timestamp,
            "robot_id": self.robot_id,
            "scene": self.scene,
            "action_taken": self.action_taken,
            "outcome": self.outcome,
            "notes": self.notes,
            "created_at": self.created_at,
        }

    @classmethod
    def from_row(cls, row: Dict[str, Any]) -> "Episode":
        return cls(
            id=row["id"],
            timestamp=row["timestamp"],
            robot_id=row["robot_id"],
            scene=json.loads(row["scene"]) if isinstance(row["scene"], str) else row["scene"],
            action_taken=json.loads(row["action_taken"]) if isinstance(row["action_taken"], str) else row["action_taken"],
            outcome=row["outcome"],
            notes=row["notes"] or "",
            created_at=row.get("created_at"),
        )


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------

class EpisodeStore:
    """Async SQLite-backed episode storage."""

    def __init__(self, db_path: str = "brain_server.db"):
        self._db_path = db_path
        self._db: Optional[aiosqlite.Connection] = None

    # -- lifecycle --

    async def init(self) -> None:
        self._db = await aiosqlite.connect(self._db_path)
        self._db.row_factory = aiosqlite.Row
        await self._db.executescript(_EPISODES_SCHEMA)
        await self._db.commit()

    async def close(self) -> None:
        if self._db:
            await self._db.close()
            self._db = None

    # -- CRUD --

    async def add(
        self,
        robot_id: str,
        scene: Dict[str, Any],
        action_taken: Dict[str, Any],
        outcome: str = "pending",
        notes: str = "",
        episode_id: Optional[str] = None,
        timestamp: Optional[str] = None,
    ) -> Episode:
        ep = Episode(
            id=episode_id or f"ep_{uuid.uuid4().hex[:12]}",
            timestamp=timestamp or datetime.now(timezone.utc).isoformat(),
            robot_id=robot_id,
            scene=scene,
            action_taken=action_taken,
            outcome=outcome,
            notes=notes,
        )
        assert self._db is not None
        await self._db.execute(
            """
            INSERT INTO episodes (id, timestamp, robot_id, scene, action_taken, outcome, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (ep.id, ep.timestamp, ep.robot_id,
             json.dumps(ep.scene), json.dumps(ep.action_taken),
             ep.outcome, ep.notes),
        )
        await self._db.commit()
        return ep

    async def get(self, episode_id: str) -> Optional[Episode]:
        assert self._db is not None
        cur = await self._db.execute("SELECT * FROM episodes WHERE id = ?", (episode_id,))
        row = await cur.fetchone()
        if row is None:
            return None
        return Episode.from_row(dict(row))

    async def update_outcome(self, episode_id: str, outcome: str, notes: str = "") -> bool:
        assert self._db is not None
        await self._db.execute(
            "UPDATE episodes SET outcome = ?, notes = ? WHERE id = ?",
            (outcome, notes, episode_id),
        )
        await self._db.commit()
        return True

    async def list_by_robot(self, robot_id: str, limit: int = 100, offset: int = 0) -> List[Episode]:
        assert self._db is not None
        cur = await self._db.execute(
            "SELECT * FROM episodes WHERE robot_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?",
            (robot_id, limit, offset),
        )
        rows = await cur.fetchall()
        return [Episode.from_row(dict(r)) for r in rows]

    async def count_by_robot(self, robot_id: str) -> int:
        assert self._db is not None
        cur = await self._db.execute("SELECT COUNT(*) FROM episodes WHERE robot_id = ?", (robot_id,))
        row = await cur.fetchone()
        return row[0]

    # -- similarity matching (the core of Memory Brain) --

    async def find_similar(
        self,
        robot_id: str,
        scene: Dict[str, Any],
        limit: int = 3,
    ) -> List[Episode]:
        """Find the most similar past episodes using fuzzy sensor matching.

        Similarity is computed as the weighted sum of normalised differences
        across numeric sensor fields.  Lower distance → higher similarity.
        """
        assert self._db is not None
        cur = await self._db.execute(
            "SELECT * FROM episodes WHERE robot_id = ? ORDER BY timestamp DESC LIMIT 500",
            (robot_id,),
        )
        rows = await cur.fetchall()
        candidates = [Episode.from_row(dict(r)) for r in rows]

        if not candidates:
            return []

        # Determine numeric sensor keys present in both the query scene and candidates
        all_keys = set()
        for c in candidates:
            all_keys.update(k for k, v in c.scene.items() if isinstance(v, (int, float)))
        query_keys = [k for k in scene if isinstance(scene.get(k), (int, float)) and k in all_keys]

        if not query_keys:
            # No numeric overlap — return most recent episodes
            return candidates[:limit]

        # Pre-compute ranges for normalisation
        ranges: Dict[str, float] = {}
        for key in query_keys:
            values = [c.scene.get(key, 0) for c in candidates if isinstance(c.scene.get(key), (int, float))]
            if values:
                ranges[key] = max(values) - min(values) or 1.0
            else:
                ranges[key] = 1.0

        def distance(ep: Episode) -> float:
            total = 0.0
            for key in query_keys:
                v1 = scene.get(key, 0)
                v2 = ep.scene.get(key, 0)
                if isinstance(v1, (int, float)) and isinstance(v2, (int, float)):
                    total += abs(v1 - v2) / ranges[key]
            return total

        scored = sorted(candidates, key=distance)
        return scored[:limit]

    async def delete(self, episode_id: str) -> bool:
        assert self._db is not None
        await self._db.execute("DELETE FROM episodes WHERE id = ?", (episode_id,))
        await self._db.commit()
        return True
