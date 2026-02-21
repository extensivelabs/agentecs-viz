import asyncio

import pytest

from agentecs_viz.protocol import (
    AnyServerEvent,
    ErrorEventMessage,
    SnapshotMessage,
    SpanEventMessage,
)
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

    async def test_supports_history(self, source: MockWorldSource):
        assert source.supports_history is True

    async def test_tick_range_populated(self, source: MockWorldSource):
        await source.connect()
        try:
            await source.send_command("pause")
            for _ in range(3):
                await source.send_command("step")

            tick_range = source.tick_range
            assert tick_range is not None
            assert tick_range[0] == 0
            assert tick_range[1] == 3
        finally:
            await source.disconnect()

    async def test_tick_range_none_before_connect(self):
        source = MockWorldSource(entity_count=5)
        assert source.tick_range is None

    async def test_set_speed_rejects_bool(self, source: MockWorldSource):
        await source.connect()
        try:
            original_interval = source._tick_interval
            await source.send_command("set_speed", ticks_per_second=True)
            assert source._tick_interval == original_interval
        finally:
            await source.disconnect()

    async def test_reconnect_resets_tick_and_history(self):
        source = MockWorldSource(entity_count=5)
        await source.connect()
        try:
            await source.send_command("pause")
            for _ in range(5):
                await source.send_command("step")
            assert source.get_current_tick() == 5
            assert source.history.tick_count > 0
            assert source.is_paused is True
        finally:
            await source.disconnect()

        # Reconnect should reset
        await source.connect()
        try:
            assert source.get_current_tick() == 0
            assert source.is_paused is False
            assert source.history.tick_count == 1  # only tick 0
            tick_range = source.tick_range
            assert tick_range is not None
            assert tick_range == (0, 0)
        finally:
            await source.disconnect()

    async def test_error_generation_over_ticks(
        self, source: MockWorldSource, monkeypatch: pytest.MonkeyPatch
    ):
        """Over many ticks, error events are generated deterministically."""
        # Force random.random() to always return 0.0 so every tick produces an error
        monkeypatch.setattr("agentecs_viz.sources.mock.random.random", lambda: 0.0)
        await source.connect()
        try:
            await source.send_command("pause")
            for _ in range(10):
                await source.send_command("step")

            errors = source.history.get_errors(0, 10)
            assert len(errors) == 10
            assert all(isinstance(e, ErrorEventMessage) for e in errors)
        finally:
            await source.disconnect()

    async def test_errors_in_event_subscription(
        self, source: MockWorldSource, monkeypatch: pytest.MonkeyPatch
    ):
        """ErrorEventMessages appear in the event subscription stream."""
        # Force errors on every tick so the assertion is deterministic
        monkeypatch.setattr("agentecs_viz.sources.mock.random.random", lambda: 0.0)
        await source.connect()
        try:
            errors: list[ErrorEventMessage] = []

            async def collect_events():
                async for event in source.subscribe():
                    if isinstance(event, ErrorEventMessage):
                        errors.append(event)
                    if len(errors) >= 3:
                        break

            await asyncio.wait_for(collect_events(), timeout=5.0)
            assert len(errors) >= 3
            assert all(isinstance(e, ErrorEventMessage) for e in errors)
        finally:
            await source.disconnect()

    async def test_span_generation(self, source: MockWorldSource, monkeypatch: pytest.MonkeyPatch):
        """Over many ticks with forced span generation, spans are created."""
        monkeypatch.setattr("agentecs_viz.sources.mock.random.random", lambda: 0.0)
        await source.connect()
        try:
            await source.send_command("pause")
            for _ in range(5):
                await source.send_command("step")

            spans = source.history.get_spans(0, 5)
            assert len(spans) > 0
            assert all(isinstance(s, SpanEventMessage) for s in spans)
        finally:
            await source.disconnect()

    async def test_span_has_required_attributes(
        self, source: MockWorldSource, monkeypatch: pytest.MonkeyPatch
    ):
        """Generated spans have agentecs.tick and agentecs.entity_id attributes."""
        monkeypatch.setattr("agentecs_viz.sources.mock.random.random", lambda: 0.0)
        await source.connect()
        try:
            await source.send_command("pause")
            await source.send_command("step")

            spans = source.history.get_spans(1, 1)
            assert len(spans) > 0
            for span in spans:
                assert "agentecs.tick" in span.attributes
                assert "agentecs.entity_id" in span.attributes
                assert span.attributes["agentecs.tick"] == 1
        finally:
            await source.disconnect()

    async def test_span_trace_hierarchy(
        self, source: MockWorldSource, monkeypatch: pytest.MonkeyPatch
    ):
        """Generated spans form parent-child hierarchy with shared trace_id."""
        monkeypatch.setattr("agentecs_viz.sources.mock.random.random", lambda: 0.0)
        await source.connect()
        try:
            await source.send_command("pause")
            await source.send_command("step")

            spans = source.history.get_spans(1, 1)
            assert len(spans) >= 2

            root_spans = [s for s in spans if s.parent_span_id is None]
            child_spans = [s for s in spans if s.parent_span_id is not None]
            assert len(root_spans) >= 1
            assert len(child_spans) >= 1

            root = root_spans[0]
            for child in child_spans:
                if child.trace_id == root.trace_id:
                    assert child.parent_span_id == root.span_id
        finally:
            await source.disconnect()

    async def test_spans_in_event_stream(
        self, source: MockWorldSource, monkeypatch: pytest.MonkeyPatch
    ):
        """SpanEventMessages appear in the event subscription stream."""
        monkeypatch.setattr("agentecs_viz.sources.mock.random.random", lambda: 0.0)
        await source.connect()
        try:
            spans: list[SpanEventMessage] = []

            async def collect_events():
                async for event in source.subscribe():
                    if isinstance(event, SpanEventMessage):
                        spans.append(event)
                    if len(spans) >= 3:
                        break

            await asyncio.wait_for(collect_events(), timeout=5.0)
            assert len(spans) >= 3
        finally:
            await source.disconnect()

    async def test_two_subscribers_receive_all_events(self, source: MockWorldSource):
        """Two concurrent subscribers each receive every emitted event."""
        await source.connect()
        try:
            await source.send_command("pause")
            events_a: list[SnapshotMessage] = []
            events_b: list[SnapshotMessage] = []
            target = 3

            async def collect(dest: list[SnapshotMessage]):
                async for event in source.subscribe():
                    if isinstance(event, SnapshotMessage):
                        dest.append(event)
                    if len(dest) >= target:
                        break

            # Start both collectors, wait for registration
            task = asyncio.gather(collect(events_a), collect(events_b))
            while len(source._subscribers) < 2:
                await asyncio.sleep(0)

            # Deterministically step to produce events
            for _ in range(target):
                await source.send_command("step")

            await asyncio.wait_for(task, timeout=5.0)
            assert len(events_a) >= target
            assert len(events_b) >= target
            ticks_a = [e.tick for e in events_a[:target]]
            ticks_b = [e.tick for e in events_b[:target]]
            assert ticks_a == ticks_b
        finally:
            await source.disconnect()

    async def test_subscriber_cleanup_on_generator_close(self, source: MockWorldSource):
        """Subscriber queue is removed after the async generator closes."""
        await source.connect()
        try:
            await source.send_command("pause")
            assert len(source._subscribers) == 0

            collected: list[SnapshotMessage] = []

            async def consume_one():
                async for event in source.subscribe():
                    if isinstance(event, SnapshotMessage):
                        collected.append(event)
                        break

            task = asyncio.create_task(consume_one())
            await asyncio.sleep(0)
            assert len(source._subscribers) == 1

            # Produce an event for the subscriber to consume and break
            await source.send_command("step")
            await asyncio.wait_for(task, timeout=5.0)
            await asyncio.sleep(0)
            assert len(collected) == 1
            assert len(source._subscribers) == 0
        finally:
            await source.disconnect()

    async def test_subscriber_queue_full_drops_event(self, caplog: pytest.LogCaptureFixture):
        """When a subscriber queue is full, events are dropped with a warning."""
        import logging

        caplog.set_level(logging.WARNING, logger="agentecs_viz.sources._base")
        source = MockWorldSource(entity_count=5, tick_interval=0.1)
        source._event_queue_maxsize = 1
        await source.connect()
        try:
            await source.send_command("pause")

            queue: asyncio.Queue[AnyServerEvent] = asyncio.Queue(maxsize=1)
            source._subscribers.add(queue)

            snapshot = await source.get_snapshot()
            msg = SnapshotMessage(tick=snapshot.tick, snapshot=snapshot)
            await source._emit_event(msg)  # fills queue (size 1)
            await source._emit_event(msg)  # overflow -> warning

            assert "Subscriber queue full" in caplog.text
            source._subscribers.discard(queue)
        finally:
            await source.disconnect()
