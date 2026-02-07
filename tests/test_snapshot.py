from agentecs_viz.snapshot import (
    ComponentDiff,
    ComponentSnapshot,
    EntitySnapshot,
    TickDelta,
    WorldSnapshot,
)


class TestComponentSnapshot:
    def test_create(self):
        cs = ComponentSnapshot(
            type_name="mock.Position", type_short="Position", data={"x": 1, "y": 2}
        )
        assert cs.type_short == "Position"
        assert cs.data == {"x": 1, "y": 2}

    def test_empty_data(self):
        cs = ComponentSnapshot(type_name="mock.Empty", type_short="Empty")
        assert cs.data == {}


class TestEntitySnapshot:
    def test_archetype_computed(self):
        entity = EntitySnapshot(
            id=1,
            components=[
                ComponentSnapshot(type_name="mock.Velocity", type_short="Velocity", data={}),
                ComponentSnapshot(type_name="mock.Position", type_short="Position", data={}),
            ],
        )
        assert entity.archetype == ("Position", "Velocity")

    def test_empty_components(self):
        entity = EntitySnapshot(id=0)
        assert entity.archetype == ()

    def test_json_roundtrip(self):
        entity = EntitySnapshot(
            id=5,
            components=[
                ComponentSnapshot(type_name="mock.Agent", type_short="Agent", data={"name": "Bob"}),
            ],
        )
        data = entity.model_dump()
        restored = EntitySnapshot.model_validate(data)
        assert restored.id == 5
        assert restored.components[0].data["name"] == "Bob"
        assert restored.archetype == ("Agent",)


class TestWorldSnapshot:
    def test_create(self):
        ws = WorldSnapshot(
            tick=10,
            entity_count=2,
            entities=[
                EntitySnapshot(
                    id=0,
                    components=[
                        ComponentSnapshot(type_name="m.A", type_short="A", data={}),
                    ],
                ),
                EntitySnapshot(
                    id=1,
                    components=[
                        ComponentSnapshot(type_name="m.A", type_short="A", data={}),
                        ComponentSnapshot(type_name="m.B", type_short="B", data={}),
                    ],
                ),
            ],
        )
        assert ws.tick == 10
        assert ws.entity_count == 2
        assert len(ws.archetypes) == 2

    def test_archetypes_unique(self):
        ws = WorldSnapshot(
            entities=[
                EntitySnapshot(
                    id=0,
                    components=[
                        ComponentSnapshot(type_name="m.X", type_short="X", data={}),
                    ],
                ),
                EntitySnapshot(
                    id=1,
                    components=[
                        ComponentSnapshot(type_name="m.X", type_short="X", data={}),
                    ],
                ),
            ]
        )
        assert len(ws.archetypes) == 1

    def test_json_roundtrip(self):
        ws = WorldSnapshot(
            tick=3,
            timestamp=100.0,
            entity_count=1,
            entities=[EntitySnapshot(id=0)],
            metadata={"key": "value"},
        )
        data = ws.model_dump()
        restored = WorldSnapshot.model_validate(data)
        assert restored.tick == 3
        assert restored.timestamp == 100.0
        assert restored.metadata["key"] == "value"

    def test_empty_snapshot(self):
        ws = WorldSnapshot()
        assert ws.tick == 0
        assert ws.entity_count == 0
        assert ws.archetypes == []


class TestComponentDiff:
    def test_added(self):
        diff = ComponentDiff(
            component_type="Health",
            old_value=None,
            new_value={"hp": 100},
        )
        assert diff.old_value is None
        assert diff.new_value == {"hp": 100}

    def test_removed(self):
        diff = ComponentDiff(
            component_type="Health",
            old_value={"hp": 50},
            new_value=None,
        )
        assert diff.old_value == {"hp": 50}
        assert diff.new_value is None

    def test_modified(self):
        diff = ComponentDiff(
            component_type="Position",
            old_value={"x": 0},
            new_value={"x": 5},
        )
        assert diff.old_value == {"x": 0}
        assert diff.new_value == {"x": 5}


class TestTickDelta:
    def test_create(self):
        delta = TickDelta(
            tick=5,
            timestamp=200.0,
            spawned=[EntitySnapshot(id=10)],
            destroyed=[3],
            modified={
                1: [ComponentDiff(component_type="X", old_value={"a": 1}, new_value={"a": 2})]
            },
        )
        assert delta.tick == 5
        assert len(delta.spawned) == 1
        assert delta.destroyed == [3]
        assert len(delta.modified[1]) == 1

    def test_json_roundtrip(self):
        delta = TickDelta(tick=1, spawned=[], destroyed=[], modified={})
        data = delta.model_dump()
        restored = TickDelta.model_validate(data)
        assert restored.tick == 1
