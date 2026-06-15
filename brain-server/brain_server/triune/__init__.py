"""Triune Brain architecture — the three-layer brain model."""

from .reflex import ReflexBrain
from .memory import MemoryBrain
from .goal import GoalBrain
from .brain import TriuneBrain

__all__ = ["ReflexBrain", "MemoryBrain", "GoalBrain", "TriuneBrain"]
