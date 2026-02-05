"""Verify the package is importable."""


def test_import():
    """Package can be imported."""
    import agentecs_viz

    assert agentecs_viz.__doc__
