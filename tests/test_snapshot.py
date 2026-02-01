"""Tests for snapshot dataclasses."""

import json

from agentecs_viz.snapshot import ComponentSnapshot, EntitySnapshot, WorldSnapshot


class TestComponentSnapshot:
    """Tests for ComponentSnapshot."""

    def test_create_component_snapshot(self) -> None:
        """Component snapshot can be created with data."""
        snap = ComponentSnapshot(
            type_name="myapp.Position",
            type_short="Position",
            data={"x": 10.0, "y": 20.0},
        )
        assert snap.type_name == "myapp.Position"
        assert snap.type_short == "Position"
        assert snap.data == {"x": 10.0, "y": 20.0}

    def test_component_snapshot_json_serializable(self) -> None:
        """Component snapshot serializes to JSON."""
        snap = ComponentSnapshot(
            type_name="myapp.Position",
            type_short="Position",
            data={"x": 10.0, "y": 20.0},
        )
        json_str = snap.model_dump_json()
        parsed = json.loads(json_str)
        assert parsed["type_name"] == "myapp.Position"
        assert parsed["data"]["x"] == 10.0


class TestEntitySnapshot:
    """Tests for EntitySnapshot."""

    def test_create_entity_snapshot(self) -> None:
        """Entity snapshot can be created with components."""
        entity = EntitySnapshot(
            id=42,
            components=[
                ComponentSnapshot(
                    type_name="Position",
                    type_short="Position",
                    data={"x": 0, "y": 0},
                ),
                ComponentSnapshot(
                    type_name="Velocity",
                    type_short="Velocity",
                    data={"dx": 1, "dy": 0},
                ),
            ],
        )
        assert entity.id == 42
        assert len(entity.components) == 2

    def test_archetype_computed_from_components(self) -> None:
        """Archetype is computed from component type_short names, sorted."""
        entity = EntitySnapshot(
            id=1,
            components=[
                ComponentSnapshot(type_name="b.Velocity", type_short="Velocity", data={}),
                ComponentSnapshot(type_name="a.Position", type_short="Position", data={}),
            ],
        )
        # Should be sorted alphabetically
        assert entity.archetype == ("Position", "Velocity")

    def test_entity_snapshot_json_serializable(self) -> None:
        """Entity snapshot serializes to JSON with computed archetype."""
        entity = EntitySnapshot(
            id=1,
            components=[
                ComponentSnapshot(
                    type_name="Agent",
                    type_short="Agent",
                    data={"name": "test"},
                ),
            ],
        )
        json_str = entity.model_dump_json()
        parsed = json.loads(json_str)
        assert parsed["id"] == 1
        assert parsed["archetype"] == ["Agent"]


class TestWorldSnapshot:
    """Tests for WorldSnapshot."""

    def test_create_empty_world_snapshot(self) -> None:
        """Empty world snapshot has defaults."""
        snap = WorldSnapshot()
        assert snap.tick == 0
        assert snap.entity_count == 0
        assert snap.entities == []
        assert snap.archetypes == []
        assert snap.metadata == {}

    def test_create_world_snapshot_with_entities(self) -> None:
        """World snapshot can contain entities."""
        entities = [
            EntitySnapshot(
                id=1,
                components=[ComponentSnapshot(type_name="a.A", type_short="A", data={})],
            ),
            EntitySnapshot(
                id=2,
                components=[ComponentSnapshot(type_name="b.B", type_short="B", data={})],
            ),
        ]
        snap = WorldSnapshot(
            tick=100,
            entity_count=2,
            entities=entities,
            metadata={"name": "test_world"},
        )
        assert snap.tick == 100
        assert snap.entity_count == 2
        assert len(snap.entities) == 2
        assert snap.metadata["name"] == "test_world"

    def test_archetypes_computed_from_entities(self) -> None:
        """Archetypes are computed as unique values from entities."""
        entities = [
            EntitySnapshot(
                id=1,
                components=[ComponentSnapshot(type_name="a.A", type_short="A", data={})],
            ),
            EntitySnapshot(
                id=2,
                components=[ComponentSnapshot(type_name="b.B", type_short="B", data={})],
            ),
            EntitySnapshot(
                id=3,
                components=[ComponentSnapshot(type_name="a.A", type_short="A", data={})],
            ),
        ]
        snap = WorldSnapshot(tick=0, entity_count=3, entities=entities)
        # Should have 2 unique archetypes (A appears twice)
        assert len(snap.archetypes) == 2
        assert ("A",) in snap.archetypes
        assert ("B",) in snap.archetypes

    def test_world_snapshot_json_serializable(self) -> None:
        """World snapshot serializes to JSON."""
        snap = WorldSnapshot(
            tick=5,
            entity_count=0,
            metadata={"source": "test"},
        )
        json_str = snap.model_dump_json()
        parsed = json.loads(json_str)
        assert parsed["tick"] == 5
        assert parsed["metadata"]["source"] == "test"
