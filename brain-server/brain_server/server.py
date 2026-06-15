"""
WebSocket server for the Triune Brain.

Accepts robot connections via WebSocket, routes messages through the
Triune Brain, and sends commands back to robots.

Supports two message formats:
1. Natural Language Prompt (from ESP32 senddatato):
   "Currently, the input sensors read:
    (sensor: value, ...),
    What do you want to do to:
    (module1, module2, ...)."

2. JSON (legacy/structured):
   {"robot_id": "...", "input_sensors_read": {...}, "output_modules_available": [...]}
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Dict, Optional, Set

import websockets
from websockets.server import serve, WebSocketServerProtocol

from .triune.brain import TriuneBrain, BrainResponse
from .llm.base import BaseLLMProvider

logger = logging.getLogger(__name__)


class BrainWebSocketServer:
    """WebSocket server that connects robots to the Triune Brain."""

    def __init__(self, brain: TriuneBrain, host: str = "0.0.0.0", port: int = 8080):
        self._brain = brain
        self._host = host
        self._port = port
        self._server: Optional[websockets.WebSocketServer] = None
        self._connections: Dict[str, WebSocketServerProtocol] = {}  # robot_id -> ws
        self._ws_to_robot: Dict[int, str] = {}  # ws id -> robot_id
        self._running = False
        # Event callbacks for external consumers (e.g., REST API broadcasting)
        self._event_callbacks = []

    # -- Event system --

    def on_event(self, callback):
        """Register a callback for brain events."""
        self._event_callbacks.append(callback)

    def _emit_event(self, event_type: str, data: Any) -> None:
        for cb in self._event_callbacks:
            try:
                cb(event_type, data)
            except Exception as exc:
                logger.warning("Event callback error: %s", exc)

    # -- Lifecycle --

    async def start(self) -> None:
        """Start the WebSocket server."""
        if self._running:
            logger.warning("WebSocket server already running")
            return

        self._server = await serve(
            self._handle_connection,
            self._host,
            self._port,
        )
        self._running = True
        logger.info(
            "🧠 Brain WebSocket server listening on ws://%s:%d",
            self._host, self._port,
        )

    async def stop(self) -> None:
        """Stop the WebSocket server."""
        if not self._running:
            return

        # Close all connections
        for robot_id, ws in list(self._connections.items()):
            try:
                await ws.close(1001, "Server shutting down")
            except Exception:
                pass
        self._connections.clear()
        self._ws_to_robot.clear()

        if self._server:
            self._server.close()
            await self._server.wait_closed()
            self._server = None

        self._running = False
        logger.info("Brain WebSocket server stopped")

    @property
    def running(self) -> bool:
        return self._running

    @property
    def host(self) -> str:
        return self._host

    @property
    def port(self) -> bool:
        return self._port

    def get_connected_robots(self) -> list:
        return list(self._connections.keys())

    # -- Message parsing --

    def _parse_message(self, raw_message: str) -> Dict[str, Any]:
        """Parse an incoming message from a robot.

        Handles two formats:
        1. Natural Language Prompt (from ESP32 senddatato):
           "Currently, the input sensors read:
            (sensor: value, ...),
            What do you want to do to:
            (module1, module2, ...)."

        2. JSON (legacy/structured):
           {"robot_id": "...", "input_sensors_read": {...}, ...}
        """
        # Try JSON first
        try:
            data = json.loads(raw_message)
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            pass

        # Not JSON — try parsing as natural language prompt
        logger.info("[Server] Received natural language prompt from robot")
        parsed = BaseLLMProvider.parse_natural_language_prompt(raw_message)

        # Store the raw prompt for context
        parsed["_raw_prompt"] = raw_message
        parsed["_format"] = "natural_language"

        return parsed

    # -- Connection handling --

    async def _handle_connection(self, websocket: WebSocketServerProtocol, path: str = "") -> None:
        """Handle a single WebSocket connection from a robot."""
        robot_id = None
        ws_id = id(websocket)

        try:
            async for raw_message in websocket:
                try:
                    # Parse the message (JSON or natural language prompt)
                    data = self._parse_message(raw_message)

                    robot_id = data.get("robot_id")

                    # For natural language prompts without robot_id, use connection-based tracking
                    if not robot_id:
                        # Try to identify robot from previous connections or assign a temporary ID
                        robot_id = self._ws_to_robot.get(ws_id, f"robot_{ws_id % 10000}")
                        data["robot_id"] = robot_id

                    # Track connection
                    self._connections[robot_id] = websocket
                    self._ws_to_robot[ws_id] = robot_id

                    # Register robot with brain if not already known
                    robot_info = self._brain.get_robot_info(robot_id)
                    if not robot_info:
                        self._brain.register_robot(robot_id, {
                            "name": robot_id,
                            "connected_at": time.time(),
                        })

                    # Emit sensor data event
                    self._emit_event("sensor:data", {
                        "robot_id": robot_id,
                        "data": data,
                        "format": data.get("_format", "json"),
                    })

                    # Process through Triune Brain
                    response = await self._brain.process(robot_id, data)

                    # Send response (always JSON commands)
                    response_dict = {
                        "command_id": response.command_id,
                        "timestamp": response.timestamp,
                        "output_commands": response.output_commands,
                        "metadata": response.metadata,
                    }

                    await websocket.send(json.dumps(response_dict))

                    # Emit command event
                    self._emit_event("command:sent", {
                        "robot_id": robot_id,
                        "response": response_dict,
                        "decision_source": response.decision_source,
                    })

                except json.JSONDecodeError:
                    logger.error("Invalid JSON from %s", robot_id or "unknown")
                    await websocket.send(json.dumps({
                        "error": "Invalid JSON format",
                    }))
                except Exception as exc:
                    logger.error("Error processing message from %s: %s", robot_id, exc)
                    await websocket.send(json.dumps({
                        "error": f"Processing error: {exc}",
                    }))

        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as exc:
            logger.error("WebSocket error for %s: %s", robot_id, exc)
        finally:
            # Cleanup
            if robot_id and robot_id in self._connections:
                del self._connections[robot_id]
            if ws_id in self._ws_to_robot:
                del self._ws_to_robot[ws_id]
            self._emit_event("client:disconnected", {"robot_id": robot_id})
            logger.info("Robot %s disconnected", robot_id or "unknown")

    # -- Direct robot commands (from REST API etc.) --

    async def send_to_robot(self, robot_id: str, message: Dict[str, Any]) -> bool:
        """Send a message directly to a connected robot."""
        ws = self._connections.get(robot_id)
        if ws is None:
            return False
        try:
            await ws.send(json.dumps(message))
            return True
        except Exception:
            return False

    async def broadcast(self, message: Dict[str, Any]) -> int:
        """Broadcast a message to all connected robots."""
        count = 0
        for robot_id, ws in list(self._connections.items()):
            try:
                await ws.send(json.dumps(message))
                count += 1
            except Exception:
                pass
        return count
