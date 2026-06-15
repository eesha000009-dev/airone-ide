"""
REST API for the AI Backbone desktop app.

Provides HTTP endpoints for the Electron app to interact with the
brain server: robot management, episode/rules inspection, goal setting,
AI model configuration, etc.

Uses aiohttp for async HTTP serving alongside the WebSocket server.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from aiohttp import web

from ..triune.brain import TriuneBrain
from ..server import BrainWebSocketServer

logger = logging.getLogger(__name__)


def create_app(brain: TriuneBrain, ws_server: BrainWebSocketServer) -> web.Application:
    """Create and configure the aiohttp application with all routes."""
    app = web.Application()

    # Store brain and ws_server in the app for handler access
    app["brain"] = brain
    app["ws_server"] = ws_server

    # Register routes
    app.router.add_post("/api/robots", handle_create_robot)
    app.router.add_get("/api/robots/{robot_id}", handle_get_robot)
    app.router.add_post("/api/sync-pins", handle_sync_pins)
    app.router.add_get("/api/robots/{robot_id}/pins", handle_get_pins)
    app.router.add_get("/api/robots/{robot_id}/episodes", handle_get_episodes)
    app.router.add_get("/api/robots/{robot_id}/rules", handle_get_rules)
    app.router.add_post("/api/robots/{robot_id}/goals", handle_set_goal)
    app.router.add_get("/api/robots/{robot_id}/goals", handle_get_goals)
    app.router.add_get("/api/robots/{robot_id}/status", handle_get_status)
    app.router.add_post("/api/emergency-stop", handle_emergency_stop)
    app.router.add_post("/api/emergency-release/{robot_id}", handle_emergency_release)
    app.router.add_get("/api/ai-models", handle_list_ai_models)
    app.router.add_post("/api/ai-models/configure", handle_configure_ai)
    app.router.add_post("/api/test-ai", handle_test_ai)
    app.router.add_get("/api/status", handle_server_status)

    # Also add a simple health check
    app.router.add_get("/api/health", handle_health)

    return app


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _json_response(data: Any, status: int = 200) -> web.Response:
    return web.json_response(data, status=status, dumps=lambda obj: json.dumps(obj, default=str))


def _error_response(message: str, status: int = 400) -> web.Response:
    return web.json_response({"error": message}, status=status)


# ---------------------------------------------------------------------------
# Route handlers
# ---------------------------------------------------------------------------

async def handle_health(request: web.Request) -> web.Response:
    """Health check endpoint."""
    return _json_response({"status": "ok", "service": "airone-brain-server"})


async def handle_create_robot(request: web.Request) -> web.Response:
    """Create a robot identity: POST /api/robots"""
    brain: TriuneBrain = request.app["brain"]
    try:
        data = await request.json()
    except json.JSONDecodeError:
        return _error_response("Invalid JSON body")

    robot_id = data.get("id") or data.get("name")
    if not robot_id:
        return _error_response("Robot id/name is required")

    info = {
        "name": data.get("name", robot_id),
        "type": data.get("type", "unknown"),
        "purpose": data.get("purpose", ""),
        "environment": data.get("environment", ""),
        "brain_url": data.get("brain_url", ""),
    }
    brain.register_robot(robot_id, info)

    # Store pins if provided
    if "pins" in data:
        brain.register_pins(robot_id, data["pins"])

    return _json_response({"success": True, "robot_id": robot_id, "info": info})


async def handle_get_robot(request: web.Request) -> web.Response:
    """Get robot config: GET /api/robots/:id"""
    brain: TriuneBrain = request.app["brain"]
    robot_id = request.match_info["robot_id"]

    info = brain.get_robot_info(robot_id)
    if not info:
        return _error_response(f"Robot {robot_id} not found", 404)

    pins = brain.get_robot_pins(robot_id)
    return _json_response({"robot_id": robot_id, "info": info, "pins": pins})


async def handle_sync_pins(request: web.Request) -> web.Response:
    """Receive pin definitions from IDE: POST /api/sync-pins"""
    brain: TriuneBrain = request.app["brain"]
    try:
        data = await request.json()
    except json.JSONDecodeError:
        return _error_response("Invalid JSON body")

    robot_id = data.get("robot_id")
    pins = data.get("pins", [])

    if not robot_id:
        return _error_response("robot_id is required")

    brain.register_pins(robot_id, pins)
    return _json_response({"success": True, "robot_id": robot_id, "pin_count": len(pins)})


async def handle_get_pins(request: web.Request) -> web.Response:
    """Get pin map: GET /api/robots/:id/pins"""
    brain: TriuneBrain = request.app["brain"]
    robot_id = request.match_info["robot_id"]
    pins = brain.get_robot_pins(robot_id)
    return _json_response({"robot_id": robot_id, "pins": pins})


async def handle_get_episodes(request: web.Request) -> web.Response:
    """Get episode history: GET /api/robots/:id/episodes"""
    brain: TriuneBrain = request.app["brain"]
    robot_id = request.match_info["robot_id"]

    limit = int(request.query.get("limit", "50"))
    offset = int(request.query.get("offset", "0"))

    episodes = await brain.memory.get_episodes(robot_id, limit=limit)
    return _json_response({
        "robot_id": robot_id,
        "episodes": [ep.to_dict() for ep in episodes],
        "count": len(episodes),
    })


async def handle_get_rules(request: web.Request) -> web.Response:
    """Get learned rules: GET /api/robots/:id/rules"""
    brain: TriuneBrain = request.app["brain"]
    robot_id = request.match_info["robot_id"]

    enabled_only = request.query.get("enabled_only", "false").lower() == "true"
    rules = await brain.memory.get_rules(robot_id, enabled_only=enabled_only)
    return _json_response({
        "robot_id": robot_id,
        "rules": [r.to_dict() for r in rules],
        "human_readable": [r.to_human_readable() for r in rules],
        "count": len(rules),
    })


async def handle_set_goal(request: web.Request) -> web.Response:
    """Set a new goal: POST /api/robots/:id/goals"""
    brain: TriuneBrain = request.app["brain"]
    robot_id = request.match_info["robot_id"]

    try:
        data = await request.json()
    except json.JSONDecodeError:
        return _error_response("Invalid JSON body")

    description = data.get("description") or data.get("goal")
    if not description:
        return _error_response("Goal description is required")

    priority = int(data.get("priority", 0))
    goal = await brain.goal.create_goal(
        robot_id=robot_id,
        description=description,
        priority=priority,
    )
    return _json_response({"success": True, "goal": goal.to_dict()})


async def handle_get_goals(request: web.Request) -> web.Response:
    """Get goals: GET /api/robots/:id/goals"""
    brain: TriuneBrain = request.app["brain"]
    robot_id = request.match_info["robot_id"]

    status = request.query.get("status")
    goals = await brain.goal.list_goals(robot_id, status=status)
    return _json_response({
        "robot_id": robot_id,
        "goals": [g.to_dict() for g in goals],
        "count": len(goals),
    })


async def handle_get_status(request: web.Request) -> web.Response:
    """Get live status: GET /api/robots/:id/status"""
    brain: TriuneBrain = request.app["brain"]
    ws_server: BrainWebSocketServer = request.app["ws_server"]
    robot_id = request.match_info["robot_id"]

    info = brain.get_robot_info(robot_id)
    connected = robot_id in ws_server.get_connected_robots()
    emergency = brain.reflex.is_emergency_stopped(robot_id)

    return _json_response({
        "robot_id": robot_id,
        "connected": connected,
        "emergency_stopped": emergency,
        "info": info,
    })


async def handle_emergency_stop(request: web.Request) -> web.Response:
    """Emergency stop: POST /api/emergency-stop"""
    brain: TriuneBrain = request.app["brain"]
    try:
        data = await request.json()
    except json.JSONDecodeError:
        data = {}

    robot_id = data.get("robot_id")  # None = stop all
    result = brain.emergency_stop(robot_id)

    # Send stop command to connected robots via WebSocket
    if robot_id:
        ws_server: BrainWebSocketServer = request.app["ws_server"]
        await ws_server.send_to_robot(robot_id, {
            "command_id": f"cmd_emergency_{id(request)}",
            "output_commands": {"_emergency_stop": {"action": "halt", "value": 1}},
            "metadata": {"confidence": 1.0, "reasoning": "EMERGENCY STOP ACTIVATED"},
        })
    else:
        ws_server: BrainWebSocketServer = request.app["ws_server"]
        await ws_server.broadcast({
            "command_id": f"cmd_emergency_{id(request)}",
            "output_commands": {"_emergency_stop": {"action": "halt", "value": 1}},
            "metadata": {"confidence": 1.0, "reasoning": "EMERGENCY STOP - ALL ROBOTS"},
        })

    return _json_response(result)


async def handle_emergency_release(request: web.Request) -> web.Response:
    """Release emergency stop: POST /api/emergency-release/:id"""
    brain: TriuneBrain = request.app["brain"]
    robot_id = request.match_info["robot_id"]
    result = brain.release_emergency_stop(robot_id)
    return _json_response(result)


async def handle_list_ai_models(request: web.Request) -> web.Response:
    """List available AI models: GET /api/ai-models"""
    brain: TriuneBrain = request.app["brain"]
    providers = brain.goal.list_providers()
    return _json_response({"providers": providers})


async def handle_configure_ai(request: web.Request) -> web.Response:
    """Configure an AI model: POST /api/ai-models/configure"""
    brain: TriuneBrain = request.app["brain"]
    try:
        data = await request.json()
    except json.JSONDecodeError:
        return _error_response("Invalid JSON body")

    name = data.get("provider")
    if not name:
        return _error_response("provider name is required")

    success = brain.goal.configure_provider(
        name=name,
        api_key=data.get("api_key"),
        endpoint=data.get("endpoint"),
        model=data.get("model"),
    )

    if data.get("activate"):
        brain.goal.set_active_provider(name)

    return _json_response({"success": success, "active_provider": brain.goal.get_active_provider()})


async def handle_test_ai(request: web.Request) -> web.Response:
    """Test AI connection: POST /api/test-ai"""
    brain: TriuneBrain = request.app["brain"]
    try:
        data = await request.json()
    except json.JSONDecodeError:
        data = {}

    provider_name = data.get("provider") or brain.goal.get_active_provider()
    result = await brain.goal.test_provider(provider_name)
    return _json_response(result)


async def handle_server_status(request: web.Request) -> web.Response:
    """Server status: GET /api/status"""
    brain: TriuneBrain = request.app["brain"]
    ws_server: BrainWebSocketServer = request.app["ws_server"]
    return _json_response({
        "brain": brain.get_status(),
        "websocket": {
            "running": ws_server.running,
            "host": ws_server.host,
            "port": ws_server.port,
            "connected_robots": ws_server.get_connected_robots(),
        },
    })
