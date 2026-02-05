"""Tests for MockWorldSource."""

import pytest

from agentecs_viz.protocol import TickEvent, WorldStateSource
from agentecs_viz.sources.mock import MockWorldSource


class TestMockWorldSource:
    """Tests for MockWorldSource."""

    def test_implements_protocol(self) -> None:
        """MockWorldSource implements WorldStateSource protocol."""
        source = MockWorldSource()
        assert isinstance(source, WorldStateSource)

    @pytest.mark.asyncio
    async def test_connect_disconnect(self) -> None:
        """Source can connect and disconnect."""
        source = MockWorldSource(entity_count=10)
        assert not source.is_connected

        await source.connect()
        assert source.is_connected

        await source.disconnect()
        assert not source.is_connected

    @pytest.mark.asyncio
    async def test_get_snapshot(self) -> None:
        """Source returns snapshot with entities."""
        source = MockWorldSource(entity_count=25)
        await source.connect()

        snapshot = await source.get_snapshot()
        assert snapshot.entity_count == 25
        assert len(snapshot.entities) == 25
        assert snapshot.tick == 0

        await source.disconnect()

    @pytest.mark.asyncio
    async def test_entities_have_components(self) -> None:
        """Generated entities have components matching archetype."""
        source = MockWorldSource(entity_count=10)
        await source.connect()

        snapshot = await source.get_snapshot()
        for entity in snapshot.entities:
            # Each entity should have components matching its archetype
            component_types = {c.type_short for c in entity.components}
            archetype_set = set(entity.archetype)
            assert component_types == archetype_set

        await source.disconnect()

    @pytest.mark.asyncio
    async def test_pause_resume(self) -> None:
        """Source can be paused and resumed."""
        source = MockWorldSource(entity_count=5)
        await source.connect()

        await source.send_command("pause")
        snapshot1 = await source.get_snapshot()
        assert snapshot1.metadata.get("paused") is True

        await source.send_command("resume")
        snapshot2 = await source.get_snapshot()
        assert snapshot2.metadata.get("paused") is False

        await source.disconnect()

    @pytest.mark.asyncio
    async def test_step_when_paused(self) -> None:
        """Step command advances tick when paused."""
        source = MockWorldSource(entity_count=5)
        await source.connect()

        await source.send_command("pause")
        assert (await source.get_snapshot()).tick == 0

        await source.send_command("step")
        assert (await source.get_snapshot()).tick == 1

        await source.send_command("step")
        assert (await source.get_snapshot()).tick == 2

        await source.disconnect()

    @pytest.mark.asyncio
    async def test_subscribe_events_yields_tick_events(self) -> None:
        """Event subscription yields tick events."""
        source = MockWorldSource(entity_count=5, tick_interval=0.01)
        await source.connect()

        events_received = 0
        async for event in source.subscribe_events():
            assert isinstance(event, TickEvent)
            assert event.snapshot.tick > 0
            events_received += 1
            if events_received >= 3:
                await source.disconnect()
                break

        assert events_received == 3

    @pytest.mark.asyncio
    async def test_archetypes_in_snapshot(self) -> None:
        """Snapshot includes unique archetypes."""
        source = MockWorldSource(entity_count=20)
        await source.connect()

        snapshot = await source.get_snapshot()
        # Should have multiple unique archetypes
        assert len(snapshot.archetypes) > 0
        # Each archetype should be a tuple of strings
        for arch in snapshot.archetypes:
            assert isinstance(arch, tuple)
            assert all(isinstance(t, str) for t in arch)

        await source.disconnect()
