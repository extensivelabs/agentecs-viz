import asyncio

import pytest

from agentecs_viz.protocol import SnapshotMessage
from agentecs_viz.sources.mock import MockWorldSource


@pytest.fixture
def source() -> MockWorldSource:
    return MockWorldSource(entity_count=10, tick_interval=0.1)


class TestMockWorldSource:
    async def test_connect_disconnect(self, source: MockWorldSource):
        await source.connect()
        assert source.is_connected
        assert source.get_current_tick() == 0
        await source.disconnect()
        assert not source.is_connected

    async def test_get_snapshot_current(self, source: MockWorldSource):
        await source.connect()
        try:
            snapshot = await source.get_snapshot()
            assert snapshot.tick == 0
            assert snapshot.entity_count == 10
            assert len(snapshot.entities) == 10
        finally:
            await source.disconnect()

    async def test_get_snapshot_historical(self, source: MockWorldSource):
        await source.connect()
        try:
            # Execute a few ticks manually
            await source.send_command("pause")
            for _ in range(5):
                await source.send_command("step")

            assert source.get_current_tick() == 5
            historical = await source.get_snapshot(0)
            assert historical.tick == 0
        finally:
            await source.disconnect()

    async def test_pause_resume(self, source: MockWorldSource):
        await source.connect()
        try:
            await source.send_command("pause")
            assert source.is_paused
            await source.send_command("resume")
            assert not source.is_paused
        finally:
            await source.disconnect()

    async def test_step(self, source: MockWorldSource):
        await source.connect()
        try:
            await source.send_command("pause")
            await source.send_command("step")
            assert source.get_current_tick() == 1
        finally:
            await source.disconnect()

    async def test_set_speed(self, source: MockWorldSource):
        await source.connect()
        try:
            await source.send_command("set_speed", ticks_per_second=10.0)
            assert source._tick_interval == pytest.approx(0.1)
        finally:
            await source.disconnect()

    async def test_subscribe_yields_events(self, source: MockWorldSource):
        await source.connect()
        try:
            events: list[SnapshotMessage] = []

            async def collect_events():
                async for event in source.subscribe():
                    if isinstance(event, SnapshotMessage):
                        events.append(event)
                    if len(events) >= 2:
                        break

            await asyncio.wait_for(collect_events(), timeout=5.0)
            assert len(events) >= 2
            assert all(isinstance(e, SnapshotMessage) for e in events)
        finally:
            await source.disconnect()

    async def test_visualization_config(self, source: MockWorldSource):
        assert source.visualization_config is not None
        assert source.visualization_config.world_name == "Mock World"

    async def test_history_store(self, source: MockWorldSource):
        await source.connect()
        try:
            await source.send_command("pause")
            for _ in range(3):
                await source.send_command("step")

            assert source.history.tick_count >= 3
            tick_range = source.history.get_tick_range()
            assert tick_range is not None
        finally:
            await source.disconnect()
