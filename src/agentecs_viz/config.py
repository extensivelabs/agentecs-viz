"""Visualization configuration models."""

from __future__ import annotations

from pydantic import BaseModel, Field


class ArchetypeConfig(BaseModel):
    """Visual appearance config for a specific archetype."""

    key: str = Field(description="Archetype key (sorted, comma-joined component names)")
    label: str | None = Field(default=None, description="Friendly display name")
    color: str | None = Field(default=None, description="Hex color (e.g., '#6366f1')")
    description: str | None = Field(default=None, description="Tooltip description")


class ComponentMetricConfig(BaseModel):
    """Display config for a component's key metric."""

    component: str = Field(description="Short component name (e.g., 'Position')")
    metric_field: str | None = Field(default=None, description="Field to display as metric")
    format: str | None = Field(default=None, description="Format pattern (e.g., '({x}, {y})')")


class FieldHints(BaseModel):
    """Heuristic hints for auto-detecting component field roles."""

    status_fields: list[str] = Field(
        default_factory=lambda: ["status", "state", "phase"],
        description="Fields likely to contain status values",
    )
    error_fields: list[str] = Field(
        default_factory=lambda: ["error", "error_message", "last_error"],
        description="Fields likely to contain error information",
    )


class VisualizationConfig(BaseModel):
    """Per-world visualization config, sent to frontend via WebSocket."""

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

    field_hints: FieldHints = Field(default_factory=FieldHints, description="Heuristic field hints")

    chat_enabled: bool = Field(default=True, description="Show Chat tab in UI")

    entity_label_template: str | None = Field(
        default=None, description="Template for entity labels"
    )
