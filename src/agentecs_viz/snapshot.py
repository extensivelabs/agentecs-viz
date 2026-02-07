"""Snapshot models for world state serialization."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, computed_field


class ComponentSnapshot(BaseModel):
    type_name: str = Field(description="Fully qualified component type name")
    type_short: str = Field(description="Short type name for display")
    data: dict[str, Any] = Field(default_factory=dict, description="Component data")


class EntitySnapshot(BaseModel):
    id: int = Field(description="Entity ID")
    components: list[ComponentSnapshot] = Field(
        default_factory=list, description="Component snapshots"
    )

    @computed_field  # type: ignore[misc]
    @property
    def archetype(self) -> tuple[str, ...]:
        return tuple(sorted(c.type_short for c in self.components))


class WorldSnapshot(BaseModel):
    tick: int = Field(default=0, description="Current tick number")
    timestamp: float = Field(default=0.0, description="Timestamp of the snapshot")
    entity_count: int = Field(default=0, description="Total entity count")
    entities: list[EntitySnapshot] = Field(default_factory=list, description="All entity snapshots")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Optional world metadata")

    @computed_field  # type: ignore[misc]
    @property
    def archetypes(self) -> list[tuple[str, ...]]:
        return sorted({e.archetype for e in self.entities})


class ComponentDiff(BaseModel):
    component_type: str = Field(description="Short component type name")
    old_value: dict[str, Any] | None = Field(default=None, description="Previous value")
    new_value: dict[str, Any] | None = Field(default=None, description="Current value")


class TickDelta(BaseModel):
    tick: int = Field(description="Tick number this delta describes")
    timestamp: float = Field(default=0.0, description="Timestamp of the tick")
    spawned: list[EntitySnapshot] = Field(
        default_factory=list, description="Newly spawned entities"
    )
    destroyed: list[int] = Field(default_factory=list, description="IDs of destroyed entities")
    modified: dict[int, list[ComponentDiff]] = Field(
        default_factory=dict, description="Entity ID -> component diffs"
    )
