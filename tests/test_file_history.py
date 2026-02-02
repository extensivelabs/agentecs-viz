"""Tests for FileHistoryStore."""

from pathlib import Path

import pytest
from agentecs.tracing import HistoryStore, TickRecord

from agentecs_viz.history import FileHistoryStore


@pytest.fixture
def temp_file(tmp_path: Path) -> Path:
    """Create a temporary file path for testing."""
    return tmp_path / "test_trace.jsonl"


@pytest.fixture
def sample_record() -> TickRecord:
    """Create a sample tick record."""
    return TickRecord(
        tick=1,
        timestamp=1234567890.0,
        snapshot={"tick": 1, "entity_count": 5, "entities": []},
        events=[{"type": "spawn", "entity_id": 1}],
    )


class TestFileHistoryStore:
    """Test FileHistoryStore functionality."""

    def test_implements_protocol(self, temp_file: Path) -> None:
        """FileHistoryStore implements HistoryStore protocol."""
        store = FileHistoryStore(temp_file, mode="w")
        try:
            assert isinstance(store, HistoryStore)
        finally:
            store.close()

    def test_record_and_read(self, temp_file: Path, sample_record: TickRecord) -> None:
        """Can record and read back a tick record."""
        # Write
        with FileHistoryStore(temp_file, mode="w") as store:
            store.record_tick(sample_record)

        # Read
        with FileHistoryStore(temp_file, mode="r") as store:
            result = store.get_tick(1)
            assert result is not None
            assert result.tick == 1
            assert result.timestamp == 1234567890.0
            assert result.snapshot == sample_record.snapshot

    def test_index_built_on_open(self, temp_file: Path) -> None:
        """Index is built when opening existing file."""
        # Write multiple ticks
        with FileHistoryStore(temp_file, mode="w") as store:
            for i in range(5):
                record = TickRecord(tick=i, timestamp=float(i), snapshot={"tick": i}, events=[])
                store.record_tick(record)

        # Reopen and verify index
        with FileHistoryStore(temp_file, mode="r") as store:
            assert store.tick_count == 5
            assert store.get_tick_range() == (0, 4)
            # All ticks should be accessible
            for i in range(5):
                assert store.get_tick(i) is not None

    def test_get_tick_returns_none_for_missing(self, temp_file: Path) -> None:
        """get_tick returns None for non-existent tick."""
        with FileHistoryStore(temp_file, mode="w") as store:
            store.record_tick(TickRecord(tick=1, timestamp=1.0, snapshot={}, events=[]))
            assert store.get_tick(99) is None

    def test_get_snapshot(self, temp_file: Path) -> None:
        """get_snapshot extracts just the snapshot dict."""
        with FileHistoryStore(temp_file, mode="w") as store:
            record = TickRecord(tick=1, timestamp=1.0, snapshot={"key": "value"}, events=[])
            store.record_tick(record)
            snapshot = store.get_snapshot(1)
            assert snapshot == {"key": "value"}

    def test_get_snapshot_returns_none_for_missing(self, temp_file: Path) -> None:
        """get_snapshot returns None for missing tick."""
        with FileHistoryStore(temp_file, mode="w") as store:
            assert store.get_snapshot(99) is None

    def test_get_events_range(self, temp_file: Path) -> None:
        """get_events returns events from tick range."""
        with FileHistoryStore(temp_file, mode="w") as store:
            for i in range(3):
                record = TickRecord(
                    tick=i,
                    timestamp=float(i),
                    snapshot={},
                    events=[{"type": f"event_{i}"}],
                )
                store.record_tick(record)

            events = store.get_events(0, 2)
            assert len(events) == 3
            assert events[0] == {"type": "event_0"}
            assert events[2] == {"type": "event_2"}

    def test_get_tick_range_empty(self, temp_file: Path) -> None:
        """get_tick_range returns None for empty store."""
        with FileHistoryStore(temp_file, mode="w") as store:
            assert store.get_tick_range() is None

    def test_get_tick_range(self, temp_file: Path) -> None:
        """get_tick_range returns correct range."""
        with FileHistoryStore(temp_file, mode="w") as store:
            for i in [5, 10, 15]:
                store.record_tick(TickRecord(tick=i, timestamp=float(i), snapshot={}, events=[]))
            assert store.get_tick_range() == (5, 15)

    def test_tick_count(self, temp_file: Path) -> None:
        """tick_count reflects number of stored ticks."""
        with FileHistoryStore(temp_file, mode="w") as store:
            assert store.tick_count == 0
            store.record_tick(TickRecord(tick=1, timestamp=1.0, snapshot={}, events=[]))
            assert store.tick_count == 1
            store.record_tick(TickRecord(tick=2, timestamp=2.0, snapshot={}, events=[]))
            assert store.tick_count == 2

    def test_clear_truncates_file(self, temp_file: Path) -> None:
        """clear() removes all data and truncates file."""
        with FileHistoryStore(temp_file, mode="w") as store:
            store.record_tick(TickRecord(tick=1, timestamp=1.0, snapshot={}, events=[]))
            assert store.tick_count == 1

            store.clear()
            assert store.tick_count == 0
            assert store.get_tick_range() is None

        # File should be empty
        assert temp_file.stat().st_size == 0

    def test_append_mode_preserves_existing(self, temp_file: Path) -> None:
        """Append mode preserves existing records."""
        # Write initial records
        with FileHistoryStore(temp_file, mode="w") as store:
            store.record_tick(TickRecord(tick=1, timestamp=1.0, snapshot={}, events=[]))

        # Append more
        with FileHistoryStore(temp_file, mode="a") as store:
            assert store.tick_count == 1  # Existing tick found
            store.record_tick(TickRecord(tick=2, timestamp=2.0, snapshot={}, events=[]))
            assert store.tick_count == 2

        # Verify both exist
        with FileHistoryStore(temp_file, mode="r") as store:
            assert store.tick_count == 2
            assert store.get_tick(1) is not None
            assert store.get_tick(2) is not None

    def test_read_mode_cannot_write(self, temp_file: Path) -> None:
        """Read mode raises on write operations."""
        # Create file first
        with FileHistoryStore(temp_file, mode="w") as store:
            store.record_tick(TickRecord(tick=1, timestamp=1.0, snapshot={}, events=[]))

        with FileHistoryStore(temp_file, mode="r") as store:
            with pytest.raises(RuntimeError, match="read-only"):
                store.record_tick(TickRecord(tick=2, timestamp=2.0, snapshot={}, events=[]))
            with pytest.raises(RuntimeError, match="read-only"):
                store.clear()

    def test_read_nonexistent_file_raises(self, temp_file: Path) -> None:
        """Opening non-existent file in read mode raises."""
        with pytest.raises(FileNotFoundError):
            FileHistoryStore(temp_file, mode="r")

    def test_file_persists_across_sessions(self, temp_file: Path) -> None:
        """Data persists across multiple open/close cycles."""
        # Write
        store = FileHistoryStore(temp_file, mode="w")
        store.record_tick(
            TickRecord(
                tick=42,
                timestamp=1234.5,
                snapshot={"test": "data"},
                events=[{"a": 1}],
            )
        )
        store.close()

        # Read
        store = FileHistoryStore(temp_file, mode="r")
        record = store.get_tick(42)
        store.close()

        assert record is not None
        assert record.tick == 42
        assert record.timestamp == 1234.5
        assert record.snapshot == {"test": "data"}
        assert record.events == [{"a": 1}]

    def test_overwrite_same_tick(self, temp_file: Path) -> None:
        """Recording same tick twice updates index to latest record."""
        with FileHistoryStore(temp_file, mode="w") as store:
            store.record_tick(TickRecord(tick=1, timestamp=1.0, snapshot={"v": 1}, events=[]))
            store.record_tick(TickRecord(tick=1, timestamp=2.0, snapshot={"v": 2}, events=[]))
            # Index points to latest write (last write wins)
            assert store.tick_count == 1  # One tick in index
            record = store.get_tick(1)
            assert record is not None
            assert record.snapshot == {"v": 2}  # Latest value

    def test_malformed_jsonl_lines_skipped(self, temp_file: Path) -> None:
        """Malformed JSON lines are skipped, valid lines still indexed."""
        # Write a file with mixed valid/invalid lines
        with temp_file.open("w") as f:
            # Valid line
            f.write('{"tick":0,"timestamp":0.0,"snapshot":{},"events":[]}\n')
            # Malformed JSON
            f.write("not valid json\n")
            # Another valid line
            f.write('{"tick":2,"timestamp":2.0,"snapshot":{},"events":[]}\n')
            # Incomplete JSON
            f.write('{"tick":3\n')
            # Valid line at end
            f.write('{"tick":4,"timestamp":4.0,"snapshot":{},"events":[]}\n')

        # Open and verify only valid ticks are indexed
        with FileHistoryStore(temp_file, mode="r") as store:
            # Should have 3 valid ticks (0, 2, 4)
            assert store.tick_count == 3
            assert store.get_tick_range() == (0, 4)

            # Valid ticks should be retrievable
            assert store.get_tick(0) is not None
            assert store.get_tick(2) is not None
            assert store.get_tick(4) is not None

            # Missing ticks should return None
            assert store.get_tick(1) is None
            assert store.get_tick(3) is None

    def test_flush_interval_reduces_io(self, temp_file: Path) -> None:
        """Flush interval parameter controls write frequency."""
        # Create store with large flush interval
        with FileHistoryStore(temp_file, mode="w", flush_interval=100) as store:
            # Write multiple records
            for i in range(50):
                store.record_tick(TickRecord(tick=i, timestamp=float(i), snapshot={}, events=[]))
            # Data should still be accessible (in buffer)
            assert store.tick_count == 50

        # After close, all data should be persisted
        with FileHistoryStore(temp_file, mode="r") as store:
            assert store.tick_count == 50
