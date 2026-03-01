from agentecs_viz.config import (
    ArchetypeConfig,
    ComponentMetricConfig,
    FieldHints,
    VisualizationConfig,
)


class TestFieldHints:
    def test_defaults(self):
        hints = FieldHints()
        assert hints.status_fields == ["status", "state", "phase"]
        assert hints.error_fields == ["error", "error_message", "last_error"]


class TestVisualizationConfig:
    def test_roundtrip(self):
        config = VisualizationConfig(
            world_name="Test World",
            archetypes=[
                ArchetypeConfig(key="Agent,Position", label="Agent", color="#06b6d4"),
            ],
            color_palette=["#111111", "#222222"],
            component_metrics=[
                ComponentMetricConfig(component="Position", metric_field="x", format="{x}"),
            ],
            field_hints=FieldHints(status_fields=["status"], error_fields=["error"]),
            chat_enabled=False,
            entity_label_template="{id}",
        )

        reloaded = VisualizationConfig.model_validate_json(config.model_dump_json())
        assert reloaded == config

    def test_defaults_and_empty_values(self):
        config = VisualizationConfig()
        assert config.world_name is None
        assert config.archetypes == []
        assert config.color_palette is None
        assert config.component_metrics == []
        assert isinstance(config.field_hints, FieldHints)
        assert config.chat_enabled is True
        assert config.entity_label_template is None
