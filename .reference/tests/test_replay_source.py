"""Tests for ReplayWorldSource."""

import asyncio
import contextlib

import pytest
from agentecs.tracing import TickRecord

from agentecs_viz.history import InMemoryHistoryStore
from agentecs_viz.protocol import (
    HistoryInfoEvent,
    SeekCompleteEvent,
    TickEvent,
    WorldStateSource,
)
from agentecs_viz.sources.replay import ReplayWorldSource


@pytest.fixture
def store_with_ticks() -> InMemoryHistoryStore:
    """Create a store with sample ticks."""
    store = InMemoryHistoryStore(max_ticks=100)
    for i in range(5):
        record = TickRecord(
            tick=i,
            timestamp=float(i),
            snapshot={
                "tick": i,
                "entity_count": i + 1,
                "entities": [{"id": j} for j in range(i + 1)],
            },
            events=[{"type": f"event_{i}"}],
        )
        store.record_tick(record)
    return store


@pytest.fixture
def empty_store() -> InMemoryHistoryStore:
    """Create an empty store."""
    return InMemoryHistoryStore(max_ticks=100)


class TestReplayWorldSource:
    """Test ReplayWorldSource functionality."""

    def test_implements_protocol(self, store_with_ticks: InMemoryHistoryStore) -> None:
        """ReplayWorldSource implements WorldStateSource protocol."""
        source = ReplayWorldSource(store_with_ticks)
        assert isinstance(source, WorldStateSource)

    def test_supports_replay(self, store_with_ticks: InMemoryHistoryStore) -> None:
        """supports_replay is always True."""
        source = ReplayWorldSource(store_with_ticks)
        assert source.supports_replay is True

    def test_initial_state(self, store_with_ticks: InMemoryHistoryStore) -> None:
        """Source starts disconnected and paused."""
        source = ReplayWorldSource(store_with_ticks)
        assert source.is_connected is False
        assert source.is_paused is True
        assert source.current_tick is None

    @pytest.mark.asyncio
    async def test_connect_sets_to_first_tick(self, store_with_ticks: InMemoryHistoryStore) -> None:
        """Connect sets current tick to first available tick."""
        source = ReplayWorldSource(store_with_ticks)
        await source.connect()
        try:
            assert source.is_connected is True
            assert source.current_tick == 0  # First tick in range
            assert source.tick_range == (0, 4)
        finally:
            await source.disconnect()

    @pytest.mark.asyncio
    async def test_connect_empty_store(self, empty_store: InMemoryHistoryStore) -> None:
        """Connect with empty store sets current_tick to None."""
        source = ReplayWorldSource(empty_store)
        await source.connect()
        try:
            assert source.is_connected is True
            assert source.current_tick is None
            assert source.tick_range is None
        finally:
            await source.disconnect()

    @pytest.mark.asyncio
    async def test_disconnect(self, store_with_ticks: InMemoryHistoryStore) -> None:
        """Disconnect cleans up properly."""
        source = ReplayWorldSource(store_with_ticks)
        await source.connect()
        await source.disconnect()
        assert source.is_connected is False

    @pytest.mark.asyncio
    async def test_get_snapshot_returns_current_tick(
        self, store_with_ticks: InMemoryHistoryStore
    ) -> None:
        """get_snapshot returns snapshot at current tick."""
        source = ReplayWorldSource(store_with_ticks)
        await source.connect()
        try:
            snapshot = await source.get_snapshot()
            assert snapshot.tick == 0
            assert snapshot.entity_count == 1
        finally:
            await source.disconnect()

    @pytest.mark.asyncio
    async def test_get_snapshot_no_tick_raises(self, empty_store: InMemoryHistoryStore) -> None:
        """get_snapshot raises when no current tick."""
        source = ReplayWorldSource(empty_store)
        await source.connect()
        try:
            with pytest.raises(RuntimeError, match="No current tick"):
                await source.get_snapshot()
        finally:
            await source.disconnect()

    @pytest.mark.asyncio
    async def test_seek_to_valid_tick(self, store_with_ticks: InMemoryHistoryStore) -> None:
        """Seek jumps to specified tick."""
        source = ReplayWorldSource(store_with_ticks)
        await source.connect()
        try:
            snapshot = await source.seek(3)
            assert snapshot is not None
            assert snapshot.tick == 3
            assert source.current_tick == 3
            assert source.is_paused is True  # Seek pauses
        finally:
            await source.disconnect()

    @pytest.mark.asyncio
    async def test_seek_clamps_to_max(self, store_with_ticks: InMemoryHistoryStore) -> None:
        """Seek past end clamps to max tick."""
        source = ReplayWorldSource(store_with_ticks)
        await source.connect()
        try:
            # Seek past end should clamp to max
            snapshot = await source.seek(100)
            assert snapshot is not None
            assert source.current_tick == 4  # Max tick
        finally:
            await source.disconnect()

    @pytest.mark.asyncio
    async def test_seek_clamps_to_min(self, store_with_ticks: InMemoryHistoryStore) -> None:
        """Seek before start clamps to min tick."""
        # Use faster tick interval for testing
        source = ReplayWorldSource(store_with_ticks, tick_interval=0.05)
        await source.connect()
        try:
            # Seek before start should clamp to min
            snapshot = await source.seek(-5)
            assert snapshot is not None
            assert source.current_tick == 0  # Min tick
        finally:
            await source.disconnect()

    @pytest.mark.asyncio
    async def test_pause_resume(self, store_with_ticks: InMemoryHistoryStore) -> None:
        """Pause and resume commands work."""
        source = ReplayWorldSource(store_with_ticks)
        await source.connect()
        try:
            assert source.is_paused is True

            await source.send_command("resume")
            assert source.is_paused is False

            await source.send_command("pause")
            assert source.is_paused is True
        finally:
            await source.disconnect()

    @pytest.mark.asyncio
    async def test_step_advances_tick(self, store_with_ticks: InMemoryHistoryStore) -> None:
        """Step advances one tick when paused."""
        source = ReplayWorldSource(store_with_ticks)
        await source.connect()
        try:
            assert source.current_tick == 0
            assert source.is_paused is True

            # Step should advance one tick
            await source.send_command("step")
            await asyncio.sleep(0.15)  # Wait for step to process
            assert source.current_tick == 1
            assert source.is_paused is True  # Still paused
        finally:
            await source.disconnect()

    @pytest.mark.asyncio
    async def test_set_speed(self, store_with_ticks: InMemoryHistoryStore) -> None:
        """set_speed command changes playback speed."""
        source = ReplayWorldSource(store_with_ticks)
        await source.connect()
        try:
            assert source.playback_speed == 1.0

            await source.send_command("set_speed", speed=2.0)
            assert source.playback_speed == 2.0

            await source.send_command("set_speed", speed=0.5)
            assert source.playback_speed == 0.5

            # Invalid speed ignored
            await source.send_command("set_speed", speed=-1)
            assert source.playback_speed == 0.5
        finally:
            await source.disconnect()

    @pytest.mark.asyncio
    async def test_subscribe_events_yields_initial_events(
        self, store_with_ticks: InMemoryHistoryStore
    ) -> None:
        """subscribe_events yields initial HistoryInfoEvent and TickEvent."""
        source = ReplayWorldSource(store_with_ticks)
        await source.connect()
        try:
            events: list = []
            async for event in source.subscribe_events():
                events.append(event)
                if len(events) >= 2:
                    break

            assert len(events) == 2
            assert isinstance(events[0], HistoryInfoEvent)
            assert events[0].supports_replay is True
            assert events[0].tick_range == (0, 4)
            assert events[0].is_paused is True

            assert isinstance(events[1], TickEvent)
            assert events[1].snapshot.tick == 0
        finally:
            await source.disconnect()

    @pytest.mark.asyncio
    async def test_subscribe_events_yields_on_step(
        self, store_with_ticks: InMemoryHistoryStore
    ) -> None:
        """subscribe_events yields TickEvent when stepping."""
        source = ReplayWorldSource(store_with_ticks)
        await source.connect()
        try:
            events: list = []

            async def collect_events() -> None:
                async for event in source.subscribe_events():
                    events.append(event)
                    if len(events) >= 4:
                        break

            task = asyncio.create_task(collect_events())

            # Wait for initial events
            await asyncio.sleep(0.2)

            # Step twice
            await source.send_command("step")
            await asyncio.sleep(0.2)
            await source.send_command("step")
            await asyncio.sleep(0.2)

            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

            # Should have: HistoryInfo, initial Tick, step Tick, step Tick
            tick_events = [e for e in events if isinstance(e, TickEvent)]
            assert len(tick_events) >= 2  # At least initial + one step
        finally:
            await source.disconnect()

    @pytest.mark.asyncio
    async def test_subscribe_events_yields_seek_complete(
        self, store_with_ticks: InMemoryHistoryStore
    ) -> None:
        """subscribe_events yields SeekCompleteEvent after seek."""
        source = ReplayWorldSource(store_with_ticks)
        await source.connect()
        try:
            events: list = []
            got_seek = asyncio.Event()

            async def collect_events() -> None:
                async for event in source.subscribe_events():
                    events.append(event)
                    if isinstance(event, SeekCompleteEvent):
                        got_seek.set()
                        break

            task = asyncio.create_task(collect_events())
            await asyncio.sleep(0.15)

            # Seek to tick 3
            await source.send_command("seek", tick=3)

            # Wait for seek event with timeout
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(got_seek.wait(), timeout=1.0)

            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

            seek_events = [e for e in events if isinstance(e, SeekCompleteEvent)]
            assert len(seek_events) >= 1
            assert seek_events[0].tick == 3
        finally:
            await source.disconnect()

    @pytest.mark.asyncio
    async def test_autoplay(self, store_with_ticks: InMemoryHistoryStore) -> None:
        """autoplay=True starts playing on connect."""
        source = ReplayWorldSource(store_with_ticks, autoplay=True, tick_interval=0.05)
        await source.connect()
        try:
            assert source.is_paused is False
            # Let it play for a bit
            await asyncio.sleep(0.2)
            # Should have advanced past tick 0
            assert source.current_tick is not None
            assert source.current_tick > 0
        finally:
            await source.disconnect()

    @pytest.mark.asyncio
    async def test_playback_stops_at_end(self, store_with_ticks: InMemoryHistoryStore) -> None:
        """Playback pauses at end of recording."""
        source = ReplayWorldSource(store_with_ticks, autoplay=True, tick_interval=0.02)
        await source.connect()
        try:
            # Let it play through all 5 ticks
            await asyncio.sleep(0.3)
            assert source.current_tick == 4  # Last tick
            assert source.is_paused is True  # Paused at end
        finally:
            await source.disconnect()

    @pytest.mark.asyncio
    async def test_store_property(self, store_with_ticks: InMemoryHistoryStore) -> None:
        """Store property returns the underlying store."""
        source = ReplayWorldSource(store_with_ticks)
        assert source.store is store_with_ticks
