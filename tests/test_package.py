def test_import():
    import agentecs_viz

    assert agentecs_viz.__doc__


def test_exports():
    from agentecs_viz import (
        ComponentSnapshot,
        EntitySnapshot,
        InMemoryHistoryStore,
        TickDelta,
        VisualizationConfig,
        WorldSnapshot,
        WorldStateSource,
        create_app,
    )

    assert WorldStateSource is not None
    assert WorldSnapshot is not None
    assert EntitySnapshot is not None
    assert ComponentSnapshot is not None
    assert TickDelta is not None
    assert VisualizationConfig is not None
    assert InMemoryHistoryStore is not None
    assert create_app is not None


def test_sources_exports():
    from agentecs_viz.sources import MockWorldSource

    assert MockWorldSource is not None
