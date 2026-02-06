"""FastAPI WebSocket server for AgentECS visualization."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from agentecs_viz.protocol import (
    MetadataMessage,
    SnapshotMessage,
    WorldStateSource,
)

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

logger = logging.getLogger(__name__)


class HealthResponse(BaseModel):
    status: str
    connected: bool
    tick: int


class MetadataResponse(BaseModel):
    name: str
    version: str
    source_type: str
    tick: int


def create_app(
    source: WorldStateSource,
    *,
    title: str = "AgentECS Visualizer",
    version: str = "0.1.0",
) -> FastAPI:
    """Create FastAPI app with REST + WebSocket endpoints for world state streaming."""

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        await source.connect()
        logger.info("World source connected")
        yield
        await source.disconnect()
        logger.info("World source disconnected")

    app = FastAPI(title=title, version=version, lifespan=lifespan)
    app.state.world_source = source

    @app.get("/api/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        tick = source.get_current_tick()
        return HealthResponse(
            status="ok",
            connected=source.is_connected,
            tick=tick,
        )

    @app.get("/api/metadata", response_model=MetadataResponse)
    async def metadata() -> MetadataResponse:
        return MetadataResponse(
            name=title,
            version=version,
            source_type=type(source).__name__,
            tick=source.get_current_tick(),
        )

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        await websocket.accept()
        logger.info("WebSocket client connected")

        config = source.visualization_config
        history_store = getattr(source, "_history", None) or getattr(source, "history", None)
        tick_range = history_store.get_tick_range() if history_store else None
        supports_history = history_store is not None

        meta_msg = MetadataMessage(
            tick=source.get_current_tick(),
            config=config,
            tick_range=tick_range,
            supports_history=supports_history,
            is_paused=getattr(source, "is_paused", False),
        )
        await websocket.send_json(meta_msg.model_dump())

        snapshot = await source.get_snapshot()
        snapshot_msg = SnapshotMessage(
            tick=source.get_current_tick(),
            snapshot=snapshot,
        )
        await websocket.send_json(snapshot_msg.model_dump())

        async def receive_commands() -> None:
            try:
                while True:
                    data = await websocket.receive_json()
                    try:
                        await _handle_command(source, websocket, data)
                    except Exception as e:
                        logger.exception("WebSocket command failed")
                        await websocket.send_json(
                            {"type": "error", "tick": source.get_current_tick(), "message": str(e)}
                        )
            except WebSocketDisconnect:
                pass

        async def send_events() -> None:
            try:
                async for event in source.subscribe():
                    msg: dict[str, Any]
                    if isinstance(event, BaseModel):
                        msg = event.model_dump()
                    else:
                        msg = {"type": "unknown", "data": str(event)}
                    await websocket.send_json(msg)
            except WebSocketDisconnect:
                pass

        receive_task = asyncio.create_task(receive_commands())
        send_task = asyncio.create_task(send_events())

        try:
            done, pending = await asyncio.wait(
                [receive_task, send_task],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
        except Exception as e:
            logger.error(f"WebSocket error: {e}")
        finally:
            logger.info("WebSocket client disconnected")

    return app


async def _handle_command(
    source: WorldStateSource,
    websocket: WebSocket,
    data: dict[str, Any],
) -> None:
    command = data.get("command", "")

    if command == "seek":
        tick = int(data.get("tick", 0))
        snapshot = await source.get_snapshot(tick)
        msg = SnapshotMessage(tick=tick, snapshot=snapshot)
        await websocket.send_json(msg.model_dump())
    elif command in ("pause", "resume", "step"):
        await source.send_command(command)
    elif command == "set_speed":
        tps = data.get("ticks_per_second", 1.0)
        await source.send_command(command, ticks_per_second=tps)
    elif command == "subscribe":
        pass  # Already subscribed via send_events
    else:
        await source.send_command(command, **{k: v for k, v in data.items() if k != "command"})
