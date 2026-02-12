import importlib

from agentecs_viz._version import __version__


def test_import():
    import agentecs_viz

    assert agentecs_viz.__doc__


def test_version_from_metadata():
    assert isinstance(__version__, str)
    assert __version__ != ""


def test_version_fallback(monkeypatch):
    import agentecs_viz._version as version_mod

    monkeypatch.setattr(
        "importlib.metadata.version",
        lambda _name: (_ for _ in ()).throw(importlib.metadata.PackageNotFoundError()),
    )
    importlib.reload(version_mod)
    assert version_mod.__version__ == "0.0.0-dev"
    # Restore
    importlib.reload(version_mod)


def test_version_reexported():
    from agentecs_viz import __version__ as pkg_version

    assert pkg_version == __version__


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
