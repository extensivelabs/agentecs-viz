"""Hatch build hook to bundle frontend dist into the wheel.

This hook copies the built frontend from viz/frontend/dist into the package
at src/agentecs_viz/frontend/ during wheel build, enabling seamless
`pip install agentecs-viz && agentecs-viz serve` experience.

The frontend must be pre-built before running `uv build` or `pip wheel`.
Use `task frontend:build` or `npm run build` in viz/frontend/ first.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class FrontendBuildHook(BuildHookInterface):
    """Build hook that bundles the frontend dist into the wheel."""

    PLUGIN_NAME = "frontend"

    def initialize(self, version: str, build_data: dict[str, Any]) -> None:
        """Initialize the build hook - copy frontend dist into package.

        Args:
            version: The version being built.
            build_data: Build configuration data.
        """
        # Skip frontend bundling for editable installs (dev mode)
        if version == "editable":
            return

        root = Path(self.root)
        frontend_src = root / "frontend" / "dist"
        frontend_dest = root / "src" / "agentecs_viz" / "frontend"

        if not frontend_src.exists():
            raise RuntimeError(
                f"Frontend dist not found at {frontend_src}. "
                "Build frontend first with: task frontend:build"
            )

        # Clean destination if it exists
        if frontend_dest.exists():
            shutil.rmtree(frontend_dest)

        # Copy frontend dist to package location
        shutil.copytree(frontend_src, frontend_dest)
