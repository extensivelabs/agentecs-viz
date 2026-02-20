"""Mock world source for testing and frontend development."""

from __future__ import annotations

import random
import time
import uuid
from typing import Any

from agentecs_viz.config import ArchetypeConfig, VisualizationConfig
from agentecs_viz.history import InMemoryHistoryStore
from agentecs_viz.protocol import (
    ErrorEventMessage,
    ErrorSeverity,
    SnapshotMessage,
    SpanEventMessage,
    SpanStatus,
)
from agentecs_viz.snapshot import ComponentSnapshot, EntitySnapshot, WorldSnapshot
from agentecs_viz.sources._base import TickLoopSource

TASK_COMPLETION_PROBABILITY = 0.05
ENTITY_SPAWN_PROBABILITY = 0.02
ENTITY_DESPAWN_PROBABILITY = 0.02
MAX_ENTITY_MULTIPLIER = 1.5
MIN_ENTITY_COUNT = 10
ERROR_PROBABILITY = 0.10
SPAN_PROBABILITY = 0.30

SYSTEM_NAMES = [
    "MovementSystem",
    "TaskScheduler",
    "MemoryConsolidation",
    "GoalPlanner",
    "PerceptionSystem",
]

LLM_MODELS = ["gpt-4o", "claude-sonnet-4-20250514", "gpt-4o-mini"]

LLM_TOKEN_RANGES: list[tuple[tuple[int, int], tuple[int, int]]] = [
    ((100, 2000), (50, 500)),
    ((200, 3000), (100, 800)),
    ((50, 500), (20, 200)),
]

LLM_MESSAGES: list[tuple[list[dict[str, str]], list[dict[str, str]]]] = [
    (
        [
            {"role": "system", "content": "You are a helpful agent."},
            {"role": "user", "content": "Analyze the current task."},
        ],
        [{"role": "assistant", "content": "I'll analyze the task."}],
    ),
    (
        [
            {"role": "system", "content": "You are a planning agent."},
            {"role": "user", "content": "What should we do next?"},
        ],
        [{"role": "assistant", "content": "I recommend the following."}],
    ),
    (
        [{"role": "user", "content": "Summarize the results."}],
        [{"role": "assistant", "content": "Here is a brief summary."}],
    ),
]

TOOL_TEMPLATES: list[tuple[str, dict[str, Any], dict[str, Any]]] = [
    (
        "web_search",
        {"query": "latest research on agents"},
        {"results": [{"title": "Survey", "url": "https://example.com"}]},
    ),
    (
        "code_interpreter",
        {"code": "import pandas as pd\ndf.describe()"},
        {"stdout": "count  mean\nval  100  42.5"},
    ),
    (
        "file_read",
        {"path": "/data/config.json"},
        {"content": '{"setting": "value"}'},
    ),
]

ERROR_TEMPLATES: list[tuple[str, ErrorSeverity]] = [
    ("LLM rate limit exceeded", ErrorSeverity.critical),
    ("Tool execution failed: timeout", ErrorSeverity.critical),
    ("Memory limit approaching threshold", ErrorSeverity.warning),
    ("Task retry count exceeded", ErrorSeverity.warning),
    ("Stale context detected, refreshing", ErrorSeverity.warning),
    ("Goal evaluation returned low confidence", ErrorSeverity.info),
    ("Unexpected API response format", ErrorSeverity.warning),
    ("Duplicate task assignment detected", ErrorSeverity.info),
]


def _default_archetypes() -> list[tuple[str, ...]]:
    return [
        ("Agent", "Position"),
        ("Agent", "Task", "Priority"),
        ("Agent", "Memory", "Goals"),
        ("Task", "Deadline"),
        ("Position", "Velocity"),
    ]


def _default_config() -> VisualizationConfig:
    return VisualizationConfig(
        world_name="Mock World",
        archetypes=[
            ArchetypeConfig(
                key="Agent,Position",
                label="Positioned Agent",
                color="#06b6d4",
                description="Agents with spatial position",
            ),
            ArchetypeConfig(
                key="Agent,Priority,Task",
                label="Task Agent",
                color="#f97316",
                description="Agents processing tasks",
            ),
            ArchetypeConfig(
                key="Agent,Goals,Memory",
                label="Planning Agent",
                color="#8b5cf6",
                description="Agents with memory and goals",
            ),
            ArchetypeConfig(
                key="Deadline,Task",
                label="Timed Task",
                color="#f43f5e",
                description="Tasks with deadlines",
            ),
            ArchetypeConfig(
                key="Position,Velocity",
                label="Moving Entity",
                color="#22c55e",
                description="Basic moving entities",
            ),
        ],
        chat_enabled=True,
    )


class MockWorldSource(TickLoopSource):
    """Generates fake entities with random components for testing and demos."""

    def __init__(
        self,
        entity_count: int = 50,
        tick_interval: float = 1.0,
        archetypes: list[tuple[str, ...]] | None = None,
        visualization_config: VisualizationConfig | None = None,
        max_history_ticks: int = 1000,
    ) -> None:
        if visualization_config is None:
            visualization_config = _default_config()

        super().__init__(
            tick_interval=tick_interval,
            visualization_config=visualization_config,
        )
        self._entity_count = entity_count
        self._archetypes = archetypes or _default_archetypes()
        self._tick = 0
        self._entities: list[EntitySnapshot] = []
        self._history = InMemoryHistoryStore(
            max_ticks=max_history_ticks,
            checkpoint_interval=100,
        )

    @property
    def history(self) -> InMemoryHistoryStore:
        return self._history

    @property
    def supports_history(self) -> bool:
        return True

    @property
    def tick_range(self) -> tuple[int, int] | None:
        return self._history.get_tick_range()

    async def _on_connect(self) -> None:
        self._tick = 0
        self._paused = False
        self._history.clear()
        self._entities = self._generate_entities()
        snapshot = self._build_snapshot()
        self._history.record_tick(snapshot)

    async def get_snapshot(self, tick: int | None = None) -> WorldSnapshot:
        if tick is not None and tick != self._tick:
            historical = self._history.get_snapshot(tick)
            if historical is not None:
                return historical
        return self._build_snapshot()

    def get_current_tick(self) -> int:
        return self._tick

    async def _tick_loop_body(self) -> None:
        if not self._paused:
            await self._execute_tick()

    async def send_command(self, command: str, **kwargs: Any) -> None:
        if command == "pause":
            self._paused = True
        elif command == "resume":
            self._paused = False
        elif command == "step":
            if self._paused:
                await self._execute_tick()
        elif command == "set_speed":
            tps = kwargs.get("ticks_per_second", 1.0)
            if isinstance(tps, int | float) and not isinstance(tps, bool) and tps > 0:
                self._tick_interval = 1.0 / tps

    async def _execute_tick(self) -> None:
        self._tick += 1
        self._update_entities()
        snapshot = self._build_snapshot()
        self._history.record_tick(snapshot)
        await self._emit_event(SnapshotMessage(tick=self._tick, snapshot=snapshot))

        if self._entities and random.random() < ERROR_PROBABILITY:
            entity = random.choice(self._entities)
            message, severity = random.choice(ERROR_TEMPLATES)
            error = ErrorEventMessage(
                tick=self._tick,
                entity_id=entity.id,
                message=message,
                severity=severity,
            )
            self._history.record_error(error)
            await self._emit_event(error)

        if self._entities and random.random() < SPAN_PROBABILITY:
            await self._generate_spans()

    def _build_snapshot(self) -> WorldSnapshot:
        return WorldSnapshot(
            tick=self._tick,
            timestamp=time.time(),
            entity_count=len(self._entities),
            entities=self._entities,
            metadata={"source": "mock", "paused": self._paused},
        )

    def _generate_entities(self) -> list[EntitySnapshot]:
        entities = []
        for i in range(self._entity_count):
            archetype_template = random.choice(self._archetypes)
            components = [self._generate_component(comp_type) for comp_type in archetype_template]
            entities.append(EntitySnapshot(id=i, components=components))
        return entities

    def _generate_component(self, type_name: str) -> ComponentSnapshot:
        return ComponentSnapshot(
            type_name=f"mock.components.{type_name}",
            type_short=type_name,
            data=self._mock_component_data(type_name),
        )

    def _mock_component_data(self, type_name: str) -> dict[str, Any]:
        generators: dict[str, Any] = {
            "Position": lambda: {"x": random.uniform(-100, 100), "y": random.uniform(-100, 100)},
            "Velocity": lambda: {"dx": random.uniform(-5, 5), "dy": random.uniform(-5, 5)},
            "Agent": lambda: {
                "name": f"Agent_{random.randint(1, 100)}",
                "state": random.choice(["idle", "working", "waiting"]),
            },
            "Task": lambda: {
                "description": f"Task {random.randint(1, 1000)}",
                "status": random.choice(["pending", "in_progress", "completed"]),
            },
            "Priority": lambda: {"level": random.randint(1, 5)},
            "Deadline": lambda: {"remaining_ticks": random.randint(1, 100)},
            "Memory": lambda: {"entries": random.randint(0, 50)},
            "Goals": lambda: {"count": random.randint(1, 5)},
        }
        gen = generators.get(type_name)
        if gen:
            return gen()  # type: ignore[no-any-return]
        return {"value": random.random()}

    async def _generate_spans(self) -> None:
        agent_entities = [
            e for e in self._entities if any(c.type_short == "Agent" for c in e.components)
        ]
        if not agent_entities:
            return

        entity = random.choice(agent_entities)
        trace_id = uuid.uuid4().hex
        root_span_id = uuid.uuid4().hex
        now = time.time()
        system_name = random.choice(SYSTEM_NAMES)

        child_count = random.randint(1, 2)
        child_spans: list[SpanEventMessage] = []

        cursor = now
        for _ in range(child_count):
            is_llm = random.random() < 0.6
            child_duration = random.uniform(0.05, 0.3)
            child_status = SpanStatus.error if random.random() < 0.1 else SpanStatus.ok

            if is_llm:
                idx = random.randrange(len(LLM_MODELS))
                model = LLM_MODELS[idx]
                prompt_range, comp_range = LLM_TOKEN_RANGES[idx]
                input_msgs, output_msgs = LLM_MESSAGES[idx]
                attrs: dict[str, Any] = {
                    "agentecs.tick": self._tick,
                    "agentecs.entity_id": entity.id,
                    "gen_ai.request.model": model,
                    "gen_ai.usage.prompt_tokens": random.randint(*prompt_range),
                    "gen_ai.usage.completion_tokens": random.randint(*comp_range),
                    "gen_ai.request.messages": input_msgs,
                    "gen_ai.response.messages": output_msgs,
                }
                span_name = f"llm.{model}"
            else:
                tool_name, tool_input, tool_output = random.choice(TOOL_TEMPLATES)
                attrs = {
                    "agentecs.tick": self._tick,
                    "agentecs.entity_id": entity.id,
                    "tool.name": tool_name,
                    "tool.input": tool_input,
                    "tool.output": tool_output,
                }
                span_name = f"tool.{tool_name}"

            child_span = SpanEventMessage(
                span_id=uuid.uuid4().hex,
                trace_id=trace_id,
                parent_span_id=root_span_id,
                name=span_name,
                start_time=cursor,
                end_time=cursor + child_duration,
                status=child_status,
                attributes=attrs,
            )
            child_spans.append(child_span)
            cursor += child_duration + random.uniform(0.01, 0.05)

        total_duration = cursor - now
        has_error = any(s.status == SpanStatus.error for s in child_spans)
        root_status = SpanStatus.error if has_error else SpanStatus.ok
        root_span = SpanEventMessage(
            span_id=root_span_id,
            trace_id=trace_id,
            name=system_name,
            start_time=now,
            end_time=now + total_duration,
            status=root_status,
            attributes={
                "agentecs.tick": self._tick,
                "agentecs.entity_id": entity.id,
                "agentecs.system": system_name,
            },
        )

        all_spans = [root_span, *child_spans]
        for span in all_spans:
            self._history.record_span(span)
            await self._emit_event(span)

    def _update_entities(self) -> None:
        for entity in self._entities:
            comp_by_type = {c.type_short: c for c in entity.components}

            if "Position" in comp_by_type:
                pos = comp_by_type["Position"]
                vel = comp_by_type.get("Velocity")
                if vel:
                    pos.data["x"] += vel.data.get("dx", 0)
                    pos.data["y"] += vel.data.get("dy", 0)

            if "Deadline" in comp_by_type:
                deadline = comp_by_type["Deadline"]
                remaining = deadline.data.get("remaining_ticks", 0)
                deadline.data["remaining_ticks"] = max(0, remaining - 1)

            if "Task" in comp_by_type:
                task = comp_by_type["Task"]
                if random.random() < TASK_COMPLETION_PROBABILITY:
                    task.data["status"] = "completed"

        max_entities = self._entity_count * MAX_ENTITY_MULTIPLIER
        if random.random() < ENTITY_SPAWN_PROBABILITY and len(self._entities) < max_entities:
            new_id = max(e.id for e in self._entities) + 1 if self._entities else 0
            archetype_template = random.choice(self._archetypes)
            self._entities.append(
                EntitySnapshot(
                    id=new_id,
                    components=[self._generate_component(ct) for ct in archetype_template],
                )
            )

        if random.random() < ENTITY_DESPAWN_PROBABILITY and len(self._entities) > MIN_ENTITY_COUNT:
            self._entities.pop(random.randrange(len(self._entities)))
