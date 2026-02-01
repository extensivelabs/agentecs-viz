"""Base class for world sources with tick loops.

Provides common infrastructure for sources that emit events via a background loop.
"""

from __future__ import annotations

import asyncio
import contextlib
from abc import abstractmethod
from collections.abc import AsyncIterator

from agentecs_viz.config import VisualizationConfig
from agentecs_viz.protocol import WorldEvent, WorldStateSource
from agentecs_viz.snapshot import WorldSnapshot

# Default maximum queued events before blocking
DEFAULT_EVENT_QUEUE_MAXSIZE = 1000


class TickLoopSource(WorldStateSource):
    """Base class for sources that run a background tick loop.

    Subclasses implement:
    - `_tick_loop_body()`: Called each iteration of the background loop
    - `get_snapshot()`: Return current world snapshot
    - `send_command()`: Handle control commands

    The base class provides:
    - Event queue management
    - Background loop with stop event
    - Connect/disconnect lifecycle
    - Event subscription with timeout polling
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
        self._event_queue: asyncio.Queue[WorldEvent] | None = None
        self._loop_task: asyncio.Task[None] | None = None

    @property
    def visualization_config(self) -> VisualizationConfig | None:
        """Optional visualization configuration for the frontend."""
        return self._visualization_config

    @property
    def is_connected(self) -> bool:
        """Whether the source is connected."""
        return self._connected

    @property
    def is_paused(self) -> bool:
        """Whether the source is paused."""
        return self._paused

    async def connect(self) -> None:
        """Initialize source and start background loop."""
        self._connected = True
        self._stop_event = asyncio.Event()
        self._event_queue = asyncio.Queue(maxsize=self._event_queue_maxsize)
        await self._on_connect()
        self._loop_task = asyncio.create_task(self._run_loop())

    async def disconnect(self) -> None:
        """Stop background loop and clean up."""
        self._connected = False
        if self._stop_event:
            self._stop_event.set()
        if self._loop_task:
            self._loop_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._loop_task
            self._loop_task = None

    async def subscribe_events(self) -> AsyncIterator[WorldEvent]:
        """Stream events from the event queue."""
        if not self._stop_event or not self._event_queue:
            return
            yield  # pragma: no cover - makes this a proper empty async generator

        # Allow subclasses to emit initial events
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
        """Background loop that calls _tick_loop_body at configured intervals."""
        while self._connected and self._stop_event and not self._stop_event.is_set():
            await self._tick_loop_body()

            try:
                await asyncio.wait_for(
                    self._stop_event.wait(),
                    timeout=self._get_loop_interval(),
                )
                break  # Stop event was set
            except TimeoutError:
                continue

    async def _emit_event(self, event: WorldEvent) -> None:
        """Put an event on the queue."""
        if self._event_queue:
            await self._event_queue.put(event)

    # --- Hooks for subclasses ---

    async def _on_connect(self) -> None:
        """Called during connect, before starting the loop. Override to initialize."""
        pass

    async def _emit_initial_events(self) -> AsyncIterator[WorldEvent]:
        """Yield events to emit at start of subscription. Override as needed."""
        return
        yield  # pragma: no cover - makes this a proper empty async generator

    def _get_loop_interval(self) -> float:
        """Return interval between loop iterations. Override for dynamic intervals."""
        return self._tick_interval

    @abstractmethod
    async def _tick_loop_body(self) -> None:
        """Called each iteration of the background loop. Implement tick logic here."""
        ...

    @abstractmethod
    async def get_snapshot(self) -> WorldSnapshot:
        """Get current world snapshot."""
        ...

    @abstractmethod
    async def send_command(self, command: str, **kwargs: object) -> None:
        """Handle control commands."""
        ...
