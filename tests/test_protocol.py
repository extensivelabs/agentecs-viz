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
    StepCommand,
    SubscribeCommand,
    TickUpdateMessage,
    WorldStateSource,
)
from agentecs_viz.snapshot import TickDelta, WorldSnapshot


class TestClientMessages:
    def test_subscribe(self):
        msg = SubscribeCommand()
        assert msg.command == "subscribe"

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
        ws = WorldSnapshot(tick=5, entity_count=3)
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


class TestWorldStateSourceProtocol:
    def test_isinstance_check(self):
        """WorldStateSource is a runtime-checkable Protocol."""
        assert hasattr(WorldStateSource, "__protocol_attrs__") or callable(
            getattr(WorldStateSource, "_is_protocol", None)
        )

    def test_default_is_paused(self):
        assert WorldStateSource.is_paused.fget is not None
        # Verify default returns False (via property descriptor)
        assert WorldStateSource.is_paused.fget(None) is False  # type: ignore[arg-type]

    def test_default_supports_history(self):
        assert WorldStateSource.supports_history.fget is not None
        assert WorldStateSource.supports_history.fget(None) is False  # type: ignore[arg-type]

    def test_default_tick_range(self):
        assert WorldStateSource.tick_range.fget is not None
        assert WorldStateSource.tick_range.fget(None) is None  # type: ignore[arg-type]

    def test_default_visualization_config(self):
        assert WorldStateSource.visualization_config.fget is not None
        assert WorldStateSource.visualization_config.fget(None) is None  # type: ignore[arg-type]


class TestAnyServerEvent:
    def test_union_contains_all_message_types(self):
        expected = {
            SnapshotMessage,
            DeltaMessage,
            ErrorMessage,
            ErrorEventMessage,
            TickUpdateMessage,
            MetadataMessage,
        }
        assert set(AnyServerEvent.__args__) == expected
