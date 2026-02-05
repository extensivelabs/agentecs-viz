"""Local world source wrapping an in-process World instance.

Provides real-time access to a World running in the same process.
The source controls the World by calling tick_async() at configured intervals.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from agentecs_viz.config import VisualizationConfig
from agentecs_viz.protocol import TickEvent
from agentecs_viz.snapshot import ComponentSnapshot, EntitySnapshot, WorldSnapshot
from agentecs_viz.sources._base import DEFAULT_EVENT_QUEUE_MAXSIZE, TickLoopSource

if TYPE_CHECKING:
    from agentecs import World


def _serialize_component(component: Any) -> dict[str, Any]:
    """Serialize a component to a JSON-compatible dict.

    Handles:
    - Pydantic models (via model_dump)
    - Dataclasses (via __dict__)
    - Objects with __dict__
    - Primitives (wrapped in {"value": ...})
    """
    if hasattr(component, "model_dump"):
        # Pydantic model
        return component.model_dump()  # type: ignore[no-any-return]
    elif hasattr(component, "__dataclass_fields__"):
        # Dataclass
        from dataclasses import asdict

        return asdict(component)
    elif hasattr(component, "__dict__"):
        # Regular object
        return {k: v for k, v in component.__dict__.items() if not k.startswith("_")}
    else:
        # Primitive or unknown
        return {"value": component}


def _get_type_name(component: Any) -> tuple[str, str]:
    """Get full and short type names for a component."""
    cls = type(component)
    full_name = f"{cls.__module__}.{cls.__qualname__}"
    short_name = cls.__qualname__
    return full_name, short_name


class LocalWorldSource(TickLoopSource):
    """WorldStateSource implementation for in-process World instances.

    Wraps a World and controls it by calling tick_async() at configured intervals.
    Provides snapshots and event streaming for visualization.

    Args:
        world: The AgentECS World instance to visualize.
        tick_interval: Seconds between ticks (default 1.0).
        event_queue_maxsize: Maximum queued events before blocking.

    Usage:
        world = World()
        source = LocalWorldSource(world, tick_interval=0.5)
        await source.connect()

        # Get current state
        snapshot = await source.get_snapshot()

        # Stream events (ticks happen automatically)
        async for event in source.subscribe_events():
            handle_event(event)

        # Control the world
        await source.send_command("pause")
        await source.send_command("step")  # Single tick when paused
        await source.send_command("resume")
    """

    def __init__(
        self,
        world: World,
        tick_interval: float = 1.0,
        event_queue_maxsize: int = DEFAULT_EVENT_QUEUE_MAXSIZE,
        visualization_config: VisualizationConfig | None = None,
    ) -> None:
        """Initialize the local world source.

        Args:
            world: The AgentECS World instance to visualize.
            tick_interval: Seconds between ticks (default 1.0).
            event_queue_maxsize: Maximum queued events before blocking.
            visualization_config: Optional config for frontend display customization.
        """
        super().__init__(
            tick_interval=tick_interval,
            event_queue_maxsize=event_queue_maxsize,
            visualization_config=visualization_config,
        )
        self._world = world
        self._tick = 0

    async def _tick_loop_body(self) -> None:
        """Execute tick if not paused."""
        if not self._paused:
            await self._execute_tick()

    async def _execute_tick(self) -> None:
        """Execute a single tick immediately."""
        await self._world.tick_async()
        self._tick += 1
        snapshot = await self.get_snapshot()
        await self._emit_event(TickEvent(snapshot))

    async def get_snapshot(self) -> WorldSnapshot:
        """Generate snapshot from current world state."""
        entities: list[EntitySnapshot] = []

        for entity_id in self._world._all_entities():
            # Get component types for this entity
            comp_types = self._world._get_component_types(entity_id)

            # Build component snapshots
            components: list[ComponentSnapshot] = []

            for comp_type in sorted(comp_types, key=lambda t: t.__name__):
                component = self._world._get_component(entity_id, comp_type)
                if component is not None:
                    full_name, short_name = _get_type_name(component)
                    components.append(
                        ComponentSnapshot(
                            type_name=full_name,
                            type_short=short_name,
                            data=_serialize_component(component),
                        )
                    )

            # Convert EntityId to integer (use index for simplicity)
            entity_int_id = entity_id.index

            entities.append(
                EntitySnapshot(
                    id=entity_int_id,
                    components=components,
                )
            )

        metadata: dict[str, Any] = {"source": "local", "paused": self._paused}
        if self._visualization_config:
            metadata["visualization"] = self._visualization_config.model_dump()

        return WorldSnapshot(
            tick=self._tick,
            entity_count=len(entities),
            entities=entities,
            metadata=metadata,
        )

    async def send_command(self, command: str, **kwargs: object) -> None:
        """Handle control commands.

        Commands:
        - "pause": Pause tick execution
        - "resume": Resume tick execution
        - "step": Execute single tick (when paused)
        - "set_tick_rate": Change ticks per second (ticks_per_second=float)
        """
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
