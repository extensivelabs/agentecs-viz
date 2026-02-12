from agentecs_viz.history import (
    InMemoryHistoryStore,
    _apply_delta,
    _compute_delta,
    _diff_entity,
    compute_entity_lifecycles,
)
from agentecs_viz.snapshot import (
    ComponentDiff,
    ComponentSnapshot,
    EntitySnapshot,
    WorldSnapshot,
)


def _entity(eid: int, **comp_data: dict) -> EntitySnapshot:
    components = [
        ComponentSnapshot(type_name=f"m.{name}", type_short=name, data=data)
        for name, data in comp_data.items()
    ]
    return EntitySnapshot(id=eid, components=components)


def _snapshot(tick: int, entities: list[EntitySnapshot]) -> WorldSnapshot:
    return WorldSnapshot(
        tick=tick, timestamp=float(tick), entity_count=len(entities), entities=entities
    )


class TestDiffEntity:
    def test_no_change(self):
        e = _entity(1, Position={"x": 0, "y": 0})
        diffs = _diff_entity(e, e)
        assert diffs == []

    def test_component_modified(self):
        old = _entity(1, Position={"x": 0})
        new = _entity(1, Position={"x": 5})
        diffs = _diff_entity(old, new)
        assert len(diffs) == 1
        assert diffs[0].component_type == "Position"
        assert diffs[0].old_value == {"x": 0}
        assert diffs[0].new_value == {"x": 5}

    def test_component_added(self):
        old = _entity(1, Position={"x": 0})
        new = _entity(1, Position={"x": 0}, Health={"hp": 100})
        diffs = _diff_entity(old, new)
        assert len(diffs) == 1
        assert diffs[0].component_type == "Health"
        assert diffs[0].old_value is None

    def test_component_removed(self):
        old = _entity(1, Position={"x": 0}, Health={"hp": 100})
        new = _entity(1, Position={"x": 0})
        diffs = _diff_entity(old, new)
        assert len(diffs) == 1
        assert diffs[0].component_type == "Health"
        assert diffs[0].new_value is None


class TestComputeDelta:
    def test_spawned(self):
        old = _snapshot(0, [_entity(1, A={})])
        new = _snapshot(1, [_entity(1, A={}), _entity(2, B={})])
        delta = _compute_delta(old, new)
        assert len(delta.spawned) == 1
        assert delta.spawned[0].id == 2

    def test_destroyed(self):
        old = _snapshot(0, [_entity(1, A={}), _entity(2, B={})])
        new = _snapshot(1, [_entity(1, A={})])
        delta = _compute_delta(old, new)
        assert delta.destroyed == [2]

    def test_modified(self):
        old = _snapshot(0, [_entity(1, Position={"x": 0})])
        new = _snapshot(1, [_entity(1, Position={"x": 5})])
        delta = _compute_delta(old, new)
        assert 1 in delta.modified
        assert delta.modified[1][0].new_value == {"x": 5}

    def test_no_changes(self):
        snap = _snapshot(0, [_entity(1, A={"v": 1})])
        delta = _compute_delta(snap, snap)
        assert delta.spawned == []
        assert delta.destroyed == []
        assert delta.modified == {}


class TestApplyDelta:
    def test_apply_spawn(self):
        snap = _snapshot(0, [_entity(1, A={})])
        new_entity = _entity(2, B={"x": 1})
        from agentecs_viz.snapshot import TickDelta

        td = TickDelta(tick=1, timestamp=1.0, spawned=[new_entity])
        result = _apply_delta(snap, td)
        assert len(result.entities) == 2

    def test_apply_destroy(self):
        snap = _snapshot(0, [_entity(1, A={}), _entity(2, B={})])
        from agentecs_viz.snapshot import TickDelta

        td = TickDelta(tick=1, timestamp=1.0, destroyed=[2])
        result = _apply_delta(snap, td)
        assert len(result.entities) == 1
        assert result.entities[0].id == 1

    def test_apply_modify(self):
        snap = _snapshot(0, [_entity(1, Position={"x": 0})])
        diff = ComponentDiff(component_type="Position", old_value={"x": 0}, new_value={"x": 5})
        from agentecs_viz.snapshot import TickDelta

        td = TickDelta(tick=1, timestamp=1.0, modified={1: [diff]})
        result = _apply_delta(snap, td)
        pos_data = {c.type_short: c.data for c in result.entities[0].components}
        assert pos_data["Position"]["x"] == 5

    def test_roundtrip(self):
        old = _snapshot(0, [_entity(1, X={"a": 1}), _entity(2, Y={"b": 2})])
        new = _snapshot(1, [_entity(1, X={"a": 10}), _entity(3, Z={"c": 3})])
        delta = _compute_delta(old, new)
        reconstructed = _apply_delta(old, delta)
        assert reconstructed.tick == 1
        ids = {e.id for e in reconstructed.entities}
        assert ids == {1, 3}


class TestInMemoryHistoryStore:
    def test_record_and_retrieve(self):
        store = InMemoryHistoryStore(max_ticks=100, checkpoint_interval=10)
        snap = _snapshot(0, [_entity(1, A={"v": 1})])
        store.record_tick(snap)
        result = store.get_snapshot(0)
        assert result is not None
        assert result.tick == 0

    def test_tick_range(self):
        store = InMemoryHistoryStore(max_ticks=100, checkpoint_interval=5)
        for i in range(10):
            store.record_tick(_snapshot(i, [_entity(1, A={"v": i})]))
        assert store.get_tick_range() == (0, 9)
        assert store.tick_count == 10

    def test_checkpoint_reconstruction(self):
        store = InMemoryHistoryStore(max_ticks=100, checkpoint_interval=5)
        snapshots = []
        for i in range(10):
            snap = _snapshot(i, [_entity(1, Position={"x": i * 10})])
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
            store.record_tick(_snapshot(i, [_entity(1, A={"v": i})]))

        assert store.tick_count == 5
        assert store.get_snapshot(0) is None
        assert store.get_snapshot(5) is not None

    def test_eviction_promotes_checkpoint(self):
        store = InMemoryHistoryStore(max_ticks=3, checkpoint_interval=5)
        # Tick 0 is checkpoint, ticks 1,2 are deltas
        for i in range(4):
            store.record_tick(_snapshot(i, [_entity(1, A={"v": i})]))

        # After evicting tick 0, tick 1 should become a checkpoint
        assert store.get_snapshot(1) is not None
        result = store.get_snapshot(1)
        assert result is not None
        data = {c.type_short: c.data for c in result.entities[0].components}
        assert data["A"]["v"] == 1

    def test_clear(self):
        store = InMemoryHistoryStore()
        store.record_tick(_snapshot(0, []))
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
            store.record_tick(_snapshot(i, [_entity(1, A={"v": i})]))
        assert list(store.stored_ticks) == [0, 1, 2, 3, 4]

    def test_eviction_uses_deque_popleft(self):
        """Eviction at scale should be O(1) via deque.popleft, not list.pop(0)."""
        store = InMemoryHistoryStore(max_ticks=100, checkpoint_interval=50)
        for i in range(200):
            store.record_tick(_snapshot(i, [_entity(1, A={"v": i})]))
        assert store.tick_count == 100
        assert list(store.stored_ticks)[0] == 100


class TestComputeEntityLifecycles:
    def test_basic_lifecycles(self):
        store = InMemoryHistoryStore(max_ticks=100, checkpoint_interval=10)
        store.record_tick(_snapshot(0, [_entity(1, A={}), _entity(2, B={})]))
        store.record_tick(_snapshot(1, [_entity(1, A={}), _entity(2, B={}), _entity(3, C={})]))
        store.record_tick(_snapshot(2, [_entity(1, A={}), _entity(3, C={})]))

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
        store.record_tick(_snapshot(0, [_entity(1, A={})]))
        store.record_tick(_snapshot(10, [_entity(1, A={}), _entity(2, B={})]))
        store.record_tick(_snapshot(20, [_entity(2, B={})]))

        lifecycles = compute_entity_lifecycles(store)
        by_id = {lc["entity_id"]: lc for lc in lifecycles}

        assert by_id[1]["spawn_tick"] == 0
        assert by_id[1]["despawn_tick"] == 20
        assert by_id[2]["spawn_tick"] == 10
        assert by_id[2]["despawn_tick"] is None

    def test_empty_store(self):
        store = InMemoryHistoryStore()
        assert compute_entity_lifecycles(store) == []
