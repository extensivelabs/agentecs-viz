"""Replay world source for playing back recorded traces.

Reads from a HistoryStore and emits events as if playing back a recording.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import TYPE_CHECKING

from agentecs_viz.protocol import (
    HistoryInfoEvent,
    SeekCompleteEvent,
    TickEvent,
    WorldEvent,
)
from agentecs_viz.snapshot import WorldSnapshot
from agentecs_viz.sources._base import TickLoopSource

if TYPE_CHECKING:
    from agentecs.tracing import HistoryStore


class ReplayWorldSource(TickLoopSource):
    """World source that replays from a HistoryStore.

    Reads recorded ticks from a history store and emits them as events,
    allowing playback of recorded traces without a live world connection.

    Args:
        store: The history store to read from.
        tick_interval: Base interval between ticks in seconds (default 0.5).
        autoplay: Whether to start playing automatically on connect (default False).

    Example:
        store = FileHistoryStore(Path("trace.jsonl"), mode="r")
        source = ReplayWorldSource(store)
        await source.connect()

        async for event in source.subscribe_events():
            if isinstance(event, TickEvent):
                display(event.snapshot)
    """

    def __init__(
        self,
        store: HistoryStore,
        tick_interval: float = 0.5,
        autoplay: bool = False,
    ) -> None:
        super().__init__(tick_interval=tick_interval)
        self._store = store
        self._autoplay = autoplay
        self._paused = True  # Start paused (unlike base class default)
        self._playback_speed = 1.0
        self._current_tick: int | None = None
        self._pending_step = False
        self._pending_seek: int | None = None

    @property
    def store(self) -> HistoryStore:
        """The underlying history store."""
        return self._store

    @property
    def supports_replay(self) -> bool:
        """This source always supports replay."""
        return True

    @property
    def tick_range(self) -> tuple[int, int] | None:
        """Available tick range from the store."""
        return self._store.get_tick_range()

    @property
    def current_tick(self) -> int | None:
        """Current playback position."""
        return self._current_tick

    @property
    def playback_speed(self) -> float:
        """Current playback speed multiplier."""
        return self._playback_speed

    async def _on_connect(self) -> None:
        """Initialize replay source state."""
        tick_range = self._store.get_tick_range()
        if tick_range:
            self._current_tick = tick_range[0]
        else:
            self._current_tick = None
        self._paused = not self._autoplay

    async def get_snapshot(self) -> WorldSnapshot:
        """Get snapshot at current tick.

        Returns:
            WorldSnapshot at current playback position.

        Raises:
            RuntimeError: If no current tick is set or snapshot not found.
        """
        if self._current_tick is None:
            msg = "No current tick set"
            raise RuntimeError(msg)

        snapshot_dict = self._store.get_snapshot(self._current_tick)
        if snapshot_dict is None:
            msg = f"Snapshot not found for tick {self._current_tick}"
            raise RuntimeError(msg)

        return WorldSnapshot.model_validate(snapshot_dict)

    async def _emit_initial_events(self) -> AsyncIterator[WorldEvent]:
        """Emit initial history info and snapshot."""
        yield HistoryInfoEvent(
            supports_replay=True,
            tick_range=self.tick_range,
            is_paused=self._paused,
        )

        if self._current_tick is not None:
            try:
                snapshot = await self.get_snapshot()
                yield TickEvent(snapshot)
            except RuntimeError:
                pass

    def _get_loop_interval(self) -> float:
        """Return interval adjusted by playback speed."""
        return self._tick_interval / self._playback_speed

    async def _tick_loop_body(self) -> None:
        """Handle seek, step, and normal playback."""
        if self._pending_seek is not None:
            await self._do_seek(self._pending_seek)
            self._pending_seek = None
        elif self._pending_step:
            self._pending_step = False
            await self._advance_tick()
        elif not self._paused:
            await self._advance_tick()

    async def _advance_tick(self) -> None:
        """Advance to the next tick and emit event."""
        if self._current_tick is None:
            return

        tick_range = self._store.get_tick_range()
        if not tick_range:
            return

        next_tick = self._current_tick + 1
        if next_tick > tick_range[1]:
            self._paused = True
            await self._emit_event(
                HistoryInfoEvent(
                    supports_replay=True,
                    tick_range=tick_range,
                    is_paused=True,
                )
            )
            return

        snapshot_dict = self._store.get_snapshot(next_tick)
        if snapshot_dict is None:
            self._current_tick = next_tick
            return

        self._current_tick = next_tick
        snapshot = WorldSnapshot.model_validate(snapshot_dict)
        await self._emit_event(TickEvent(snapshot))

    async def _do_seek(self, tick: int) -> None:
        """Execute a seek operation."""
        tick_range = self._store.get_tick_range()
        if not tick_range:
            return

        tick = max(tick_range[0], min(tick, tick_range[1]))

        snapshot_dict = self._store.get_snapshot(tick)
        if snapshot_dict is None:
            return

        self._current_tick = tick
        snapshot = WorldSnapshot.model_validate(snapshot_dict)
        await self._emit_event(SeekCompleteEvent(tick, snapshot))
        await self._emit_event(TickEvent(snapshot))

    async def send_command(self, command: str, **kwargs: object) -> None:
        """Handle playback control commands.

        Commands:
        - "pause": Pause playback
        - "resume": Resume playback
        - "step": Advance one tick (when paused)
        - "seek": Jump to specific tick (tick=N)
        - "set_tick_rate": Change playback speed (ticks_per_second=N)
        - "set_speed": Set playback speed multiplier (speed=N)
        """
        if command == "pause":
            self._paused = True
            await self._emit_event(
                HistoryInfoEvent(
                    supports_replay=True,
                    tick_range=self.tick_range,
                    is_paused=True,
                )
            )
        elif command == "resume":
            self._paused = False
            await self._emit_event(
                HistoryInfoEvent(
                    supports_replay=True,
                    tick_range=self.tick_range,
                    is_paused=False,
                )
            )
        elif command == "step":
            if self._paused:
                self._pending_step = True
        elif command == "seek":
            tick = kwargs.get("tick")
            if isinstance(tick, int):
                self._paused = True
                self._pending_seek = tick
        elif command == "set_tick_rate":
            tps = kwargs.get("ticks_per_second", 1.0)
            if isinstance(tps, int | float) and tps > 0:
                self._tick_interval = 1.0 / tps
        elif command == "set_speed":
            speed = kwargs.get("speed", 1.0)
            if isinstance(speed, int | float) and speed > 0:
                self._playback_speed = float(speed)

    async def seek(self, tick: int) -> WorldSnapshot | None:
        """Seek to a specific tick.

        Args:
            tick: The tick to seek to.

        Returns:
            The snapshot at that tick, or None if not available.

        Note:
            This automatically pauses playback.
        """
        await self.send_command("seek", tick=tick)

        # Wait briefly for seek to complete
        await asyncio.sleep(0.1)

        if self._current_tick is not None:
            try:
                return await self.get_snapshot()
            except RuntimeError:
                return None
        return None
