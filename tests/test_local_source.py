"""Tests for LocalWorldSource.

Tests verify that LocalWorldSource correctly wraps a World instance and
controls it by calling tick_async() at configured intervals.
"""

import asyncio
from dataclasses import dataclass

import pytest
from agentecs import World
from agentecs_viz.protocol import TickEvent, WorldStateSource
from agentecs_viz.sources.local import LocalWorldSource


@dataclass
class Position:
    """Test component: position in 2D space."""

    x: float
    y: float


@dataclass
class Velocity:
    """Test component: velocity vector."""

    dx: float
    dy: float


@dataclass
class Name:
    """Test component: entity name."""

    value: str


class TestLocalWorldSource:
    """Tests for LocalWorldSource."""

    def test_implements_protocol(self) -> None:
        """LocalWorldSource implements WorldStateSource protocol.

        Why: Protocol compliance ensures compatibility with HistoryCapturingSource.
        """
        world = World()
        source = LocalWorldSource(world)
        assert isinstance(source, WorldStateSource)

    @pytest.mark.asyncio
    async def test_connect_disconnect(self) -> None:
        """Source can connect and disconnect.

        Why: Lifecycle management is critical for background loop control.
        """
        world = World()
        source = LocalWorldSource(world)
        assert not source.is_connected

        await source.connect()
        assert source.is_connected

        await source.disconnect()
        assert not source.is_connected

    @pytest.mark.asyncio
    async def test_empty_world_snapshot(self) -> None:
        """Snapshot of empty world has correct metadata.

        Why: Verifies get_snapshot() works before any ticks.
        """
        world = World()
        source = LocalWorldSource(world)
        await source.connect()

        snapshot = await source.get_snapshot()
        # World has system entities (WORLD, CLOCK) but no user entities
        assert snapshot.tick == 0
        assert snapshot.metadata["source"] == "local"

        await source.disconnect()

    @pytest.mark.asyncio
    async def test_snapshot_with_entities(self) -> None:
        """Snapshot includes spawned entities with correct archetypes.

        Why: Entity and component data must be correctly extracted from World.
        """
        world = World()
        entity1 = world.spawn(Position(10.0, 20.0), Velocity(1.0, 0.0))
        entity2 = world.spawn(Position(5.0, 5.0), Name("test"))

        source = LocalWorldSource(world)
        await source.connect()

        snapshot = await source.get_snapshot()

        # Find our entities by index (excluding system entities)
        entity_ids = (entity1.index, entity2.index)
        user_entities = [e for e in snapshot.entities if e.id in entity_ids]
        assert len(user_entities) == 2

        # Check entity1 has Position and Velocity
        e1 = next(e for e in user_entities if e.id == entity1.index)
        assert "Position" in e1.archetype
        assert "Velocity" in e1.archetype
        assert len(e1.components) == 2

        # Check entity2 has Position and Name
        e2 = next(e for e in user_entities if e.id == entity2.index)
        assert "Position" in e2.archetype
        assert "Name" in e2.archetype

        await source.disconnect()

    @pytest.mark.asyncio
    async def test_component_data_serialized(self) -> None:
        """Component data is properly serialized to dict.

        Why: Frontend requires JSON-serializable component data.
        """
        world = World()
        world.spawn(Position(42.0, 99.0))

        source = LocalWorldSource(world)
        await source.connect()

        snapshot = await source.get_snapshot()

        # Find entity with Position
        entity = next(
            (e for e in snapshot.entities if "Position" in e.archetype),
            None,
        )
        assert entity is not None

        pos_comp = next(c for c in entity.components if c.type_short == "Position")
        assert pos_comp.data["x"] == 42.0
        assert pos_comp.data["y"] == 99.0

        await source.disconnect()

    @pytest.mark.asyncio
    async def test_archetypes_collected(self) -> None:
        """Snapshot includes unique archetypes from all entities.

        Why: Archetype list is used for filtering and visualization grouping.
        """
        world = World()
        world.spawn(Position(0, 0), Velocity(0, 0))
        world.spawn(Position(1, 1), Velocity(1, 1))  # Same archetype
        world.spawn(Position(2, 2), Name("different"))  # Different archetype

        source = LocalWorldSource(world)
        await source.connect()

        snapshot = await source.get_snapshot()

        # Should have at least 2 unique archetypes for user entities
        user_archetypes = [a for a in snapshot.archetypes if "Position" in a or "Name" in a]
        assert len(user_archetypes) >= 2

        await source.disconnect()

    @pytest.mark.asyncio
    async def test_automatic_ticking(self) -> None:
        """Connected source automatically executes ticks.

        Why: Core functionality - source controls World ticking.
        """
        world = World()
        world.spawn(Position(0, 0))

        # Use fast tick interval for testing
        source = LocalWorldSource(world, tick_interval=0.05)
        await source.connect()

        # Collect events until we get at least 2 ticks
        events_received: list[TickEvent] = []

        async def collect_events() -> None:
            async for event in source.subscribe_events():
                if isinstance(event, TickEvent):
                    events_received.append(event)
                    if len(events_received) >= 2:
                        break

        # Wait for ticks with timeout
        try:
            await asyncio.wait_for(collect_events(), timeout=1.0)
        finally:
            await source.disconnect()

        assert len(events_received) >= 2
        assert events_received[0].snapshot.tick == 1
        assert events_received[1].snapshot.tick == 2

    @pytest.mark.asyncio
    async def test_pause_stops_automatic_ticking(self) -> None:
        """When paused, automatic ticking stops.

        Why: Pause command must stop background tick loop.
        """
        world = World()
        source = LocalWorldSource(world, tick_interval=0.05)
        await source.connect()

        # Pause immediately
        await source.send_command("pause")
        assert source.is_paused

        # Wait a bit - should not tick
        await asyncio.sleep(0.15)

        snapshot = await source.get_snapshot()
        assert snapshot.metadata["paused"] is True
        # Tick counter should be 0 (no ticks while paused)
        assert snapshot.tick == 0

        await source.disconnect()

    @pytest.mark.asyncio
    async def test_step_when_paused(self) -> None:
        """Step command executes single tick when paused.

        Why: Step enables manual tick-by-tick debugging.
        """
        world = World()
        source = LocalWorldSource(world)
        await source.connect()

        await source.send_command("pause")
        assert (await source.get_snapshot()).tick == 0

        await source.send_command("step")
        assert (await source.get_snapshot()).tick == 1

        await source.send_command("step")
        assert (await source.get_snapshot()).tick == 2

        await source.disconnect()

    @pytest.mark.asyncio
    async def test_resume_restarts_ticking(self) -> None:
        """Resume command restarts automatic ticking after pause.

        Why: Users need to resume after pausing for debugging.
        """
        world = World()
        source = LocalWorldSource(world, tick_interval=0.05)
        await source.connect()

        # Pause, then resume
        await source.send_command("pause")
        assert source.is_paused
        await source.send_command("resume")
        assert not source.is_paused

        # Should tick after resume
        events_received: list[TickEvent] = []

        async def collect_events() -> None:
            async for event in source.subscribe_events():
                if isinstance(event, TickEvent):
                    events_received.append(event)
                    if len(events_received) >= 1:
                        break

        try:
            await asyncio.wait_for(collect_events(), timeout=1.0)
        finally:
            await source.disconnect()

        assert len(events_received) >= 1

    @pytest.mark.asyncio
    async def test_set_tick_rate(self) -> None:
        """set_tick_rate command changes tick interval.

        Why: Users may want faster/slower visualization.
        """
        world = World()
        source = LocalWorldSource(world, tick_interval=1.0)
        await source.connect()

        # Change to 10 ticks per second (0.1s interval)
        await source.send_command("set_tick_rate", ticks_per_second=10.0)
        assert source._tick_interval == 0.1

        await source.disconnect()
