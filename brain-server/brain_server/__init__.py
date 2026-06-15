"""
Airone Brain Server - Triune Brain Architecture

A standalone brain server implementing the Triune Brain model:
  Layer 1 (Reflex):  Safety reflexes — deterministic, server-side checks
  Layer 2 (Memory):  Episodic memory + rule learning — no weights, no epochs
  Layer 3 (Goal):    Goal processing + LLM integration — high-level planning

Usage:
    python -m brain_server --port 8080
"""

__version__ = "0.1.0"
__author__ = "Airone Project"
