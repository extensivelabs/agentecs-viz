"""History storage for tracing and replay.

This module provides implementations of the HistoryStore protocol
for capturing and replaying world execution history.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import TYPE_CHECKING, Any

from agentecs.tracing import HistoryStore, TickRecord

from agentecs_viz.snapshot import WorldSnapshot

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from agentecs_viz.protocol import WorldEvent, WorldStateSource


class InMemoryHistoryStore:
    """Bounded in-memory history store.

    Stores the last N ticks in memory with O(1) access by tick number.
    When the limit is reached, the oldest ticks are evicted.

    This implementation is suitable for development and short debugging
    sessions. For long-running simulations, use FileHistoryStore.

    Attributes:
        max_ticks: Maximum number of ticks to retain.

    Example:
        store = InMemoryHistoryStore(max_ticks=1000)
        store.record_tick(TickRecord(tick=1, ...))
        snapshot = store.get_snapshot(1)
    """

    def __init__(self, max_ticks: int = 1000) -> None:
        """Initialize the store.

        Args:
            max_ticks: Maximum ticks to retain (default 1000).
        """
        self._max_ticks = max_ticks
        self._records: OrderedDict[int, TickRecord] = OrderedDict()

    def record_tick(self, record: TickRecord) -> None:
        """Record a tick's state and events.

        If the store is at capacity, the oldest tick is evicted.
        """
        self._records[record.tick] = record
        # Evict oldest if over limit
        while len(self._records) > self._max_ticks:
            self._records.popitem(last=False)

    def get_tick(self, tick: int) -> TickRecord | None:
        """Get complete tick record."""
        return self._records.get(tick)

    def get_snapshot(self, tick: int) -> dict[str, Any] | None:
        """Get world snapshot at specific tick."""
        record = self._records.get(tick)
        return record.snapshot if record else None

    def get_events(self, start_tick: int, end_tick: int) -> list[dict[str, Any]]:
        """Get events in tick range (inclusive)."""
        events: list[dict[str, Any]] = []
        for tick in range(start_tick, end_tick + 1):
            record = self._records.get(tick)
            if record:
                events.extend(record.events)
        return events

    def get_tick_range(self) -> tuple[int, int] | None:
        """Get available tick range."""
        if not self._records:
            return None
        ticks = list(self._records.keys())
        return ticks[0], ticks[-1]

    def clear(self) -> None:
        """Clear all stored history."""
        self._records.clear()

    @property
    def tick_count(self) -> int:
        """Number of ticks currently stored."""
        return len(self._records)

    @property
    def max_ticks(self) -> int:
        """Maximum ticks this store will retain."""
        return self._max_ticks


class FileHistoryStore:
    """File-based history store using JSON Lines format.

    Stores tick records as JSON Lines (one JSON object per line) for
    persistent storage and replay. Maintains an in-memory index for
    O(1) seek to any tick.

    This implementation is suitable for recording and replaying traces.
    Files are human-readable and can be inspected with standard tools.

    Thread Safety:
        Thread-safe for a single instance (uses internal lock).
        Multiple FileHistoryStore instances accessing the same file
        concurrently are NOT safe and may cause data corruption.

    Attributes:
        path: Path to the JSON Lines file.

    Example:
        # Recording
        store = FileHistoryStore(Path("trace.jsonl"), mode="w")
        store.record_tick(TickRecord(tick=1, ...))
        store.close()

        # Replaying
        store = FileHistoryStore(Path("trace.jsonl"), mode="r")
        snapshot = store.get_snapshot(1)
    """

    def __init__(self, path: Path, mode: str = "a", flush_interval: int = 10) -> None:
        """Initialize the file store.

        Args:
            path: Path to the JSON Lines file.
            mode: File mode - "r" for read-only, "a" for append, "w" for overwrite.
            flush_interval: Number of writes between file flushes (default 10).
        """
        self.path = Path(path)
        self._mode = mode
        self._lock = threading.Lock()
        self._index: dict[int, int] = {}  # tick -> file byte offset
        self._tick_range: tuple[int, int] | None = None
        self._file: Any = None  # TextIO
        self._flush_interval = flush_interval
        self._writes_since_flush = 0

        self._open_file()

    def _open_file(self) -> None:
        """Open the file and build index if reading."""
        if self._mode == "r":
            if not self.path.exists():
                msg = f"File not found: {self.path}"
                raise FileNotFoundError(msg)
            self._file = self.path.open("r", encoding="utf-8")
            self._build_index()
        elif self._mode == "w":
            # Use w+ for read/write access (needed for get_tick while writing)
            self._file = self.path.open("w+", encoding="utf-8")
        else:  # append mode
            self._file = self.path.open("a+", encoding="utf-8")
            # Build index from existing content
            self._file.seek(0)
            self._build_index()
            self._file.seek(0, 2)  # Seek to end for appending

    def _build_index(self) -> None:
        """Build tick->offset index by scanning the file."""
        self._index.clear()
        self._tick_range = None

        if self._file is None:
            return

        self._file.seek(0)
        min_tick: int | None = None
        max_tick: int | None = None

        while True:
            offset = self._file.tell()
            line = self._file.readline()
            if not line:
                break
            line = line.strip()
            if not line:
                continue

            try:
                data = json.loads(line)
                tick = data.get("tick")
                if tick is not None:
                    self._index[tick] = offset
                    if min_tick is None or tick < min_tick:
                        min_tick = tick
                    if max_tick is None or tick > max_tick:
                        max_tick = tick
            except json.JSONDecodeError as e:
                logger.warning(f"Skipping malformed JSON at offset {offset}: {e}")
                continue

        if min_tick is not None and max_tick is not None:
            self._tick_range = (min_tick, max_tick)

    def record_tick(self, record: TickRecord) -> None:
        """Record a tick to the file.

        Args:
            record: The tick record to store.

        Raises:
            RuntimeError: If file is open in read-only mode.
        """
        if self._mode == "r":
            msg = "Cannot record to file opened in read-only mode"
            raise RuntimeError(msg)

        with self._lock:
            if self._file is None:
                return

            # Get current position for index
            offset = self._file.tell()

            # Write JSON line
            data = record.to_dict()
            line = json.dumps(data, separators=(",", ":"))
            self._file.write(line + "\n")

            # Periodic flush to reduce I/O overhead
            self._writes_since_flush += 1
            if self._writes_since_flush >= self._flush_interval:
                self._file.flush()
                self._writes_since_flush = 0

            # Update index
            self._index[record.tick] = offset

            # Update tick range
            if self._tick_range is None:
                self._tick_range = (record.tick, record.tick)
            else:
                min_tick = min(self._tick_range[0], record.tick)
                max_tick = max(self._tick_range[1], record.tick)
                self._tick_range = (min_tick, max_tick)

    def get_tick(self, tick: int) -> TickRecord | None:
        """Get complete tick record.

        Args:
            tick: The tick number to retrieve.

        Returns:
            The tick record, or None if not found.
        """
        with self._lock:
            if tick not in self._index or self._file is None:
                return None

            offset = self._index[tick]
            self._file.seek(offset)
            line = self._file.readline().strip()

            if not line:
                return None

            try:
                data = json.loads(line)
                return TickRecord.from_dict(data)
            except (json.JSONDecodeError, KeyError) as e:
                logger.warning(f"Failed to deserialize tick {tick}: {e}")
                return None

    def get_snapshot(self, tick: int) -> dict[str, Any] | None:
        """Get world snapshot at specific tick.

        Args:
            tick: The tick number.

        Returns:
            The snapshot dict, or None if not found.
        """
        record = self.get_tick(tick)
        return record.snapshot if record else None

    def get_events(self, start_tick: int, end_tick: int) -> list[dict[str, Any]]:
        """Get events in tick range (inclusive).

        Args:
            start_tick: Start of range.
            end_tick: End of range (inclusive).

        Returns:
            List of events from all ticks in range.
        """
        events: list[dict[str, Any]] = []
        for tick in range(start_tick, end_tick + 1):
            record = self.get_tick(tick)
            if record:
                events.extend(record.events)
        return events

    def get_tick_range(self) -> tuple[int, int] | None:
        """Get available tick range.

        Returns:
            Tuple of (min_tick, max_tick), or None if empty.
        """
        return self._tick_range

    def clear(self) -> None:
        """Clear all stored history by truncating the file."""
        if self._mode == "r":
            msg = "Cannot clear file opened in read-only mode"
            raise RuntimeError(msg)

        with self._lock:
            if self._file:
                self._file.close()
            self._file = self.path.open("w", encoding="utf-8")
            self._index.clear()
            self._tick_range = None

    def close(self) -> None:
        """Close the file handle, flushing any pending writes."""
        with self._lock:
            if self._file:
                self._file.flush()  # Ensure all writes are persisted
                self._file.close()
                self._file = None
                self._writes_since_flush = 0

    @property
    def tick_count(self) -> int:
        """Number of ticks stored."""
        return len(self._index)

    def __enter__(self) -> FileHistoryStore:
        """Context manager entry."""
        return self

    def __exit__(self, *args: object) -> None:
        """Context manager exit."""
        self.close()


def compute_entity_lifecycles(store: HistoryStore) -> list[dict[str, Any]]:
    """Compute entity spawn/despawn ticks from history snapshots.

    Iterates through all stored snapshots and tracks when entities first appear
    (spawn) and when they disappear (despawn) by comparing consecutive ticks.

    Args:
        store: A HistoryStore containing tick records with snapshots.

    Returns:
        List of lifecycle dictionaries, each containing:
        - entity_id: The entity's numeric ID
        - spawn_tick: Tick when entity first appeared
        - despawn_tick: Tick when entity disappeared (None if still alive)
        - archetype: Comma-separated sorted component types

    Example:
        >>> store = InMemoryHistoryStore()
        >>> # ... record some ticks ...
        >>> lifecycles = compute_entity_lifecycles(store)
        >>> for lc in lifecycles:
        ...     print(f"Entity {lc['entity_id']}: {lc['spawn_tick']}-{lc['despawn_tick']}")
    """
    tick_range = store.get_tick_range()
    if not tick_range:
        return []

    lifecycles: dict[int, dict[str, Any]] = {}  # entity_id -> lifecycle
    previous_ids: set[int] = set()

    for tick in range(tick_range[0], tick_range[1] + 1):
        snapshot = store.get_snapshot(tick)
        if not snapshot:
            continue

        entities = snapshot.get("entities", [])
        current_ids = {e["id"] for e in entities}

        # Spawned: in current but not previous
        for entity_id in current_ids - previous_ids:
            entity = next(e for e in entities if e["id"] == entity_id)
            archetype = ",".join(sorted(entity.get("archetype", [])))
            lifecycles[entity_id] = {
                "entity_id": entity_id,
                "spawn_tick": tick,
                "despawn_tick": None,
                "archetype": archetype,
            }

        # Despawned: in previous but not current
        for entity_id in previous_ids - current_ids:
            if entity_id in lifecycles:
                lifecycles[entity_id]["despawn_tick"] = tick

        previous_ids = current_ids

    return list(lifecycles.values())


class HistoryCapturingSource:
    """Wraps a WorldStateSource and captures history to a store.

    This source delegates all operations to the wrapped source while
    recording each tick to the history store. When paused, it can
    replay from the store.

    Attributes:
        source: The wrapped live source.
        store: The history store for recording.

    Example:
        live_source = LocalWorldSource(world)
        store = InMemoryHistoryStore(max_ticks=500)
        source = HistoryCapturingSource(live_source, store)

        await source.connect()
        # ... use normally, history is captured automatically
    """

    def __init__(
        self,
        source: WorldStateSource,
        store: HistoryStore | None = None,
        max_ticks: int = 1000,
    ) -> None:
        """Initialize the capturing source.

        Args:
            source: The live source to wrap.
            store: Optional history store (creates InMemoryHistoryStore if None).
            max_ticks: Max ticks if creating default store.
        """
        self._source = source
        self._store: HistoryStore = store or InMemoryHistoryStore(max_ticks=max_ticks)
        self._paused = False
        self._current_tick = 0
        self._pending_step = False

    @property
    def store(self) -> HistoryStore:
        """The history store being used."""
        return self._store

    @property
    def supports_replay(self) -> bool:
        """This source supports replay."""
        return True

    @property
    def tick_range(self) -> tuple[int, int] | None:
        """Available tick range from the store."""
        return self._store.get_tick_range()

    @property
    def is_connected(self) -> bool:
        """Whether the underlying source is connected."""
        return self._source.is_connected

    @property
    def is_paused(self) -> bool:
        """Whether playback is paused."""
        return self._paused

    async def connect(self) -> None:
        """Connect to the underlying source."""
        await self._source.connect()

    async def disconnect(self) -> None:
        """Disconnect from the underlying source."""
        await self._source.disconnect()

    async def get_snapshot(self) -> WorldSnapshot:
        """Get current snapshot (live or from history if paused)."""
        if self._paused:
            # Return from history
            snapshot_dict = self._store.get_snapshot(self._current_tick)
            if snapshot_dict:
                return WorldSnapshot.model_validate(snapshot_dict)
        # Get live snapshot
        return await self._source.get_snapshot()

    async def subscribe_events(self) -> AsyncIterator[WorldEvent]:
        """Subscribe to events, recording each tick to history."""
        from agentecs_viz.protocol import TickEvent

        async for event in self._source.subscribe_events():
            if isinstance(event, TickEvent):
                # Record to history
                snapshot = event.snapshot
                record = TickRecord(
                    tick=snapshot.tick,
                    timestamp=time.time(),
                    snapshot=snapshot.model_dump(),
                    events=[],  # Events would come from world, not available here
                )
                self._store.record_tick(record)
                self._current_tick = snapshot.tick

            # Yield event if not paused, or if this is a step event
            if not self._paused or self._pending_step:
                self._pending_step = False
                yield event

    async def send_command(self, command: str, **kwargs: object) -> None:
        """Send command to the underlying source."""
        if command == "pause":
            self._paused = True
        elif command == "resume":
            self._paused = False
        elif command == "step":
            self._pending_step = True  # Allow next event through even when paused
        await self._source.send_command(command, **kwargs)

    async def seek(self, tick: int) -> WorldSnapshot | None:
        """Seek to a specific tick in history.

        Args:
            tick: The tick to seek to.

        Returns:
            The snapshot at that tick, or None if not available.

        Note:
            This automatically pauses playback.
        """
        self._paused = True
        snapshot_dict = self._store.get_snapshot(tick)
        if snapshot_dict:
            self._current_tick = tick
            return WorldSnapshot.model_validate(snapshot_dict)
        return None
