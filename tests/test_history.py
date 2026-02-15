from helpers import make_entity, make_snapshot

from agentecs_viz.history import (
    InMemoryHistoryStore,
    _apply_delta,
    _compute_delta,
    _diff_entity,
    compute_entity_lifecycles,
)
from agentecs_viz.protocol import ErrorEventMessage, ErrorSeverity
from agentecs_viz.snapshot import ComponentDiff, TickDelta


class TestDiffEntity:
    def test_no_change(self):
        e = make_entity(1, Position={"x": 0, "y": 0})
        diffs = _diff_entity(e, e)
        assert diffs == []

    def test_component_modified(self):
        old = make_entity(1, Position={"x": 0})
        new = make_entity(1, Position={"x": 5})
        diffs = _diff_entity(old, new)
        assert len(diffs) == 1
        assert diffs[0].component_type == "Position"
        assert diffs[0].old_value == {"x": 0}
        assert diffs[0].new_value == {"x": 5}

    def test_component_added(self):
        old = make_entity(1, Position={"x": 0})
        new = make_entity(1, Position={"x": 0}, Health={"hp": 100})
        diffs = _diff_entity(old, new)
        assert len(diffs) == 1
        assert diffs[0].component_type == "Health"
        assert diffs[0].old_value is None

    def test_component_removed(self):
        old = make_entity(1, Position={"x": 0}, Health={"hp": 100})
        new = make_entity(1, Position={"x": 0})
        diffs = _diff_entity(old, new)
        assert len(diffs) == 1
        assert diffs[0].component_type == "Health"
        assert diffs[0].new_value is None


class TestComputeDelta:
    def test_spawned(self):
        old = make_snapshot(0, [make_entity(1, A={})])
        new = make_snapshot(1, [make_entity(1, A={}), make_entity(2, B={})])
        delta = _compute_delta(old, new)
        assert len(delta.spawned) == 1
        assert delta.spawned[0].id == 2

    def test_destroyed(self):
        old = make_snapshot(0, [make_entity(1, A={}), make_entity(2, B={})])
        new = make_snapshot(1, [make_entity(1, A={})])
        delta = _compute_delta(old, new)
        assert delta.destroyed == [2]

    def test_modified(self):
        old = make_snapshot(0, [make_entity(1, Position={"x": 0})])
        new = make_snapshot(1, [make_entity(1, Position={"x": 5})])
        delta = _compute_delta(old, new)
        assert 1 in delta.modified
        assert delta.modified[1][0].new_value == {"x": 5}

    def test_no_changes(self):
        snap = make_snapshot(0, [make_entity(1, A={"v": 1})])
        delta = _compute_delta(snap, snap)
        assert delta.spawned == []
        assert delta.destroyed == []
        assert delta.modified == {}


class TestApplyDelta:
    def test_apply_spawn(self):
        snap = make_snapshot(0, [make_entity(1, A={})])
        new_entity = make_entity(2, B={"x": 1})

        td = TickDelta(tick=1, timestamp=1.0, spawned=[new_entity])
        result = _apply_delta(snap, td)
        assert len(result.entities) == 2

    def test_apply_destroy(self):
        snap = make_snapshot(0, [make_entity(1, A={}), make_entity(2, B={})])

        td = TickDelta(tick=1, timestamp=1.0, destroyed=[2])
        result = _apply_delta(snap, td)
        assert len(result.entities) == 1
        assert result.entities[0].id == 1

    def test_apply_modify(self):
        snap = make_snapshot(0, [make_entity(1, Position={"x": 0})])
        diff = ComponentDiff(component_type="Position", old_value={"x": 0}, new_value={"x": 5})

        td = TickDelta(tick=1, timestamp=1.0, modified={1: [diff]})
        result = _apply_delta(snap, td)
        pos_data = {c.type_short: c.data for c in result.entities[0].components}
        assert pos_data["Position"]["x"] == 5

    def test_roundtrip(self):
        old = make_snapshot(0, [make_entity(1, X={"a": 1}), make_entity(2, Y={"b": 2})])
        new = make_snapshot(1, [make_entity(1, X={"a": 10}), make_entity(3, Z={"c": 3})])
        delta = _compute_delta(old, new)
        reconstructed = _apply_delta(old, delta)
        assert reconstructed.tick == 1
        ids = {e.id for e in reconstructed.entities}
        assert ids == {1, 3}


class TestInMemoryHistoryStore:
    def test_record_and_retrieve(self):
        store = InMemoryHistoryStore(max_ticks=100, checkpoint_interval=10)
        snap = make_snapshot(0, [make_entity(1, A={"v": 1})])
        store.record_tick(snap)
        result = store.get_snapshot(0)
        assert result is not None
        assert result.tick == 0

    def test_tick_range(self):
        store = InMemoryHistoryStore(max_ticks=100, checkpoint_interval=5)
        for i in range(10):
            store.record_tick(make_snapshot(i, [make_entity(1, A={"v": i})]))
        assert store.get_tick_range() == (0, 9)
        assert store.tick_count == 10

    def test_checkpoint_reconstruction(self):
        store = InMemoryHistoryStore(max_ticks=100, checkpoint_interval=5)
        snapshots = []
        for i in range(10):
            snap = make_snapshot(i, [make_entity(1, Position={"x": i * 10})])
            snapshots.append(snap)
            store.record_tick(snap)

        # Tick 0 is checkpoint, tick 3 is delta - both should reconstruct correctly
        for i in range(10):
            result = store.get_snapshot(i)
            assert result is not None
            pos_data = {c.type_short: c.data for c in result.entities[0].components}
            assert pos_data["Position"]["x"] == i * 10

    def test_eviction(self):
        store = InMemoryHistoryStore(max_ticks=5, checkpoint_interval=3)
        for i in range(10):
            store.record_tick(make_snapshot(i, [make_entity(1, A={"v": i})]))

        assert store.tick_count == 5
        assert store.get_snapshot(0) is None
        assert store.get_snapshot(5) is not None

    def test_eviction_promotes_checkpoint(self):
        store = InMemoryHistoryStore(max_ticks=3, checkpoint_interval=5)
        # Tick 0 is checkpoint, ticks 1,2 are deltas
        for i in range(4):
            store.record_tick(make_snapshot(i, [make_entity(1, A={"v": i})]))

        # After evicting tick 0, tick 1 should become a checkpoint
        assert store.get_snapshot(1) is not None
        result = store.get_snapshot(1)
        assert result is not None
        data = {c.type_short: c.data for c in result.entities[0].components}
        assert data["A"]["v"] == 1

    def test_clear(self):
        store = InMemoryHistoryStore()
        store.record_tick(make_snapshot(0, []))
        store.clear()
        assert store.tick_count == 0
        assert store.get_tick_range() is None

    def test_nonexistent_tick(self):
        store = InMemoryHistoryStore()
        assert store.get_snapshot(999) is None

    def test_properties(self):
        store = InMemoryHistoryStore(max_ticks=500, checkpoint_interval=50)
        assert store.max_ticks == 500
        assert store.checkpoint_interval == 50

    def test_stored_ticks(self):
        store = InMemoryHistoryStore(max_ticks=100, checkpoint_interval=10)
        for i in range(5):
            store.record_tick(make_snapshot(i, [make_entity(1, A={"v": i})]))
        assert list(store.stored_ticks) == [0, 1, 2, 3, 4]

    def test_eviction_retains_latest_ticks(self):
        """After exceeding max_ticks, store retains only the most recent ticks."""
        store = InMemoryHistoryStore(max_ticks=100, checkpoint_interval=50)
        for i in range(200):
            store.record_tick(make_snapshot(i, [make_entity(1, A={"v": i})]))
        assert store.tick_count == 100
        assert store.stored_ticks[0] == 100


class TestErrorStorage:
    def _make_error(
        self, tick: int, entity_id: int, severity: ErrorSeverity = ErrorSeverity.warning
    ) -> ErrorEventMessage:
        return ErrorEventMessage(
            tick=tick, entity_id=entity_id, message=f"error at tick {tick}", severity=severity
        )

    def test_record_and_retrieve(self):
        store = InMemoryHistoryStore()
        store.record_tick(make_snapshot(0, [make_entity(1, A={})]))
        error = self._make_error(0, 1)
        store.record_error(error)
        errors = store.get_errors(0, 0)
        assert len(errors) == 1
        assert errors[0].entity_id == 1

    def test_range_query(self):
        store = InMemoryHistoryStore()
        for i in range(5):
            store.record_tick(make_snapshot(i, [make_entity(1, A={})]))
        store.record_error(self._make_error(1, 1))
        store.record_error(self._make_error(3, 1))
        store.record_error(self._make_error(4, 1))

        errors = store.get_errors(0, 2)
        assert len(errors) == 1
        errors = store.get_errors(0, 4)
        assert len(errors) == 3

    def test_entity_filtering(self):
        store = InMemoryHistoryStore()
        store.record_tick(make_snapshot(0, [make_entity(1, A={}), make_entity(2, B={})]))
        store.record_error(self._make_error(0, 1))
        store.record_error(self._make_error(0, 2))

        errors = store.get_errors_for_entity(1, 0, 0)
        assert len(errors) == 1
        assert errors[0].entity_id == 1

    def test_eviction_clears_errors(self):
        store = InMemoryHistoryStore(max_ticks=3, checkpoint_interval=5)
        for i in range(5):
            store.record_tick(make_snapshot(i, [make_entity(1, A={})]))
            store.record_error(self._make_error(i, 1))

        # Ticks 0 and 1 should be evicted
        errors = store.get_errors(0, 1)
        assert len(errors) == 0
        # Ticks 2-4 should remain
        errors = store.get_errors(2, 4)
        assert len(errors) == 3

    def test_clear_removes_errors(self):
        store = InMemoryHistoryStore()
        store.record_tick(make_snapshot(0, [make_entity(1, A={})]))
        store.record_error(self._make_error(0, 1))
        store.clear()
        assert store.get_errors(0, 0) == []


class TestComputeEntityLifecycles:
    def test_basic_lifecycles(self):
        store = InMemoryHistoryStore(max_ticks=100, checkpoint_interval=10)
        store.record_tick(make_snapshot(0, [make_entity(1, A={}), make_entity(2, B={})]))
        store.record_tick(
            make_snapshot(1, [make_entity(1, A={}), make_entity(2, B={}), make_entity(3, C={})])
        )
        store.record_tick(make_snapshot(2, [make_entity(1, A={}), make_entity(3, C={})]))

        lifecycles = compute_entity_lifecycles(store)
        by_id = {lc["entity_id"]: lc for lc in lifecycles}

        assert by_id[1]["spawn_tick"] == 0
        assert by_id[1]["despawn_tick"] is None
        assert by_id[2]["spawn_tick"] == 0
        assert by_id[2]["despawn_tick"] == 2
        assert by_id[3]["spawn_tick"] == 1
        assert by_id[3]["despawn_tick"] is None

    def test_non_sequential_ticks(self):
        """Lifecycle computation iterates stored ticks, not integer range."""
        store = InMemoryHistoryStore(max_ticks=100, checkpoint_interval=100)
        # Record ticks with gaps: 0, 10, 20
        store.record_tick(make_snapshot(0, [make_entity(1, A={})]))
        store.record_tick(make_snapshot(10, [make_entity(1, A={}), make_entity(2, B={})]))
        store.record_tick(make_snapshot(20, [make_entity(2, B={})]))

        lifecycles = compute_entity_lifecycles(store)
        by_id = {lc["entity_id"]: lc for lc in lifecycles}

        assert by_id[1]["spawn_tick"] == 0
        assert by_id[1]["despawn_tick"] == 20
        assert by_id[2]["spawn_tick"] == 10
        assert by_id[2]["despawn_tick"] is None

    def test_empty_store(self):
        store = InMemoryHistoryStore()
        assert compute_entity_lifecycles(store) == []
