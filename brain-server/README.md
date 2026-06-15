# Airone Brain Server — Triune Brain Architecture

A standalone Python brain server implementing the **Triune Brain** model for robot control.

## Architecture

The brain operates in three layers, processed in order:

### Layer 1: Reflex Brain (deterministic, server-side safety)
- Hard safety checks that supplement firmware-level safety
- Temperature > 60°C → force all outputs OFF
- Human proximity < 20cm → force all actuators OFF
- Battery < 10% → force return to charging
- Cannot be bypassed by higher brain layers
- Can be updated without reflashing robot firmware

### Layer 2: Memory Brain (episodic memory + rule learning)
- **No neural networks, no weights, no epochs**
- Learning = database operations: INSERT, SELECT, rule generation
- Stores episodes (what the robot saw, what it did, what happened)
- Matches current scene to similar past episodes
- Generalizes rules after repeated patterns (5+ similar episodes)
- Rules are human-readable and editable

### Layer 3: Goal Brain (LLM integration)
- Takes human instructions in plain English
- Breaks goals into sub-goals
- Connects to LLMs: GPT-4, Claude, local LLaMA (Ollama)
- Falls back to rule-based when LLM is unavailable
- Tracks goal progress and completion

## Installation

```bash
cd brain-server
pip install -e .
# Or with all LLM providers:
pip install -e ".[all]"
```

## Usage

```bash
# Start with defaults (WebSocket on :8080, REST on :8081)
python -m brain_server

# Custom ports
python -m brain_server --port 9000 --rest-port 9001

# Custom database path
python -m brain_server --db /data/brain.db

# Verbose logging
python -m brain_server -v

# Disable REST API
python -m brain_server --no-rest
```

## WebSocket Protocol (Robot → Brain)

Robots connect via WebSocket and send JSON messages:

```json
{
    "robot_id": "zeeb",
    "input_sensors_read": {
        "temperature": 28.5,
        "ultrasonic": 45,
        "camera": "none",
        "microphone": "none"
    },
    "output_modules_available": ["ledpin", "urhands", "llleg"]
}
```

The brain responds with:

```json
{
    "command_id": "cmd_1",
    "timestamp": 1716561234567,
    "output_commands": {
        "ledpin": {"action": "digitalwrite", "value": 1},
        "urhands": {"action": "servo", "angle": 45}
    },
    "metadata": {
        "confidence": 0.85,
        "reasoning": "Decision from memory_exact"
    }
}
```

## REST API (AI Backbone App → Brain)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/status` | GET | Server status |
| `/api/robots` | POST | Create robot identity |
| `/api/robots/:id` | GET | Get robot config |
| `/api/sync-pins` | POST | Receive pin definitions from IDE |
| `/api/robots/:id/pins` | GET | Get pin map |
| `/api/robots/:id/episodes` | GET | Get episode history |
| `/api/robots/:id/rules` | GET | Get learned rules |
| `/api/robots/:id/goals` | GET/POST | Get/set goals |
| `/api/robots/:id/status` | GET | Get live status |
| `/api/emergency-stop` | POST | Emergency stop |
| `/api/ai-models` | GET | List available AI models |
| `/api/ai-models/configure` | POST | Configure AI model |
| `/api/test-ai` | POST | Test AI connection |

## Database Schema

SQLite tables: `episodes`, `rules`, `goals`, and in-memory robot tracking.

## Project Structure

```
brain-server/
├── brain_server/
│   ├── __init__.py
│   ├── __main__.py          # python -m brain_server
│   ├── server.py            # WebSocket server
│   ├── triune/
│   │   ├── reflex.py        # Layer 1: Safety reflexes
│   │   ├── memory.py        # Layer 2: Episodic memory + rule learning
│   │   ├── goal.py          # Layer 3: Goal processing + LLM integration
│   │   └── brain.py         # Triune Brain orchestrator
│   ├── storage/
│   │   ├── episodes.py      # Episode storage (SQLite)
│   │   ├── rules.py         # Rule storage and matching
│   │   └── goals.py         # Goal tracking
│   ├── llm/
│   │   ├── base.py          # Abstract LLM interface
│   │   ├── openai_provider.py   # GPT-4 integration
│   │   ├── claude_provider.py   # Claude integration
│   │   ├── ollama_provider.py   # Local LLaMA via Ollama
│   │   └── rule_engine.py       # Rule-based fallback
│   └── api/
│       └── rest_api.py      # REST API endpoints
├── requirements.txt
├── setup.py
└── README.md
```
