"""
Brain client URL parsing and client code generation.

Handles:
  - Parsing brain_url (wss://, ws://, mqtt://, http://)
  - Generating WebSocket connection code
  - Reconnection logic with exponential backoff
  - Heartbeat / ping-pong
  - ask() callback mechanism
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlparse


@dataclass
class BrainConnection:
    """Parsed brain connection parameters."""
    protocol: str       # "wss", "ws", "mqtt", "http", "https"
    host: str
    port: int
    path: str
    is_secure: bool

    @property
    def is_websocket(self) -> bool:
        return self.protocol in ("ws", "wss")

    @property
    def is_mqtt(self) -> bool:
        return self.protocol == "mqtt"

    @property
    def is_http(self) -> bool:
        return self.protocol in ("http", "https")

    @property
    def default_arduino_port(self) -> int:
        """Return the port suitable for ArduinoWebsockets connect()."""
        return self.port


def parse_brain_url(url: str) -> BrainConnection:
    """Parse a brain_url string into a BrainConnection object."""
    if not url:
        return BrainConnection(protocol="ws", host="", port=80, path="/", is_secure=False)

    # Ensure there's a scheme
    if "://" not in url:
        url = "ws://" + url

    parsed = urlparse(url)
    protocol = parsed.scheme or "ws"
    host = parsed.hostname or ""
    port = parsed.port
    path = parsed.path or "/"

    if port is None:
        if protocol == "wss":
            port = 443
        elif protocol == "ws":
            port = 80
        elif protocol == "https":
            port = 443
        elif protocol == "mqtt":
            port = 1883
        else:
            port = 80

    is_secure = protocol in ("wss", "https")

    return BrainConnection(
        protocol=protocol,
        host=host,
        port=port,
        path=path,
        is_secure=is_secure,
    )


# ── Ask mechanism template data ───────────────────────────────────────

def generate_ask_context(ask_statements: list) -> dict:
    """Generate template context for ask() callback mechanism.

    The ask() mechanism works like this:
    1. Robot sends a question to the brain in its sensor data JSON
    2. Brain processes the question and includes an answer in its response
    3. Robot reads the answer and executes the corresponding action

    Returns a dict for the Jinja2 template.
    """
    asks = []
    for stmt in ask_statements:
        asks.append({
            "question": stmt.question,
            "context": stmt.context,
        })

    return {
        "has_ask": len(asks) > 0,
        "asks": asks,
    }
