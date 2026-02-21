from collections.abc import AsyncIterator
from typing import Any

from agentecs_viz.protocol import (
    AnyServerEvent,
    DeltaMessage,
    ErrorEventMessage,
    ErrorMessage,
    ErrorSeverity,
    MetadataMessage,
    PauseCommand,
    ResumeCommand,
    SeekCommand,
    SetSpeedCommand,
    SnapshotMessage,
    SpanEventMessage,
    SpanStatus,
    StepCommand,
    TickUpdateMessage,
    WorldStateSource,
)
from agentecs_viz.snapshot import TickDelta, WorldSnapshot


class TestClientMessages:
    def test_seek(self):
        msg = SeekCommand(tick=42)
        assert msg.command == "seek"
        assert msg.tick == 42

    def test_set_speed(self):
        msg = SetSpeedCommand(ticks_per_second=5.0)
        assert msg.command == "set_speed"
        assert msg.ticks_per_second == 5.0

    def test_pause(self):
        msg = PauseCommand()
        assert msg.command == "pause"

    def test_resume(self):
        msg = ResumeCommand()
        assert msg.command == "resume"

    def test_step(self):
        msg = StepCommand()
        assert msg.command == "step"

    def test_roundtrip(self):
        msg = SeekCommand(tick=10)
        data = msg.model_dump()
        restored = SeekCommand.model_validate(data)
        assert restored.tick == 10


class TestServerMessages:
    def test_snapshot_message(self):
        ws = WorldSnapshot(tick=5)
        msg = SnapshotMessage(tick=5, snapshot=ws)
        assert msg.type == "snapshot"
        assert msg.snapshot.tick == 5

    def test_delta_message(self):
        delta = TickDelta(tick=6)
        msg = DeltaMessage(tick=6, delta=delta)
        assert msg.type == "delta"
        assert msg.delta.tick == 6

    def test_error_message(self):
        msg = ErrorMessage(tick=1, message="something failed")
        assert msg.type == "error"
        assert msg.message == "something failed"

    def test_tick_update_message(self):
        msg = TickUpdateMessage(tick=10, entity_count=50, is_paused=False)
        assert msg.type == "tick_update"
        assert msg.entity_count == 50

    def test_metadata_message(self):
        msg = MetadataMessage(tick=0, supports_history=True)
        assert msg.type == "metadata"
        assert msg.supports_history is True
        assert msg.config is None

    def test_snapshot_roundtrip(self):
        ws = WorldSnapshot(tick=1)
        msg = SnapshotMessage(tick=1, snapshot=ws)
        data = msg.model_dump()
        restored = SnapshotMessage.model_validate(data)
        assert restored.tick == 1


class TestErrorEventMessage:
    def test_creation(self):
        msg = ErrorEventMessage(tick=5, entity_id=42, message="something failed")
        assert msg.type == "error_event"
        assert msg.tick == 5
        assert msg.entity_id == 42
        assert msg.message == "something failed"

    def test_default_severity(self):
        msg = ErrorEventMessage(tick=1, entity_id=1, message="test")
        assert msg.severity == ErrorSeverity.warning

    def test_explicit_severity(self):
        msg = ErrorEventMessage(
            tick=1, entity_id=1, message="critical issue", severity=ErrorSeverity.critical
        )
        assert msg.severity == ErrorSeverity.critical

    def test_roundtrip_serialization(self):
        msg = ErrorEventMessage(tick=3, entity_id=7, message="timeout", severity=ErrorSeverity.info)
        data = msg.model_dump()
        restored = ErrorEventMessage.model_validate(data)
        assert restored.tick == 3
        assert restored.entity_id == 7
        assert restored.severity == ErrorSeverity.info

    def test_severity_enum_values(self):
        assert ErrorSeverity.critical == "critical"
        assert ErrorSeverity.warning == "warning"
        assert ErrorSeverity.info == "info"


class _StubSource(WorldStateSource):
    """Minimal concrete subclass to test Protocol default property values."""

    async def connect(self) -> None: ...
    async def disconnect(self) -> None: ...
    async def get_snapshot(self, tick: int | None = None) -> WorldSnapshot:
        return WorldSnapshot(tick=0)

    def get_current_tick(self) -> int:
        return 0

    def subscribe(self) -> AsyncIterator[AnyServerEvent]:
        async def _empty() -> AsyncIterator[AnyServerEvent]:
            return
            yield  # noqa: RET504

        return _empty()

    async def send_command(self, command: str, **kwargs: Any) -> None: ...
    @property
    def is_connected(self) -> bool:
        return True


class TestWorldStateSourceProtocol:
    def test_isinstance_check(self):
        """WorldStateSource is a runtime-checkable Protocol."""
        assert isinstance(_StubSource(), WorldStateSource)

    def test_default_is_paused(self):
        assert _StubSource().is_paused is False

    def test_default_supports_history(self):
        assert _StubSource().supports_history is False

    def test_default_tick_range(self):
        assert _StubSource().tick_range is None

    def test_default_visualization_config(self):
        assert _StubSource().visualization_config is None


class TestSpanEventMessage:
    def test_creation(self):
        msg = SpanEventMessage(
            span_id="abc123",
            trace_id="trace456",
            name="llm.call",
            start_time=1000.0,
            end_time=1000.5,
            attributes={"agentecs.tick": 5, "agentecs.entity_id": 42},
        )
        assert msg.type == "span_event"
        assert msg.span_id == "abc123"
        assert msg.trace_id == "trace456"
        assert msg.parent_span_id is None
        assert msg.name == "llm.call"
        assert msg.attributes["agentecs.tick"] == 5

    def test_default_status(self):
        msg = SpanEventMessage(span_id="a", trace_id="b", name="test", start_time=0, end_time=1)
        assert msg.status == SpanStatus.unset

    def test_explicit_status(self):
        msg = SpanEventMessage(
            span_id="a",
            trace_id="b",
            name="test",
            start_time=0,
            end_time=1,
            status=SpanStatus.error,
        )
        assert msg.status == SpanStatus.error

    def test_roundtrip_serialization(self):
        msg = SpanEventMessage(
            span_id="s1",
            trace_id="t1",
            parent_span_id="p1",
            name="tool.call",
            start_time=100.0,
            end_time=100.3,
            status=SpanStatus.ok,
            attributes={"tool.name": "web_search"},
        )
        data = msg.model_dump()
        restored = SpanEventMessage.model_validate(data)
        assert restored.span_id == "s1"
        assert restored.parent_span_id == "p1"
        assert restored.status == SpanStatus.ok
        assert restored.attributes["tool.name"] == "web_search"

    def test_status_enum_values(self):
        assert SpanStatus.ok == "ok"
        assert SpanStatus.error == "error"
        assert SpanStatus.unset == "unset"


class TestAnyServerEvent:
    def test_union_contains_all_message_types(self):
        expected = {
            SnapshotMessage,
            DeltaMessage,
            ErrorMessage,
            ErrorEventMessage,
            SpanEventMessage,
            TickUpdateMessage,
            MetadataMessage,
        }
        assert set(AnyServerEvent.__args__) == expected
