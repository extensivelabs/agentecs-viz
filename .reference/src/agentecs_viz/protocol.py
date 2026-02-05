"""WorldStateSource protocol for world state access.

This protocol abstracts the source of world state, allowing the visualizer
to work with local worlds, remote worlds, or mock data for testing.
"""

from __future__ import annotations

from abc import abstractmethod
from collections.abc import AsyncIterator
from typing import Protocol, runtime_checkable

from agentecs_viz.config import VisualizationConfig
from agentecs_viz.snapshot import WorldSnapshot


class WorldEvent:
    """Base class for world events streamed to the frontend."""

    pass


class TickEvent(WorldEvent):
    """Emitted after each world tick with the new snapshot."""

    def __init__(self, snapshot: WorldSnapshot) -> None:
        self.snapshot = snapshot


class HistoryInfoEvent(WorldEvent):
    """Emitted when history info is requested or changes."""

    def __init__(
        self,
        supports_replay: bool,
        tick_range: tuple[int, int] | None,
        is_paused: bool,
    ) -> None:
        self.supports_replay = supports_replay
        self.tick_range = tick_range
        self.is_paused = is_paused


class SeekCompleteEvent(WorldEvent):
    """Emitted when a seek operation completes."""

    def __init__(self, tick: int, snapshot: WorldSnapshot) -> None:
        self.tick = tick
        self.snapshot = snapshot


@runtime_checkable
class WorldStateSource(Protocol):
    """Protocol for accessing world state.

    Implementations provide snapshots and event streams from different sources:
    - LocalWorldSource: Wraps an in-process World instance
    - MockWorldSource: Provides fake data for frontend development

    Usage:
        source = LocalWorldSource(world)
        await source.connect()

        # Get current snapshot
        snapshot = await source.get_snapshot()

        # Stream events
        async for event in source.subscribe_events():
            if isinstance(event, TickEvent):
                update_display(event.snapshot)

        await source.disconnect()
    """

    @abstractmethod
    async def connect(self) -> None:
        """Establish connection to the world source.

        For local sources, this may set up event hooks.
        For remote sources, this opens network connection.
        """
        ...

    @abstractmethod
    async def disconnect(self) -> None:
        """Clean up connection to the world source."""
        ...

    @abstractmethod
    async def get_snapshot(self) -> WorldSnapshot:
        """Get current world state snapshot.

        Returns a complete snapshot of all entities and components.
        """
        ...

    @abstractmethod
    def subscribe_events(self) -> AsyncIterator[WorldEvent]:
        """Subscribe to world events.

        Yields events as they occur (ticks, spawns, destroys, changes).
        The iterator runs until disconnect() is called.
        """
        ...

    @abstractmethod
    async def send_command(self, command: str, **kwargs: object) -> None:
        """Send a command to the world.

        Commands:
        - "pause": Pause world execution
        - "resume": Resume world execution
        - "step": Execute single tick
        - "set_tick_rate": Change tick rate (ticks_per_second=N)
        """
        ...

    @property
    @abstractmethod
    def is_connected(self) -> bool:
        """Whether the source is currently connected."""
        ...

    @property
    def visualization_config(self) -> VisualizationConfig | None:
        """Optional visualization configuration for the frontend.

        Returns None if no custom configuration is provided.
        Sources may override this to provide per-world customization
        of colors, labels, and feature toggles.
        """
        return None
