"""History storage with checkpoint + delta compression."""

from __future__ import annotations

import logging
from typing import Any

from agentecs_viz.snapshot import (
    ComponentDiff,
    ComponentSnapshot,
    EntitySnapshot,
    TickDelta,
    WorldSnapshot,
)

logger = logging.getLogger(__name__)


def _diff_entity(old: EntitySnapshot, new: EntitySnapshot) -> list[ComponentDiff]:
    """Compute component-level diffs between two snapshots of the same entity."""
    diffs: list[ComponentDiff] = []
    old_comps = {c.type_short: c for c in old.components}
    new_comps = {c.type_short: c for c in new.components}

    for comp_type in sorted(set(old_comps) | set(new_comps)):
        old_comp = old_comps.get(comp_type)
        new_comp = new_comps.get(comp_type)

        if old_comp is None:
            diffs.append(
                ComponentDiff(
                    component_type=comp_type,
                    old_value=None,
                    new_value=new_comp.data if new_comp else None,
                )
            )
        elif new_comp is None:
            diffs.append(
                ComponentDiff(
                    component_type=comp_type,
                    old_value=old_comp.data,
                    new_value=None,
                )
            )
        elif old_comp.data != new_comp.data:
            diffs.append(
                ComponentDiff(
                    component_type=comp_type,
                    old_value=old_comp.data,
                    new_value=new_comp.data,
                )
            )

    return diffs


def _compute_delta(old: WorldSnapshot, new: WorldSnapshot) -> TickDelta:
    old_ids = {e.id: e for e in old.entities}
    new_ids = {e.id: e for e in new.entities}

    spawned = [e for e in new.entities if e.id not in old_ids]
    destroyed = [eid for eid in old_ids if eid not in new_ids]

    modified: dict[int, list[ComponentDiff]] = {}
    for eid, new_entity in new_ids.items():
        if eid in old_ids:
            diffs = _diff_entity(old_ids[eid], new_entity)
            if diffs:
                modified[eid] = diffs

    return TickDelta(
        tick=new.tick,
        timestamp=new.timestamp,
        spawned=spawned,
        destroyed=destroyed,
        modified=modified,
    )


def _apply_delta(snapshot: WorldSnapshot, delta: TickDelta) -> WorldSnapshot:
    """Apply a TickDelta to a snapshot to produce the next snapshot."""
    entities_by_id = {e.id: e.model_copy(deep=True) for e in snapshot.entities}

    for eid in delta.destroyed:
        entities_by_id.pop(eid, None)

    for eid, diffs in delta.modified.items():
        entity = entities_by_id.get(eid)
        if entity is None:
            continue
        comps_by_type = {c.type_short: c for c in entity.components}

        for diff in diffs:
            if diff.old_value is None and diff.new_value is not None:
                comps_by_type[diff.component_type] = ComponentSnapshot(
                    type_name=f"unknown.{diff.component_type}",
                    type_short=diff.component_type,
                    data=diff.new_value,
                )
            elif diff.new_value is None:
                comps_by_type.pop(diff.component_type, None)
            elif diff.new_value is not None:
                comp = comps_by_type.get(diff.component_type)
                if comp:
                    comp.data = diff.new_value
                else:
                    comps_by_type[diff.component_type] = ComponentSnapshot(
                        type_name=f"unknown.{diff.component_type}",
                        type_short=diff.component_type,
                        data=diff.new_value,
                    )

        entity.components = list(comps_by_type.values())

    for entity in delta.spawned:
        entities_by_id[entity.id] = entity.model_copy(deep=True)

    entities = list(entities_by_id.values())
    return WorldSnapshot(
        tick=delta.tick,
        timestamp=delta.timestamp,
        entity_count=len(entities),
        entities=entities,
        metadata=snapshot.metadata,
    )


class InMemoryHistoryStore:
    """Bounded in-memory history using checkpoint + delta compression.

    Full snapshots stored at checkpoint_interval; deltas in between.
    Reconstructs any tick by replaying deltas from nearest checkpoint.
    """

    def __init__(
        self,
        max_ticks: int = 10_000,
        checkpoint_interval: int = 100,
    ) -> None:
        self._max_ticks = max_ticks
        self._checkpoint_interval = checkpoint_interval
        self._checkpoints: dict[int, WorldSnapshot] = {}
        self._deltas: dict[int, TickDelta] = {}
        self._tick_order: list[int] = []
        self._last_snapshot: WorldSnapshot | None = None

    @property
    def tick_count(self) -> int:
        return len(self._tick_order)

    @property
    def max_ticks(self) -> int:
        return self._max_ticks

    @property
    def checkpoint_interval(self) -> int:
        return self._checkpoint_interval

    def record_tick(self, snapshot: WorldSnapshot) -> None:
        """Record a world snapshot as checkpoint or delta."""
        tick = snapshot.tick
        is_first = len(self._tick_order) == 0
        is_checkpoint = is_first or (tick % self._checkpoint_interval == 0)

        if is_checkpoint:
            self._checkpoints[tick] = snapshot.model_copy(deep=True)
        elif self._last_snapshot is not None:
            delta = _compute_delta(self._last_snapshot, snapshot)
            self._deltas[tick] = delta

        self._tick_order.append(tick)
        self._last_snapshot = snapshot.model_copy(deep=True)

        while len(self._tick_order) > self._max_ticks:
            self._evict_oldest()

    def _evict_oldest(self) -> None:
        """Evict oldest tick, promoting next tick to checkpoint if needed."""
        if not self._tick_order:
            return

        old_tick = self._tick_order.pop(0)
        was_checkpoint = old_tick in self._checkpoints

        if was_checkpoint:
            old_snapshot = self._checkpoints.pop(old_tick)
            # If the next tick exists and is a delta, promote it to a checkpoint
            if self._tick_order:
                next_tick = self._tick_order[0]
                if next_tick in self._deltas:
                    delta = self._deltas.pop(next_tick)
                    self._checkpoints[next_tick] = _apply_delta(old_snapshot, delta)
        else:
            self._deltas.pop(old_tick, None)

    def get_snapshot(self, tick: int) -> WorldSnapshot | None:
        """Reconstruct world snapshot at the given tick."""
        if tick not in self._checkpoints and tick not in self._deltas:
            return None

        if tick in self._checkpoints:
            return self._checkpoints[tick].model_copy(deep=True)

        checkpoint_tick = None
        for t in self._tick_order:
            if t > tick:
                break
            if t in self._checkpoints:
                checkpoint_tick = t

        if checkpoint_tick is None:
            return None

        snapshot = self._checkpoints[checkpoint_tick].model_copy(deep=True)
        for t in self._tick_order:
            if t <= checkpoint_tick:
                continue
            if t > tick:
                break
            if t in self._deltas:
                snapshot = _apply_delta(snapshot, self._deltas[t])

        return snapshot

    def get_tick_range(self) -> tuple[int, int] | None:
        if not self._tick_order:
            return None
        return self._tick_order[0], self._tick_order[-1]

    def clear(self) -> None:
        self._checkpoints.clear()
        self._deltas.clear()
        self._tick_order.clear()
        self._last_snapshot = None


def compute_entity_lifecycles(
    store: InMemoryHistoryStore,
) -> list[dict[str, Any]]:
    """Compute entity spawn/despawn ticks from stored history."""
    tick_range = store.get_tick_range()
    if not tick_range:
        return []

    lifecycles: dict[int, dict[str, Any]] = {}
    previous_ids: set[int] = set()

    for tick in range(tick_range[0], tick_range[1] + 1):
        snapshot = store.get_snapshot(tick)
        if not snapshot:
            continue

        current_ids = {e.id for e in snapshot.entities}

        for entity_id in current_ids - previous_ids:
            entity = next(e for e in snapshot.entities if e.id == entity_id)
            archetype = ",".join(entity.archetype)
            lifecycles[entity_id] = {
                "entity_id": entity_id,
                "spawn_tick": tick,
                "despawn_tick": None,
                "archetype": archetype,
            }

        for entity_id in previous_ids - current_ids:
            if entity_id in lifecycles:
                lifecycles[entity_id]["despawn_tick"] = tick

        previous_ids = current_ids

    return list(lifecycles.values())
