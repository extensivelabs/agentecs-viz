"""Tests for history storage.

Why these tests exist:
- InMemoryHistoryStore must correctly implement HistoryStore protocol
- Bounded storage must evict oldest entries correctly
- HistoryCapturingSource must record and replay correctly
"""

from agentecs.tracing import HistoryStore, TickRecord
from agentecs_viz.history import InMemoryHistoryStore, compute_entity_lifecycles


class TestInMemoryHistoryStore:
    """Tests for InMemoryHistoryStore."""

    def test_implements_protocol(self) -> None:
        """InMemoryHistoryStore implements HistoryStore protocol."""
        store = InMemoryHistoryStore()
        assert isinstance(store, HistoryStore)

    def test_record_and_retrieve(self) -> None:
        """Can record and retrieve ticks."""
        store = InMemoryHistoryStore()
        record = TickRecord(
            tick=1,
            timestamp=100.0,
            snapshot={"tick": 1, "entities": []},
            events=[{"type": "spawn"}],
        )
        store.record_tick(record)

        retrieved = store.get_tick(1)
        assert retrieved is not None
        assert retrieved.tick == 1
        assert retrieved.snapshot == {"tick": 1, "entities": []}
        assert len(retrieved.events) == 1

    def test_get_snapshot(self) -> None:
        """get_snapshot returns just the snapshot dict."""
        store = InMemoryHistoryStore()
        store.record_tick(
            TickRecord(
                tick=5,
                timestamp=0.0,
                snapshot={"data": "test"},
            )
        )

        snapshot = store.get_snapshot(5)
        assert snapshot == {"data": "test"}

    def test_get_snapshot_missing(self) -> None:
        """get_snapshot returns None for missing tick."""
        store = InMemoryHistoryStore()
        assert store.get_snapshot(999) is None

    def test_get_events_range(self) -> None:
        """get_events collects events from tick range."""
        store = InMemoryHistoryStore()
        store.record_tick(TickRecord(tick=1, timestamp=0, snapshot={}, events=[{"a": 1}]))
        store.record_tick(
            TickRecord(tick=2, timestamp=0, snapshot={}, events=[{"b": 2}, {"b2": 22}])
        )
        store.record_tick(TickRecord(tick=3, timestamp=0, snapshot={}, events=[{"c": 3}]))

        events = store.get_events(1, 2)
        assert len(events) == 3
        assert {"a": 1} in events
        assert {"b": 2} in events

    def test_get_tick_range_empty(self) -> None:
        """get_tick_range returns None when empty."""
        store = InMemoryHistoryStore()
        assert store.get_tick_range() is None

    def test_get_tick_range(self) -> None:
        """get_tick_range returns min/max ticks (normal sequential insertion)."""
        store = InMemoryHistoryStore()
        # Normal usage: sequential ticks
        store.record_tick(TickRecord(tick=10, timestamp=0, snapshot={}))
        store.record_tick(TickRecord(tick=11, timestamp=0, snapshot={}))
        store.record_tick(TickRecord(tick=12, timestamp=0, snapshot={}))

        tick_range = store.get_tick_range()
        assert tick_range == (10, 12)

    def test_tick_count(self) -> None:
        """tick_count returns number of stored ticks."""
        store = InMemoryHistoryStore()
        assert store.tick_count == 0

        store.record_tick(TickRecord(tick=1, timestamp=0, snapshot={}))
        assert store.tick_count == 1

        store.record_tick(TickRecord(tick=2, timestamp=0, snapshot={}))
        assert store.tick_count == 2

    def test_clear(self) -> None:
        """Clear removes all history."""
        store = InMemoryHistoryStore()
        store.record_tick(TickRecord(tick=1, timestamp=0, snapshot={}))
        store.record_tick(TickRecord(tick=2, timestamp=0, snapshot={}))
        assert store.tick_count == 2

        store.clear()
        assert store.tick_count == 0
        assert store.get_tick_range() is None

    def test_bounded_storage(self) -> None:
        """Store evicts oldest ticks when limit exceeded.

        Why: Memory must be bounded for long-running sessions.
        """
        store = InMemoryHistoryStore(max_ticks=3)

        # Add 5 ticks
        for i in range(5):
            store.record_tick(TickRecord(tick=i, timestamp=float(i), snapshot={"i": i}))

        # Should only have 3 ticks, oldest evicted
        assert store.tick_count == 3
        assert store.get_tick(0) is None  # Evicted
        assert store.get_tick(1) is None  # Evicted
        assert store.get_tick(2) is not None
        assert store.get_tick(3) is not None
        assert store.get_tick(4) is not None

    def test_bounded_storage_maintains_order(self) -> None:
        """Eviction maintains tick order for range queries."""
        store = InMemoryHistoryStore(max_ticks=3)

        for i in range(5):
            store.record_tick(TickRecord(tick=i, timestamp=0, snapshot={}))

        tick_range = store.get_tick_range()
        assert tick_range == (2, 4)

    def test_overwrite_same_tick(self) -> None:
        """Recording same tick overwrites previous record."""
        store = InMemoryHistoryStore()
        store.record_tick(TickRecord(tick=1, timestamp=0, snapshot={"v": 1}))
        store.record_tick(TickRecord(tick=1, timestamp=0, snapshot={"v": 2}))

        assert store.tick_count == 1
        snapshot = store.get_snapshot(1)
        assert snapshot == {"v": 2}

    def test_max_ticks_property(self) -> None:
        """max_ticks property returns configured limit."""
        store = InMemoryHistoryStore(max_ticks=500)
        assert store.max_ticks == 500


class TestComputeEntityLifecycles:
    """Tests for compute_entity_lifecycles function.

    Why these tests exist:
    - FE-034 requires accurate spawn/despawn tracking from history
    - Entity lifecycle calculation must work across tick boundaries
    - Edge cases (empty store, single tick, gaps) must be handled correctly
    """

    def test_empty_store_returns_empty_list(self) -> None:
        """Empty store returns empty lifecycles list."""
        store = InMemoryHistoryStore()
        lifecycles = compute_entity_lifecycles(store)
        assert lifecycles == []

    def test_single_tick_with_entities(self) -> None:
        """Single tick records entities as spawned at that tick, still alive."""
        store = InMemoryHistoryStore()
        store.record_tick(
            TickRecord(
                tick=0,
                timestamp=0.0,
                snapshot={
                    "entities": [
                        {"id": 1, "archetype": ["Position", "Velocity"]},
                        {"id": 2, "archetype": ["Task"]},
                    ]
                },
            )
        )

        lifecycles = compute_entity_lifecycles(store)
        assert len(lifecycles) == 2

        lc1 = next(lc for lc in lifecycles if lc["entity_id"] == 1)
        assert lc1["spawn_tick"] == 0
        assert lc1["despawn_tick"] is None
        assert lc1["archetype"] == "Position,Velocity"

        lc2 = next(lc for lc in lifecycles if lc["entity_id"] == 2)
        assert lc2["spawn_tick"] == 0
        assert lc2["despawn_tick"] is None
        assert lc2["archetype"] == "Task"

    def test_entity_spawn_detection(self) -> None:
        """Entities appearing in later ticks have correct spawn tick."""
        store = InMemoryHistoryStore()
        # Tick 0: Entity 1
        store.record_tick(
            TickRecord(
                tick=0,
                timestamp=0.0,
                snapshot={"entities": [{"id": 1, "archetype": ["A"]}]},
            )
        )
        # Tick 1: Entity 1 + Entity 2 spawns
        store.record_tick(
            TickRecord(
                tick=1,
                timestamp=1.0,
                snapshot={
                    "entities": [
                        {"id": 1, "archetype": ["A"]},
                        {"id": 2, "archetype": ["B"]},
                    ]
                },
            )
        )

        lifecycles = compute_entity_lifecycles(store)
        assert len(lifecycles) == 2

        lc1 = next(lc for lc in lifecycles if lc["entity_id"] == 1)
        assert lc1["spawn_tick"] == 0

        lc2 = next(lc for lc in lifecycles if lc["entity_id"] == 2)
        assert lc2["spawn_tick"] == 1

    def test_entity_despawn_detection(self) -> None:
        """Entities disappearing have correct despawn tick."""
        store = InMemoryHistoryStore()
        # Tick 0: Entities 1 and 2
        store.record_tick(
            TickRecord(
                tick=0,
                timestamp=0.0,
                snapshot={
                    "entities": [
                        {"id": 1, "archetype": ["A"]},
                        {"id": 2, "archetype": ["B"]},
                    ]
                },
            )
        )
        # Tick 1: Only Entity 1 (Entity 2 despawned)
        store.record_tick(
            TickRecord(
                tick=1,
                timestamp=1.0,
                snapshot={"entities": [{"id": 1, "archetype": ["A"]}]},
            )
        )

        lifecycles = compute_entity_lifecycles(store)
        assert len(lifecycles) == 2

        lc1 = next(lc for lc in lifecycles if lc["entity_id"] == 1)
        assert lc1["despawn_tick"] is None  # Still alive

        lc2 = next(lc for lc in lifecycles if lc["entity_id"] == 2)
        assert lc2["despawn_tick"] == 1  # Despawned at tick 1

    def test_spawn_and_despawn_same_simulation(self) -> None:
        """Entity spawning and despawning across multiple ticks tracks correctly."""
        store = InMemoryHistoryStore()
        # Tick 0: Empty
        store.record_tick(TickRecord(tick=0, timestamp=0.0, snapshot={"entities": []}))
        # Tick 1: Entity 1 spawns
        store.record_tick(
            TickRecord(
                tick=1,
                timestamp=1.0,
                snapshot={"entities": [{"id": 1, "archetype": ["Task"]}]},
            )
        )
        # Tick 2: Entity 1 still alive
        store.record_tick(
            TickRecord(
                tick=2,
                timestamp=2.0,
                snapshot={"entities": [{"id": 1, "archetype": ["Task"]}]},
            )
        )
        # Tick 3: Entity 1 despawns
        store.record_tick(TickRecord(tick=3, timestamp=3.0, snapshot={"entities": []}))

        lifecycles = compute_entity_lifecycles(store)
        assert len(lifecycles) == 1

        lc = lifecycles[0]
        assert lc["entity_id"] == 1
        assert lc["spawn_tick"] == 1
        assert lc["despawn_tick"] == 3

    def test_archetype_sorted_alphabetically(self) -> None:
        """Archetype string is sorted alphabetically."""
        store = InMemoryHistoryStore()
        store.record_tick(
            TickRecord(
                tick=0,
                timestamp=0.0,
                snapshot={"entities": [{"id": 1, "archetype": ["Zebra", "Apple", "Mango"]}]},
            )
        )

        lifecycles = compute_entity_lifecycles(store)
        assert lifecycles[0]["archetype"] == "Apple,Mango,Zebra"

    def test_handles_gaps_in_tick_sequence(self) -> None:
        """Handles missing ticks in history gracefully."""
        store = InMemoryHistoryStore()
        # Tick 0
        store.record_tick(
            TickRecord(
                tick=0,
                timestamp=0.0,
                snapshot={"entities": [{"id": 1, "archetype": ["A"]}]},
            )
        )
        # Tick 5 (gap: ticks 1-4 missing)
        store.record_tick(
            TickRecord(
                tick=5,
                timestamp=5.0,
                snapshot={"entities": [{"id": 1, "archetype": ["A"]}]},
            )
        )

        lifecycles = compute_entity_lifecycles(store)
        assert len(lifecycles) == 1
        assert lifecycles[0]["spawn_tick"] == 0
        assert lifecycles[0]["despawn_tick"] is None
