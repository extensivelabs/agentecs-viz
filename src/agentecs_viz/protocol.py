"""WebSocket message protocol with literal type discriminators."""

from __future__ import annotations

from abc import abstractmethod
from collections.abc import AsyncIterator
from typing import Annotated, Any, Literal, Protocol, runtime_checkable

from pydantic import BaseModel, Field

from agentecs_viz.config import VisualizationConfig
from agentecs_viz.snapshot import TickDelta, WorldSnapshot

# ---------------------------------------------------------------------------
# Client -> Server commands
# ---------------------------------------------------------------------------


class SubscribeCommand(BaseModel):
    command: Literal["subscribe"] = "subscribe"


class SeekCommand(BaseModel):
    command: Literal["seek"] = "seek"
    tick: int


class SetSpeedCommand(BaseModel):
    command: Literal["set_speed"] = "set_speed"
    ticks_per_second: float


class PauseCommand(BaseModel):
    command: Literal["pause"] = "pause"


class ResumeCommand(BaseModel):
    command: Literal["resume"] = "resume"


class StepCommand(BaseModel):
    command: Literal["step"] = "step"


ClientMessage = Annotated[
    SubscribeCommand | SeekCommand | SetSpeedCommand | PauseCommand | ResumeCommand | StepCommand,
    Field(discriminator="command"),
]


# ---------------------------------------------------------------------------
# Server -> Client messages
# ---------------------------------------------------------------------------


class SnapshotMessage(BaseModel):
    type: Literal["snapshot"] = "snapshot"
    tick: int
    snapshot: WorldSnapshot


class DeltaMessage(BaseModel):
    type: Literal["delta"] = "delta"
    tick: int
    delta: TickDelta


class ErrorMessage(BaseModel):
    type: Literal["error"] = "error"
    tick: int
    message: str


class TickUpdateMessage(BaseModel):
    type: Literal["tick_update"] = "tick_update"
    tick: int
    entity_count: int
    is_paused: bool


class MetadataMessage(BaseModel):
    """Sent on WebSocket connection with initial state and capabilities."""

    type: Literal["metadata"] = "metadata"
    tick: int
    config: VisualizationConfig | None = None
    tick_range: tuple[int, int] | None = None
    supports_history: bool = False
    is_paused: bool = False


ServerMessage = Annotated[
    SnapshotMessage | DeltaMessage | ErrorMessage | TickUpdateMessage | MetadataMessage,
    Field(discriminator="type"),
]


# ---------------------------------------------------------------------------
# WorldStateSource protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class WorldStateSource(Protocol):
    """Protocol for accessing world state from any source (live, mock, replay)."""

    @abstractmethod
    async def connect(self) -> None: ...

    @abstractmethod
    async def disconnect(self) -> None: ...

    @abstractmethod
    async def get_snapshot(self, tick: int | None = None) -> WorldSnapshot:
        """Get world state snapshot. tick=None means current tick."""
        ...

    @abstractmethod
    def get_current_tick(self) -> int: ...

    @abstractmethod
    def subscribe(
        self,
    ) -> AsyncIterator[
        SnapshotMessage | DeltaMessage | ErrorMessage | TickUpdateMessage | MetadataMessage
    ]: ...

    @abstractmethod
    async def send_command(self, command: str, **kwargs: Any) -> None: ...

    @property
    @abstractmethod
    def is_connected(self) -> bool: ...

    @property
    def visualization_config(self) -> VisualizationConfig | None:
        return None
