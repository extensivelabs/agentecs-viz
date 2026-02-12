"""Single source of truth for package version."""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__: str = version("agentecs-viz")
except PackageNotFoundError:
    __version__ = "0.0.0-dev"
