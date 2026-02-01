"""FastAPI WebSocket server for AgentECS visualization.

Provides real-time world state streaming via WebSocket and REST endpoints
for health checks and server info.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from agentecs_viz.protocol import (
    TickEvent,
    WorldStateSource,
)

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

logger = logging.getLogger(__name__)


class HealthResponse(BaseModel):
    """Health check response."""

    status: str
    connected: bool
    tick: int


class ServerInfo(BaseModel):
    """Server information response."""

    name: str
    version: str
    source_type: str


class ClientCommand(BaseModel):
    """Command sent from client to server."""

    command: str
    params: dict[str, Any] = {}


def create_app(
    source: WorldStateSource,
    *,
    title: str = "AgentECS Visualizer",
    version: str = "0.1.0",
) -> FastAPI:
    """Create FastAPI application with WebSocket endpoint.

    Args:
        source: WorldStateSource to stream from.
        title: API title for documentation.
        version: API version.

    Returns:
        Configured FastAPI application.

    Example:
        from agentecs_viz.sources.mock import MockWorldSource
        from agentecs_viz.server import create_app
        import uvicorn

        source = MockWorldSource()
        app = create_app(source)
        uvicorn.run(app, host="0.0.0.0", port=8000)
    """

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        """Connect source on startup, disconnect on shutdown."""
        await source.connect()
        logger.info("World source connected")
        yield
        await source.disconnect()
        logger.info("World source disconnected")

    app = FastAPI(
        title=title,
        version=version,
        lifespan=lifespan,
    )

    # Store source in app state for access outside request context
    app.state.world_source = source

    @app.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        """Health check endpoint.

        Returns connection status and current tick.
        """
        snapshot = await source.get_snapshot()
        return HealthResponse(
            status="ok",
            connected=source.is_connected,
            tick=snapshot.tick,
        )

    @app.get("/info", response_model=ServerInfo)
    async def info() -> ServerInfo:
        """Server information endpoint."""
        return ServerInfo(
            name=title,
            version=version,
            source_type=type(source).__name__,
        )

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        """WebSocket endpoint for real-time world state streaming.

        Streams TickEvents as JSON to connected clients.
        Accepts commands from clients (pause, resume, step, set_tick_rate).

        Message format (server -> client):
            {"type": "config", "config": {...}}  (sent once on connect)
            {"type": "tick", "snapshot": {...}}
            {"type": "error", "message": "..."}

        Message format (client -> server):
            {"command": "pause"}
            {"command": "resume"}
            {"command": "step"}
            {"command": "set_tick_rate", "params": {"ticks_per_second": 10}}
        """
        await websocket.accept()
        logger.info("WebSocket client connected")

        # Send visualization config if available
        config = getattr(source, "visualization_config", None)
        if config is not None:
            await websocket.send_json(
                {
                    "type": "config",
                    "config": config.model_dump(),
                }
            )

        def build_history_info() -> dict[str, Any]:
            """Build history info dict for client."""
            return {
                "type": "history_info",
                "supports_replay": getattr(source, "supports_replay", False),
                "tick_range": getattr(source, "tick_range", None),
                "is_paused": getattr(source, "is_paused", False),
            }

        await websocket.send_json(build_history_info())

        # Task for receiving commands from client
        async def receive_commands() -> None:
            try:
                while True:
                    data = await websocket.receive_json()
                    try:
                        cmd = ClientCommand(**data)

                        # Handle special commands
                        if cmd.command == "get_history_info":
                            await websocket.send_json(build_history_info())
                        elif cmd.command == "seek":
                            if not getattr(source, "supports_replay", False):
                                await websocket.send_json(
                                    {
                                        "type": "error",
                                        "message": "Source does not support replay",
                                    }
                                )
                            else:
                                tick = cmd.params.get("tick", 0)
                                snapshot = await source.seek(int(tick))  # type: ignore[union-attr]
                                if snapshot:
                                    await websocket.send_json(
                                        {
                                            "type": "seek_complete",
                                            "tick": tick,
                                            "snapshot": snapshot.model_dump(),
                                        }
                                    )
                                    await websocket.send_json(build_history_info())
                                else:
                                    await websocket.send_json(
                                        {
                                            "type": "error",
                                            "message": f"Tick {tick} not available",
                                        }
                                    )
                        elif cmd.command == "get_entity_lifecycles":
                            # Get history store from source
                            store = getattr(source, "store", None)
                            if store is None:
                                store = getattr(source, "_store", None)
                            if store is None:
                                await websocket.send_json(
                                    {
                                        "type": "entity_lifecycles",
                                        "lifecycles": [],
                                        "tick_range": None,
                                    }
                                )
                            else:
                                from agentecs_viz.history import compute_entity_lifecycles

                                lifecycles = compute_entity_lifecycles(store)
                                tick_range = store.get_tick_range()
                                await websocket.send_json(
                                    {
                                        "type": "entity_lifecycles",
                                        "lifecycles": lifecycles,
                                        "tick_range": (list(tick_range) if tick_range else None),
                                    }
                                )
                        else:
                            # Standard command
                            await source.send_command(cmd.command, **cmd.params)
                            logger.debug(f"Executed command: {cmd.command}")
                            if cmd.command in ("pause", "resume"):
                                await websocket.send_json(build_history_info())
                    except Exception as e:
                        logger.exception("WebSocket command failed")
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": f"Command failed: {e}",
                            }
                        )
            except WebSocketDisconnect:
                pass

        # Task for sending events to client
        async def send_events() -> None:
            try:
                async for event in source.subscribe_events():
                    if isinstance(event, TickEvent):
                        await websocket.send_json(
                            {
                                "type": "tick",
                                "snapshot": event.snapshot.model_dump(),
                            }
                        )
            except WebSocketDisconnect:
                pass

        # Run both tasks concurrently
        receive_task = asyncio.create_task(receive_commands())
        send_task = asyncio.create_task(send_events())

        try:
            # Wait for either task to complete (usually due to disconnect)
            done, pending = await asyncio.wait(
                [receive_task, send_task],
                return_when=asyncio.FIRST_COMPLETED,
            )
            # Cancel the other task
            for task in pending:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
        except Exception as e:
            logger.error(f"WebSocket error: {e}")
        finally:
            logger.info("WebSocket client disconnected")

    return app
