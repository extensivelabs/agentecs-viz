"""FastAPI WebSocket server for AgentECS visualization."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from typing import TYPE_CHECKING

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, TypeAdapter, ValidationError

from agentecs_viz._version import __version__
from agentecs_viz.protocol import (
    ClientMessage,
    ErrorMessage,
    MetadataMessage,
    PauseCommand,
    ResumeCommand,
    SeekCommand,
    SetSpeedCommand,
    SnapshotMessage,
    StepCommand,
    TickUpdateMessage,
    WorldStateSource,
)

_client_message_adapter: TypeAdapter[ClientMessage] = TypeAdapter(ClientMessage)

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
    version: str = __version__,
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

        meta_msg = MetadataMessage(
            tick=source.get_current_tick(),
            config=source.visualization_config,
            tick_range=source.tick_range,
            supports_history=source.supports_history,
            is_paused=source.is_paused,
        )
        await websocket.send_text(meta_msg.model_dump_json())

        snapshot = await source.get_snapshot()
        snapshot_msg = SnapshotMessage(
            tick=snapshot.tick,
            snapshot=snapshot,
        )
        await websocket.send_text(snapshot_msg.model_dump_json())

        async def receive_commands() -> None:
            try:
                while True:
                    data = await websocket.receive_json()
                    try:
                        await _handle_command(source, websocket, data)
                    except Exception as e:
                        logger.exception("WebSocket command failed")
                        err = ErrorMessage(tick=source.get_current_tick(), message=str(e))
                        await websocket.send_text(err.model_dump_json())
            except WebSocketDisconnect:
                pass

        async def send_events() -> None:
            try:
                async for event in source.subscribe():
                    await websocket.send_text(event.model_dump_json())
            except WebSocketDisconnect:
                pass
            except Exception:
                logger.warning("Event stream failed", exc_info=True)

        receive_task = asyncio.create_task(receive_commands())
        send_task = asyncio.create_task(send_events())

        try:
            done, pending = await asyncio.wait(
                [receive_task, send_task],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
        except Exception as e:
            logger.error("WebSocket error: %s", e)
        finally:
            logger.info("WebSocket client disconnected")

    return app


async def _handle_command(
    source: WorldStateSource,
    websocket: WebSocket,
    data: object,
) -> None:
    try:
        cmd = _client_message_adapter.validate_python(data)
    except ValidationError as exc:
        err = ErrorMessage(
            tick=source.get_current_tick(),
            message=f"Invalid command: {exc.errors()[0]['msg']}",
        )
        await websocket.send_text(err.model_dump_json())
        return

    match cmd:
        case SeekCommand(tick=tick):
            snapshot = await source.get_snapshot(tick)
            msg = SnapshotMessage(tick=snapshot.tick, snapshot=snapshot)
            await websocket.send_text(msg.model_dump_json())
        case PauseCommand() | ResumeCommand() | StepCommand():
            await source.send_command(cmd.command)
            snapshot = await source.get_snapshot()
            ack = TickUpdateMessage(
                tick=snapshot.tick,
                entity_count=snapshot.entity_count,
                is_paused=source.is_paused,
            )
            await websocket.send_text(ack.model_dump_json())
        case SetSpeedCommand(ticks_per_second=tps):
            await source.send_command("set_speed", ticks_per_second=tps)
        case _:
            raise AssertionError(f"Unhandled command type: {type(cmd).__name__}")
