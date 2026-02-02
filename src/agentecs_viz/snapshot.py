"""Snapshot dataclasses for world state serialization.

These models represent the state of the world at a point in time,
suitable for JSON serialization and frontend consumption.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, computed_field


class ComponentSnapshot(BaseModel):
    """Snapshot of a single component's data.

    Attributes:
        type_name: Fully qualified type name (e.g., "myapp.components.Position").
        type_short: Short type name for display (e.g., "Position").
        data: Component data as a JSON-serializable dict.
    """

    type_name: str = Field(description="Fully qualified component type name")
    type_short: str = Field(description="Short type name for display")
    data: dict[str, Any] = Field(default_factory=dict, description="Component data")


class EntitySnapshot(BaseModel):
    """Snapshot of a single entity's state.

    Attributes:
        id: Entity ID (integer).
        components: List of component snapshots.
        archetype: Computed sorted tuple of component type names.
    """

    id: int = Field(description="Entity ID")
    components: list[ComponentSnapshot] = Field(
        default_factory=list,
        description="Component snapshots",
    )

    @computed_field  # type: ignore[misc]
    @property
    def archetype(self) -> tuple[str, ...]:
        """Sorted component type names defining the archetype."""
        return tuple(sorted(c.type_short for c in self.components))


class WorldSnapshot(BaseModel):
    """Snapshot of the entire world state at a point in time.

    Attributes:
        tick: Current tick number.
        entity_count: Total number of entities.
        entities: List of entity snapshots.
        archetypes: Computed set of unique archetype signatures.
        metadata: Optional metadata (e.g., world name, config).
    """

    tick: int = Field(default=0, description="Current tick number")
    entity_count: int = Field(default=0, description="Total entity count")
    entities: list[EntitySnapshot] = Field(
        default_factory=list,
        description="All entity snapshots",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Optional world metadata",
    )

    @computed_field  # type: ignore[misc]
    @property
    def archetypes(self) -> list[tuple[str, ...]]:
        """Unique archetype signatures from all entities."""
        return list({e.archetype for e in self.entities})
