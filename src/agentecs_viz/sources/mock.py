"""Mock world source for testing and frontend development.

Generates fake entity data without requiring a real AgentECS world.
"""

from __future__ import annotations

import random
from typing import Any

from agentecs_viz.config import ArchetypeConfig, VisualizationConfig
from agentecs_viz.protocol import TickEvent
from agentecs_viz.snapshot import ComponentSnapshot, EntitySnapshot, WorldSnapshot
from agentecs_viz.sources._base import TickLoopSource

# Mock simulation constants
TASK_COMPLETION_PROBABILITY = 0.05  # Chance of a task completing each tick
ENTITY_SPAWN_PROBABILITY = 0.02  # Chance of spawning a new entity each tick
ENTITY_DESPAWN_PROBABILITY = 0.02  # Chance of despawning an entity each tick
MAX_ENTITY_MULTIPLIER = 1.5  # Maximum entities as multiple of initial count
MIN_ENTITY_COUNT = 10  # Minimum entities to maintain


class MockWorldSource(TickLoopSource):
    """Mock implementation of WorldStateSource for testing.

    Generates fake entities with random components, useful for:
    - Frontend development without a backend
    - Testing the visualization pipeline
    - Demonstrating visualizer capabilities

    Args:
        entity_count: Number of entities to generate.
        tick_interval: Seconds between simulated ticks.
        archetypes: List of archetype definitions (component type names).
    """

    def __init__(
        self,
        entity_count: int = 50,
        tick_interval: float = 1.0,
        archetypes: list[tuple[str, ...]] | None = None,
        visualization_config: VisualizationConfig | None = None,
    ) -> None:
        # Create default example config if none provided
        if visualization_config is None:
            visualization_config = VisualizationConfig(
                world_name="Mock World",
                archetypes=[
                    ArchetypeConfig(
                        key="Agent,Memory,Goals",
                        label="Planning Agent",
                        color="#8b5cf6",
                        description="Agents with memory and goals",
                    ),
                    ArchetypeConfig(
                        key="Position,Velocity",
                        label="Moving Entity",
                        color="#22c55e",
                        description="Basic moving entities",
                    ),
                    ArchetypeConfig(
                        key="Agent,Position,Velocity",
                        label="Mobile Agent",
                        color="#06b6d4",
                        description="Agents that can move",
                    ),
                    ArchetypeConfig(
                        key="Task,Priority",
                        label="Task",
                        color="#f97316",
                        description="Task with priority",
                    ),
                    ArchetypeConfig(
                        key="Deadline,Task,Priority",
                        label="Urgent Task",
                        color="#f43f5e",
                        description="Task with deadline",
                    ),
                ],
                chat_enabled=True,
            )

        super().__init__(tick_interval=tick_interval, visualization_config=visualization_config)
        self._entity_count = entity_count
        self._archetypes = archetypes or [
            ("Position", "Velocity"),
            ("Position", "Velocity", "Agent"),
            ("Task", "Priority"),
            ("Task", "Priority", "Deadline"),
            ("Agent", "Memory", "Goals"),
        ]
        self._tick = 0
        self._entities: list[EntitySnapshot] = []

    async def _on_connect(self) -> None:
        """Initialize mock world with random entities."""
        self._entities = self._generate_entities()

    async def get_snapshot(self) -> WorldSnapshot:
        """Get current mock world snapshot."""
        metadata: dict[str, Any] = {"source": "mock", "paused": self._paused}
        if self._visualization_config:
            metadata["visualization"] = self._visualization_config.model_dump()

        return WorldSnapshot(
            tick=self._tick,
            entity_count=len(self._entities),
            entities=self._entities,
            metadata=metadata,
        )

    async def _tick_loop_body(self) -> None:
        """Emit tick if not paused."""
        if not self._paused:
            await self._execute_tick()

    async def send_command(self, command: str, **kwargs: object) -> None:
        """Handle control commands."""
        if command == "pause":
            self._paused = True
        elif command == "resume":
            self._paused = False
        elif command == "step":
            if self._paused:
                await self._execute_tick()
        elif command == "set_tick_rate":
            tps = kwargs.get("ticks_per_second", 1.0)
            if isinstance(tps, int | float) and tps > 0:
                self._tick_interval = 1.0 / tps

    async def _execute_tick(self) -> None:
        """Execute a single tick immediately."""
        self._tick += 1
        self._update_entities()
        snapshot = await self.get_snapshot()
        await self._emit_event(TickEvent(snapshot))

    def _generate_entities(self) -> list[EntitySnapshot]:
        """Generate random entities with components."""
        entities = []
        for i in range(self._entity_count):
            archetype_template = random.choice(self._archetypes)
            components = [self._generate_component(comp_type) for comp_type in archetype_template]
            entities.append(
                EntitySnapshot(
                    id=i,
                    components=components,
                )
            )
        return entities

    def _generate_component(self, type_name: str) -> ComponentSnapshot:
        """Generate a mock component with random data."""
        data = self._mock_component_data(type_name)
        return ComponentSnapshot(
            type_name=f"mock.components.{type_name}",
            type_short=type_name,
            data=data,
        )

    def _mock_component_data(self, type_name: str) -> dict[str, Any]:
        """Generate mock data based on component type name."""
        if type_name == "Position":
            return {"x": random.uniform(-100, 100), "y": random.uniform(-100, 100)}
        elif type_name == "Velocity":
            return {"dx": random.uniform(-5, 5), "dy": random.uniform(-5, 5)}
        elif type_name == "Agent":
            return {
                "name": f"Agent_{random.randint(1, 100)}",
                "state": random.choice(["idle", "working", "waiting"]),
            }
        elif type_name == "Task":
            return {
                "description": f"Task {random.randint(1, 1000)}",
                "status": random.choice(["pending", "in_progress", "completed"]),
            }
        elif type_name == "Priority":
            return {"level": random.randint(1, 5)}
        elif type_name == "Deadline":
            return {"remaining_ticks": random.randint(1, 100)}
        elif type_name == "Memory":
            return {"entries": random.randint(0, 50)}
        elif type_name == "Goals":
            return {"count": random.randint(1, 5)}
        else:
            return {"value": random.random()}

    def _update_entities(self) -> None:
        """Simulate entity changes each tick."""
        for entity in self._entities:
            # Build O(1) component lookup dict once per entity
            comp_by_type = {c.type_short: c for c in entity.components}

            # Update position based on velocity
            if "Position" in comp_by_type:
                pos = comp_by_type["Position"]
                vel = comp_by_type.get("Velocity")
                if vel:
                    pos.data["x"] += vel.data.get("dx", 0)
                    pos.data["y"] += vel.data.get("dy", 0)

            # Count down deadlines
            if "Deadline" in comp_by_type:
                deadline = comp_by_type["Deadline"]
                remaining = deadline.data.get("remaining_ticks", 0)
                deadline.data["remaining_ticks"] = max(0, remaining - 1)

            # Occasionally complete tasks
            if "Task" in comp_by_type:
                task = comp_by_type["Task"]
                if random.random() < TASK_COMPLETION_PROBABILITY:
                    task.data["status"] = "completed"

        # Occasionally spawn/destroy entities
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
