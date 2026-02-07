"""Base class for world sources with tick loops."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from abc import abstractmethod
from collections.abc import AsyncIterator
from typing import Any

from agentecs_viz.config import VisualizationConfig
from agentecs_viz.protocol import (
    MetadataMessage,
    SnapshotMessage,
)
from agentecs_viz.snapshot import WorldSnapshot

logger = logging.getLogger(__name__)

DEFAULT_EVENT_QUEUE_MAXSIZE = 1000


class TickLoopSource:
    """Base class for sources that run a background tick loop.

    Subclasses implement ``_tick_loop_body()``, ``get_snapshot()``,
    ``get_current_tick()``, and ``send_command()``. The base handles
    event queuing, background loop lifecycle, and subscription streaming.
    """

    def __init__(
        self,
        tick_interval: float = 1.0,
        event_queue_maxsize: int = DEFAULT_EVENT_QUEUE_MAXSIZE,
        visualization_config: VisualizationConfig | None = None,
    ) -> None:
        self._tick_interval = tick_interval
        self._event_queue_maxsize = event_queue_maxsize
        self._visualization_config = visualization_config

        self._connected = False
        self._paused = False
        self._stop_event: asyncio.Event | None = None
        self._event_queue: asyncio.Queue[SnapshotMessage | MetadataMessage | Any] | None = None
        self._loop_task: asyncio.Task[None] | None = None

    @property
    def visualization_config(self) -> VisualizationConfig | None:
        return self._visualization_config

    @property
    def is_connected(self) -> bool:
        return self._connected

    @property
    def is_paused(self) -> bool:
        return self._paused

    async def connect(self) -> None:
        self._connected = True
        self._stop_event = asyncio.Event()
        self._event_queue = asyncio.Queue(maxsize=self._event_queue_maxsize)
        await self._on_connect()
        self._loop_task = asyncio.create_task(self._run_loop())

    async def disconnect(self) -> None:
        self._connected = False
        if self._stop_event:
            self._stop_event.set()
        if self._loop_task:
            self._loop_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._loop_task
            self._loop_task = None

    async def subscribe(self) -> AsyncIterator[SnapshotMessage | MetadataMessage | Any]:
        if not self._stop_event or not self._event_queue:
            return
            yield  # pragma: no cover - makes this a proper empty async generator

        async for event in self._emit_initial_events():
            yield event

        while not self._stop_event.is_set():
            try:
                event = await asyncio.wait_for(
                    self._event_queue.get(),
                    timeout=0.1,
                )
                yield event
            except TimeoutError:
                continue

    async def _run_loop(self) -> None:
        while self._connected and self._stop_event and not self._stop_event.is_set():
            await self._tick_loop_body()
            try:
                await asyncio.wait_for(
                    self._stop_event.wait(),
                    timeout=self._get_loop_interval(),
                )
                break
            except TimeoutError:
                continue

    async def _emit_event(self, event: SnapshotMessage | MetadataMessage | Any) -> None:
        if self._event_queue:
            try:
                self._event_queue.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning("Event queue full, dropping event")

    async def _on_connect(self) -> None:
        """Hook: called during connect, before starting the loop."""

    async def _emit_initial_events(self) -> AsyncIterator[SnapshotMessage | MetadataMessage | Any]:
        """Hook: yield events at start of subscription."""
        return
        yield  # pragma: no cover - makes this a proper empty async generator

    def _get_loop_interval(self) -> float:
        return self._tick_interval

    @abstractmethod
    async def _tick_loop_body(self) -> None: ...

    @abstractmethod
    async def get_snapshot(self, tick: int | None = None) -> WorldSnapshot: ...

    @abstractmethod
    def get_current_tick(self) -> int: ...

    @abstractmethod
    async def send_command(self, command: str, **kwargs: Any) -> None: ...
