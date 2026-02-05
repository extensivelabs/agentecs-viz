"""Remote world source for observing a remote agentecs-viz server.

Connects to an existing visualization server's WebSocket endpoint and streams
events without controlling the remote world. Supports local-only pause/resume.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections import deque
from collections.abc import AsyncIterator
from typing import Any

import websockets
from websockets.asyncio.client import ClientConnection

from agentecs_viz.config import VisualizationConfig
from agentecs_viz.protocol import TickEvent, WorldEvent
from agentecs_viz.snapshot import WorldSnapshot

logger = logging.getLogger(__name__)


class RemoteWorldSource:
    """Read-only observer for remote agentecs-viz servers.

    Connects to an existing visualization server's /ws endpoint and streams
    events to local subscribers. Implements WorldStateSource protocol but
    cannot control the remote world - pause/resume only affects local buffering.

    Args:
        url: WebSocket URL (e.g., ws://host:port/ws).
        reconnect_attempts: Max reconnection attempts (-1 for infinite).
        reconnect_delay: Initial delay between reconnection attempts.
        max_reconnect_delay: Maximum delay between reconnection attempts.
        buffer_size: Maximum events to buffer when paused locally.

    Example:
        source = RemoteWorldSource("ws://localhost:8000/ws")
        await source.connect()
        async for event in source.subscribe_events():
            if isinstance(event, TickEvent):
                print(f"Tick {event.snapshot.tick}")
        await source.disconnect()
    """

    def __init__(
        self,
        url: str,
        reconnect_attempts: int = 10,
        reconnect_delay: float = 1.0,
        max_reconnect_delay: float = 30.0,
        buffer_size: int = 1000,
    ) -> None:
        self._url = url
        self._reconnect_attempts = reconnect_attempts
        self._reconnect_delay = reconnect_delay
        self._max_reconnect_delay = max_reconnect_delay
        self._buffer_size = buffer_size

        self._connected = False
        self._paused = False
        self._ws: ClientConnection | None = None
        self._stop_event: asyncio.Event | None = None
        self._event_queue: asyncio.Queue[WorldEvent] | None = None
        self._buffer: deque[WorldEvent] = deque(maxlen=buffer_size)
        self._listener_task: asyncio.Task[None] | None = None

        self._visualization_config: VisualizationConfig | None = None
        self._latest_snapshot: WorldSnapshot | None = None
        self._connection_attempt = 0

    @property
    def is_connected(self) -> bool:
        """Whether the source is connected to the remote server."""
        return self._connected and self._ws is not None

    @property
    def is_paused(self) -> bool:
        """Whether local event emission is paused."""
        return self._paused

    @property
    def remote_url(self) -> str:
        """The remote WebSocket URL."""
        return self._url

    @property
    def visualization_config(self) -> VisualizationConfig | None:
        """Visualization config received from remote server."""
        return self._visualization_config

    async def connect(self) -> None:
        """Connect to the remote WebSocket server."""
        self._connected = True
        self._stop_event = asyncio.Event()
        self._event_queue = asyncio.Queue()
        self._connection_attempt = 0

        await self._establish_connection()
        self._listener_task = asyncio.create_task(self._listen_loop())

    async def disconnect(self) -> None:
        """Disconnect from the remote server."""
        self._connected = False
        if self._stop_event:
            self._stop_event.set()

        if self._listener_task:
            self._listener_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._listener_task
            self._listener_task = None

        if self._ws:
            await self._ws.close()
            self._ws = None

    async def get_snapshot(self) -> WorldSnapshot:
        """Get the most recent snapshot from the remote server."""
        if self._latest_snapshot:
            return self._latest_snapshot
        return WorldSnapshot(tick=0, entity_count=0, entities=[])

    async def subscribe_events(self) -> AsyncIterator[WorldEvent]:
        """Stream events from the remote server.

        When paused locally, events are buffered. On resume, buffered events
        are drained before continuing with live events.
        """
        if not self._stop_event or not self._event_queue:
            return
            yield  # pragma: no cover

        while not self._stop_event.is_set():
            try:
                event = await asyncio.wait_for(
                    self._event_queue.get(),
                    timeout=0.1,
                )
                yield event
            except TimeoutError:
                continue

    async def send_command(self, command: str, **kwargs: object) -> None:
        """Handle control commands.

        Commands are handled locally - pause/resume only affect local buffering.
        The remote world continues running unaffected.

        Commands:
            pause: Buffer incoming events locally instead of emitting.
            resume: Drain buffer and resume live event emission.
            step: Emit one buffered event (when paused).
            set_tick_rate: Ignored (cannot control remote).
        """
        if command == "pause":
            self._paused = True
            logger.debug("Paused (local only - remote continues)")
        elif command == "resume":
            self._paused = False
            await self._drain_buffer()
            logger.debug("Resumed - draining buffer")
        elif command == "step":
            if self._paused and self._buffer:
                event = self._buffer.popleft()
                if self._event_queue:
                    await self._event_queue.put(event)
                logger.debug("Stepped one event from buffer")
        elif command == "set_tick_rate":
            logger.debug("set_tick_rate ignored - cannot control remote server")

    async def _establish_connection(self) -> None:
        """Establish WebSocket connection with reconnection logic."""
        delay = self._reconnect_delay

        while self._connected:
            try:
                self._ws = await websockets.connect(self._url)
                self._connection_attempt = 0
                logger.info(f"Connected to remote server: {self._url}")
                return
            except (OSError, websockets.WebSocketException) as e:
                self._connection_attempt += 1
                if (
                    self._reconnect_attempts >= 0
                    and self._connection_attempt >= self._reconnect_attempts
                ):
                    logger.error(f"Failed to connect after {self._connection_attempt} attempts")
                    raise ConnectionError(
                        f"Failed to connect to {self._url} after "
                        f"{self._connection_attempt} attempts"
                    ) from e

                logger.warning(
                    f"Connection failed ({e}), retrying in {delay:.1f}s "
                    f"(attempt {self._connection_attempt})"
                )
                await asyncio.sleep(delay)
                delay = min(delay * 2, self._max_reconnect_delay)

    async def _listen_loop(self) -> None:
        """Listen for messages from the remote server."""
        while self._connected and self._stop_event and not self._stop_event.is_set():
            try:
                await self._receive_messages()
            except (websockets.ConnectionClosed, OSError) as e:
                if not self._connected:
                    break
                logger.warning(f"Connection lost: {e}")
                try:
                    await self._establish_connection()
                except ConnectionError:
                    break

    async def _receive_messages(self) -> None:
        """Receive and process messages from WebSocket."""
        if not self._ws:
            return

        async for message in self._ws:
            if self._stop_event and self._stop_event.is_set():
                break

            try:
                data = _parse_json(message)
                await self._handle_message(data)
            except Exception:
                logger.exception("Failed to process message")

    async def _handle_message(self, data: dict[str, Any]) -> None:
        """Handle a single message from the remote server."""
        msg_type = data.get("type")

        if msg_type == "config":
            config_data = data.get("config", {})
            self._visualization_config = VisualizationConfig(**config_data)
            logger.debug("Received visualization config")

        elif msg_type == "tick":
            snapshot_data = data.get("snapshot", {})
            snapshot = WorldSnapshot(**snapshot_data)
            self._latest_snapshot = snapshot
            event = TickEvent(snapshot)

            if self._paused:
                self._buffer.append(event)
                logger.debug(f"Buffered tick {snapshot.tick} (buffer size: {len(self._buffer)})")
            elif self._event_queue:
                await self._event_queue.put(event)

        elif msg_type == "history_info":
            pass

        elif msg_type == "error":
            error_msg = data.get("message", "Unknown error")
            logger.error(f"Remote error: {error_msg}")

    async def _drain_buffer(self) -> None:
        """Drain buffered events to the event queue."""
        if not self._event_queue:
            return

        count = len(self._buffer)
        while self._buffer:
            event = self._buffer.popleft()
            await self._event_queue.put(event)

        if count > 0:
            logger.debug(f"Drained {count} buffered events")


def _parse_json(message: str | bytes) -> dict[str, Any]:
    """Parse JSON message from WebSocket."""
    import json

    if isinstance(message, bytes):
        message = message.decode("utf-8")
    return json.loads(message)  # type: ignore[no-any-return]


def normalize_url(url: str) -> str:
    """Normalize a URL to a WebSocket URL with /ws path.

    Handles various input formats:
        host:port → ws://host:port/ws
        host:port/ws → ws://host:port/ws
        http://host:port → ws://host:port/ws
        https://host:port → wss://host:port/ws
        ws://host:port → ws://host:port/ws
        ws://host:port/ws → ws://host:port/ws

    Args:
        url: Input URL in any supported format.

    Returns:
        Normalized WebSocket URL with /ws path.
    """
    url = url.strip()

    # Handle scheme
    if url.startswith("http://"):
        url = "ws://" + url[7:]
    elif url.startswith("https://"):
        url = "wss://" + url[8:]
    elif not url.startswith("ws://") and not url.startswith("wss://"):
        url = "ws://" + url

    # Ensure /ws path
    if not url.endswith("/ws"):
        url = url.rstrip("/") + "/ws"

    return url
