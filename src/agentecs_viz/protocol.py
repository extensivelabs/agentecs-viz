"""WebSocket protocol contract for agentecs-viz.

Connection lifecycle
--------------------
Each WebSocket connection to ``/ws`` starts a new protocol session:

1. Server accepts the connection.
2. Server sends ``metadata`` first.
3. Server sends ``snapshot`` second.
4. Server begins streaming events while also accepting client commands.

The initial ``snapshot`` is a full world state at the current tick and should be
treated as the base state for subsequent incremental updates.

Client commands
---------------
Command payloads are discriminated by ``command`` and validated before
execution:

- ``seek``: requires ``tick >= 0``. On success, server replies with
  ``snapshot`` from ``source.get_snapshot(tick)`` (historical tick when
  available; otherwise source-defined fallback).
- ``pause`` / ``resume`` / ``step``: no additional fields. On success, server
  replies with ``tick_update`` as an acknowledgement.
- ``set_speed``: requires ``ticks_per_second > 0``. The command is applied with
  no explicit acknowledgement message.

Invalid command payloads are rejected with an ``error`` message.

Server messages (``AnyServerEvent``)
------------------------------------
All server messages are discriminated by the ``type`` field:

- ``metadata``: initial capabilities and runtime metadata
  (config, tick range, pause/history support)
- ``snapshot``: full world snapshot at a tick
- ``delta``: incremental world update for a tick (source-dependent)
- ``tick_update``: current tick summary and pause state
- ``error``: protocol-level or command validation error text
- ``error_event``: world/runtime error event with entity id and severity
- ``span_event``: tracing span event with timing, status, and attributes

Ordering and reconnection
-------------------------
- WebSocket frames on a single connection are delivered in send order.
- ``metadata`` is always first and ``snapshot`` is always second.
- After bootstrap, streamed events and command responses share one frame stream
  and may interleave.
- Reconnection is from scratch: clients must establish a new WebSocket session
  and rebuild local state from the new ``metadata`` and ``snapshot`` pair.

Backpressure behavior
---------------------
The protocol has no explicit end-to-end backpressure negotiation. Sources using
``TickLoopSource`` fan out events through bounded per-subscriber queues. When a
subscriber queue is full, events are dropped for that subscriber and a warning
is logged.

Limitations
-----------
- No explicit protocol version field.
- No incremental schema negotiation.
- No resume token/cursor for reconnect continuation.
"""

from __future__ import annotations

from abc import abstractmethod
from collections.abc import AsyncIterator
from enum import StrEnum
from typing import Annotated, Any, Literal, Protocol, runtime_checkable

from pydantic import BaseModel, Field

from agentecs_viz.config import VisualizationConfig
from agentecs_viz.snapshot import TickDelta, WorldSnapshot

# ---------------------------------------------------------------------------
# Client -> Server commands
# ---------------------------------------------------------------------------


class SeekCommand(BaseModel):
    command: Literal["seek"] = "seek"
    tick: int = Field(ge=0)


class SetSpeedCommand(BaseModel):
    command: Literal["set_speed"] = "set_speed"
    ticks_per_second: float = Field(gt=0)


class PauseCommand(BaseModel):
    command: Literal["pause"] = "pause"


class ResumeCommand(BaseModel):
    command: Literal["resume"] = "resume"


class StepCommand(BaseModel):
    command: Literal["step"] = "step"


ClientMessage = Annotated[
    SeekCommand | SetSpeedCommand | PauseCommand | ResumeCommand | StepCommand,
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


class ErrorSeverity(StrEnum):
    critical = "critical"
    warning = "warning"
    info = "info"


class ErrorEventMessage(BaseModel):
    type: Literal["error_event"] = "error_event"
    tick: int
    entity_id: int
    message: str
    severity: ErrorSeverity = ErrorSeverity.warning


class SpanStatus(StrEnum):
    ok = "ok"
    error = "error"
    unset = "unset"


class SpanEventMessage(BaseModel):
    type: Literal["span_event"] = "span_event"
    span_id: str
    trace_id: str
    parent_span_id: str | None = None
    name: str
    start_time: float
    end_time: float
    status: SpanStatus = SpanStatus.unset
    attributes: dict[str, Any] = Field(default_factory=dict)


class MetadataMessage(BaseModel):
    """Sent on WebSocket connection with initial state and capabilities."""

    type: Literal["metadata"] = "metadata"
    tick: int
    config: VisualizationConfig | None = None
    tick_range: tuple[int, int] | None = None
    supports_history: bool = False
    is_paused: bool = False


AnyServerEvent = (
    SnapshotMessage
    | DeltaMessage
    | ErrorMessage
    | ErrorEventMessage
    | SpanEventMessage
    | TickUpdateMessage
    | MetadataMessage
)

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
    def subscribe(self) -> AsyncIterator[AnyServerEvent]: ...

    @abstractmethod
    async def send_command(self, command: str, **kwargs: Any) -> None: ...

    @property
    @abstractmethod
    def is_connected(self) -> bool: ...

    @property
    def is_paused(self) -> bool:
        return False

    @property
    def supports_history(self) -> bool:
        return False

    @property
    def tick_range(self) -> tuple[int, int] | None:
        return None

    @property
    def visualization_config(self) -> VisualizationConfig | None:
        return None
