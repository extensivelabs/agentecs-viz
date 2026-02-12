from agentecs_viz.snapshot import ComponentSnapshot, EntitySnapshot, WorldSnapshot


def make_entity(eid: int, **comp_data: dict) -> EntitySnapshot:
    components = [
        ComponentSnapshot(type_name=f"m.{name}", type_short=name, data=data)
        for name, data in comp_data.items()
    ]
    return EntitySnapshot(id=eid, components=components)


def make_snapshot(tick: int, entities: list[EntitySnapshot]) -> WorldSnapshot:
    return WorldSnapshot(
        tick=tick, timestamp=float(tick), entity_count=len(entities), entities=entities
    )
