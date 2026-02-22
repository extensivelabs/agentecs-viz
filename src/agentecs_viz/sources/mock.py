"""Mock world source for testing and frontend development."""

from __future__ import annotations

import random
import time
import uuid
from typing import Any, NamedTuple

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
SYSTEM_NAMES = [
    "MovementSystem",
    "TaskScheduler",
    "MemoryConsolidation",
    "GoalPlanner",
    "PerceptionSystem",
]

# Ordered execution groups — sequential between groups, parallel within.
EXECUTION_GROUPS: list[list[str]] = [
    ["PerceptionSystem"],
    ["GoalPlanner", "TaskScheduler"],
    ["MemoryConsolidation"],
    ["MovementSystem"],
]

# Systems that generate LLM/tool child spans.
COMPLEX_SYSTEMS: set[str] = {"GoalPlanner", "TaskScheduler", "MemoryConsolidation"}


class LLMProfile(NamedTuple):
    """LLM model configuration for mock span generation."""

    model: str
    prompt_token_range: tuple[int, int]
    completion_token_range: tuple[int, int]
    input_messages: list[dict[str, str]]
    output_messages: list[dict[str, str]]


LLM_PROFILES: list[LLMProfile] = [
    LLMProfile(
        model="gpt-4o",
        prompt_token_range=(100, 2000),
        completion_token_range=(50, 500),
        input_messages=[
            {"role": "system", "content": "You are a helpful agent."},
            {"role": "user", "content": "Analyze the current task."},
        ],
        output_messages=[{"role": "assistant", "content": "I'll analyze the task."}],
    ),
    LLMProfile(
        model="claude-sonnet-4-20250514",
        prompt_token_range=(200, 3000),
        completion_token_range=(100, 800),
        input_messages=[
            {"role": "system", "content": "You are a planning agent."},
            {"role": "user", "content": "What should we do next?"},
        ],
        output_messages=[{"role": "assistant", "content": "I recommend the following."}],
    ),
    LLMProfile(
        model="gpt-4o-mini",
        prompt_token_range=(50, 500),
        completion_token_range=(20, 200),
        input_messages=[{"role": "user", "content": "Summarize the results."}],
        output_messages=[{"role": "assistant", "content": "Here is a brief summary."}],
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

        if self._entities:
            await self._generate_spans()

    def _build_snapshot(self) -> WorldSnapshot:
        return WorldSnapshot(
            tick=self._tick,
            timestamp=time.time(),
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
        """Generate spans for all systems in execution group order.

        Systems within the same group run in parallel (overlapping start times).
        Groups execute sequentially.
        """
        agent_entities = [
            e for e in self._entities if any(c.type_short == "Agent" for c in e.components)
        ]
        if not agent_entities:
            return

        now = time.time()
        cursor = now
        all_spans: list[SpanEventMessage] = []

        for group in EXECUTION_GROUPS:
            group_start = cursor
            group_end = group_start

            for system_name in group:
                entity = random.choice(agent_entities)
                trace_id = uuid.uuid4().hex
                root_span_id = uuid.uuid4().hex
                # Parallel systems start at roughly the same time
                sys_start = group_start + random.uniform(0, 0.005)

                if system_name in COMPLEX_SYSTEMS:
                    children: list[SpanEventMessage] = []
                    child_cursor = sys_start + random.uniform(0.005, 0.02)
                    roll = random.random()
                    if roll < 0.50:
                        child_cursor = self._generate_child_spans(
                            children,
                            trace_id,
                            root_span_id,
                            entity.id,
                            child_cursor,
                            random.randint(1, 3),
                            depth=0,
                        )
                    elif roll < 0.80:
                        child_cursor = self._generate_child_spans(
                            children,
                            trace_id,
                            root_span_id,
                            entity.id,
                            child_cursor,
                            random.randint(3, 5),
                            depth=0,
                        )
                    else:
                        child_cursor = self._generate_deep_trace(
                            children,
                            trace_id,
                            root_span_id,
                            entity.id,
                            child_cursor,
                        )
                    sys_duration = child_cursor - sys_start
                    has_error = any(s.status == SpanStatus.error for s in children)
                    all_spans.extend(children)
                else:
                    sys_duration = random.uniform(0.005, 0.04)
                    has_error = False

                root_span = SpanEventMessage(
                    span_id=root_span_id,
                    trace_id=trace_id,
                    name=system_name,
                    start_time=sys_start,
                    end_time=sys_start + sys_duration,
                    status=SpanStatus.error if has_error else SpanStatus.ok,
                    attributes={
                        "agentecs.tick": self._tick,
                        "agentecs.entity_id": entity.id,
                        "agentecs.system": system_name,
                    },
                )
                all_spans.append(root_span)
                group_end = max(group_end, sys_start + sys_duration)

            cursor = group_end + random.uniform(0.005, 0.015)

        for span in all_spans:
            self._history.record_span(span)
            await self._emit_event(span)

    def _make_llm_span(
        self,
        trace_id: str,
        parent_id: str,
        entity_id: int,
        start: float,
        duration: float,
    ) -> SpanEventMessage:
        profile = random.choice(LLM_PROFILES)
        return SpanEventMessage(
            span_id=uuid.uuid4().hex,
            trace_id=trace_id,
            parent_span_id=parent_id,
            name=f"llm.{profile.model}",
            start_time=start,
            end_time=start + duration,
            status=SpanStatus.error if random.random() < 0.08 else SpanStatus.ok,
            attributes={
                "agentecs.tick": self._tick,
                "agentecs.entity_id": entity_id,
                "gen_ai.request.model": profile.model,
                "gen_ai.usage.prompt_tokens": random.randint(*profile.prompt_token_range),
                "gen_ai.usage.completion_tokens": random.randint(*profile.completion_token_range),
                "gen_ai.request.messages": profile.input_messages,
                "gen_ai.response.messages": profile.output_messages,
            },
        )

    def _make_tool_span(
        self,
        trace_id: str,
        parent_id: str,
        entity_id: int,
        start: float,
        duration: float,
    ) -> SpanEventMessage:
        tool_name, tool_input, tool_output = random.choice(TOOL_TEMPLATES)
        return SpanEventMessage(
            span_id=uuid.uuid4().hex,
            trace_id=trace_id,
            parent_span_id=parent_id,
            name=f"tool.{tool_name}",
            start_time=start,
            end_time=start + duration,
            status=SpanStatus.error if random.random() < 0.1 else SpanStatus.ok,
            attributes={
                "agentecs.tick": self._tick,
                "agentecs.entity_id": entity_id,
                "tool.name": tool_name,
                "tool.input": tool_input,
                "tool.output": tool_output,
            },
        )

    def _generate_child_spans(
        self,
        spans: list[SpanEventMessage],
        trace_id: str,
        parent_id: str,
        entity_id: int,
        cursor: float,
        count: int,
        depth: int,
    ) -> float:
        """Generate a flat sequence of child spans under parent_id."""
        for _ in range(count):
            is_llm = random.random() < 0.6
            duration = random.uniform(0.02, 0.15) if depth > 0 else random.uniform(0.05, 0.5)

            if is_llm:
                span = self._make_llm_span(trace_id, parent_id, entity_id, cursor, duration)
            else:
                span = self._make_tool_span(trace_id, parent_id, entity_id, cursor, duration)
            spans.append(span)
            cursor = span.end_time + random.uniform(0.005, 0.03)
        return cursor

    def _generate_deep_trace(
        self,
        spans: list[SpanEventMessage],
        trace_id: str,
        parent_id: str,
        entity_id: int,
        cursor: float,
    ) -> float:
        """Generate a deeper trace: LLM -> tool -> (optional retry LLM) -> tool chain."""
        # Initial LLM call
        llm_dur = random.uniform(0.3, 1.2)
        llm = self._make_llm_span(trace_id, parent_id, entity_id, cursor, llm_dur)
        spans.append(llm)
        cursor = llm.end_time + random.uniform(0.01, 0.03)

        # Tool calls parented under the initial LLM span
        tool_count = random.randint(1, 3)
        for i in range(tool_count):
            tool_dur = random.uniform(0.1, 0.6)
            tool = self._make_tool_span(trace_id, llm.span_id, entity_id, cursor, tool_dur)
            spans.append(tool)

            # Occasional sub-call within a tool (depth 3)
            if random.random() < 0.3:
                sub_start = tool.start_time + tool_dur * 0.2
                sub_dur = tool_dur * 0.5
                sub = self._make_llm_span(trace_id, tool.span_id, entity_id, sub_start, sub_dur)
                spans.append(sub)

            cursor = tool.end_time + random.uniform(0.01, 0.04)

            # Retry pattern: tool failed -> retry with new LLM call -> tool again
            if tool.status == SpanStatus.error and i < tool_count - 1:
                retry_llm_dur = random.uniform(0.1, 0.4)
                retry_llm = self._make_llm_span(
                    trace_id,
                    parent_id,
                    entity_id,
                    cursor,
                    retry_llm_dur,
                )
                retry_llm.status = SpanStatus.ok
                spans.append(retry_llm)
                cursor = retry_llm.end_time + random.uniform(0.01, 0.03)

        return cursor

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
