"""
Entry point for running the brain server with: python -m brain_server

Usage:
    python -m brain_server [--port PORT] [--host HOST] [--db PATH] [--rest-port PORT]
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import signal
import sys

from .triune.brain import TriuneBrain
from .server import BrainWebSocketServer
from .api.rest_api import create_app

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("brain_server")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Airone Brain Server — Triune Brain Architecture",
    )
    parser.add_argument(
        "--host", default="0.0.0.0",
        help="Host to bind to (default: 0.0.0.0)",
    )
    parser.add_argument(
        "--port", "-p", type=int, default=8080,
        help="WebSocket port (default: 8080)",
    )
    parser.add_argument(
        "--rest-port", type=int, default=8081,
        help="REST API port (default: 8081)",
    )
    parser.add_argument(
        "--db", default="brain_server.db",
        help="SQLite database path (default: brain_server.db)",
    )
    parser.add_argument(
        "--no-rest", action="store_true",
        help="Disable REST API server",
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true",
        help="Enable verbose (DEBUG) logging",
    )
    return parser.parse_args()


async def run_server(args: argparse.Namespace) -> None:
    """Initialize and run the brain server."""

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Initialize Triune Brain
    brain = TriuneBrain(db_path=args.db)
    await brain.init()

    # Initialize WebSocket server
    ws_server = BrainWebSocketServer(brain, host=args.host, port=args.port)
    await ws_server.start()

    rest_runner = None
    rest_site = None

    if not args.no_rest:
        # Initialize REST API
        app = create_app(brain, ws_server)
        runner = web.AppRunner(app)
        await runner.setup()
        rest_site = web.TCPSite(runner, args.host, args.rest_port)
        await rest_site.start()
        logger.info(
            "🌐 REST API listening on http://%s:%d",
            args.host, args.rest_port,
        )
        rest_runner = runner

    logger.info("=" * 60)
    logger.info("  🧠 Airone Brain Server — Triune Brain Architecture")
    logger.info("  WebSocket: ws://%s:%d", args.host, args.port)
    if not args.no_rest:
        logger.info("  REST API:  http://%s:%d", args.host, args.rest_port)
    logger.info("  Database:  %s", args.db)
    logger.info("=" * 60)

    # Graceful shutdown
    stop_event = asyncio.Event()

    def _signal_handler():
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _signal_handler)
        except NotImplementedError:
            # Windows doesn't support add_signal_handler
            pass

    logger.info("Waiting for robot connections... (Ctrl+C to stop)")

    try:
        await stop_event.wait()
    except KeyboardInterrupt:
        pass

    logger.info("Shutting down...")

    # Cleanup
    await ws_server.stop()
    if rest_runner:
        await rest_runner.cleanup()
    await brain.close()
    logger.info("Goodbye!")


# Need to import web for the REST API
from aiohttp import web


def main() -> None:
    args = parse_args()
    try:
        asyncio.run(run_server(args))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
