"""Visualization configuration models.

This module provides Pydantic models for configuring how the visualization
frontend renders entities, archetypes, and UI features.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class ArchetypeConfig(BaseModel):
    """Configuration for a specific archetype's visual appearance."""

    key: str = Field(description="Archetype key (sorted, comma-joined component names)")
    label: str | None = Field(default=None, description="Friendly display name")
    color: str | None = Field(default=None, description="Hex color (e.g., '#6366f1')")
    description: str | None = Field(default=None, description="Tooltip description")


class ComponentMetricConfig(BaseModel):
    """Configuration for displaying a component's key metric."""

    component: str = Field(description="Short component name (e.g., 'Position')")
    metric_field: str | None = Field(default=None, description="Field to display as metric")
    format: str | None = Field(default=None, description="Format pattern (e.g., '({x}, {y})')")


class VisualizationConfig(BaseModel):
    """Per-world visualization configuration.

    This configuration flows from WorldStateSource implementations to the frontend
    via WebSocket, allowing per-world customization of colors, labels, and features.

    Example:
        config = VisualizationConfig(
            world_name="Task Dispatch Demo",
            archetypes=[
                ArchetypeConfig(
                    key="AgentState,Task",
                    label="Worker Agent",
                    color="#8b5cf6",
                    description="Agents processing tasks"
                ),
            ],
            chat_enabled=True,
        )
    """

    world_name: str | None = Field(default=None, description="Display name for the world")

    archetypes: list[ArchetypeConfig] = Field(
        default_factory=list, description="Per-archetype display configurations"
    )

    color_palette: list[str] | None = Field(
        default=None, description="Override default color palette (list of hex colors)"
    )

    component_metrics: list[ComponentMetricConfig] = Field(
        default_factory=list, description="Component metric display configurations"
    )

    chat_enabled: bool = Field(default=True, description="Show Chat tab in UI")

    entity_label_template: str | None = Field(
        default=None, description="Template for entity labels"
    )
