"""Tests for RemoteWorldSource."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import pytest
from starlette.testclient import WebSocketTestSession

from agentecs_viz.protocol import TickEvent
from agentecs_viz.server import create_app
from agentecs_viz.sources.mock import MockWorldSource
from agentecs_viz.sources.remote import RemoteWorldSource, normalize_url


class TestNormalizeUrl:
    """Tests for URL normalization."""

    def test_host_port(self) -> None:
        assert normalize_url("localhost:8000") == "ws://localhost:8000/ws"

    def test_host_port_with_path(self) -> None:
        assert normalize_url("localhost:8000/ws") == "ws://localhost:8000/ws"

    def test_http_url(self) -> None:
        assert normalize_url("http://localhost:8000") == "ws://localhost:8000/ws"

    def test_https_url(self) -> None:
        assert normalize_url("https://localhost:8000") == "wss://localhost:8000/ws"

    def test_ws_url(self) -> None:
        assert normalize_url("ws://localhost:8000") == "ws://localhost:8000/ws"

    def test_wss_url(self) -> None:
        assert normalize_url("wss://localhost:8000") == "wss://localhost:8000/ws"

    def test_ws_url_with_path(self) -> None:
        assert normalize_url("ws://localhost:8000/ws") == "ws://localhost:8000/ws"

    def test_trailing_slash(self) -> None:
        assert normalize_url("localhost:8000/") == "ws://localhost:8000/ws"

    def test_whitespace(self) -> None:
        assert normalize_url("  localhost:8000  ") == "ws://localhost:8000/ws"


class TestRemoteWorldSourceProtocol:
    """Tests for WorldStateSource protocol compliance."""

    def test_has_required_methods(self) -> None:
        source = RemoteWorldSource("ws://localhost:8000/ws")
        assert hasattr(source, "connect")
        assert hasattr(source, "disconnect")
        assert hasattr(source, "get_snapshot")
        assert hasattr(source, "subscribe_events")
        assert hasattr(source, "send_command")

    def test_has_required_properties(self) -> None:
        source = RemoteWorldSource("ws://localhost:8000/ws")
        assert hasattr(source, "is_connected")
        assert hasattr(source, "visualization_config")

    def test_initial_state(self) -> None:
        source = RemoteWorldSource("ws://localhost:8000/ws")
        assert source.is_connected is False
        assert source.is_paused is False
        assert source.visualization_config is None
        assert source.remote_url == "ws://localhost:8000/ws"


class TestRemoteWorldSourceIntegration:
    """Integration tests using a real MockWorldSource server."""

    @pytest.fixture
    def mock_source(self) -> MockWorldSource:
        return MockWorldSource(entity_count=5, tick_interval=0.05)

    @pytest.fixture
    def mock_app(self, mock_source: MockWorldSource) -> Any:
        return create_app(mock_source)

    @asynccontextmanager
    async def _connected_source(
        self, ws: WebSocketTestSession, port: int = 8000
    ) -> AsyncIterator[RemoteWorldSource]:
        """Context manager for a connected RemoteWorldSource.

        Note: This creates a source but doesn't actually connect to the WebSocket
        test session - the TestClient WebSocket is synchronous. We test the
        message handling logic directly instead.
        """
        source = RemoteWorldSource(f"ws://localhost:{port}/ws", reconnect_attempts=0)
        source._connected = True
        source._stop_event = asyncio.Event()
        source._event_queue = asyncio.Queue()
        try:
            yield source
        finally:
            source._connected = False
            if source._stop_event:
                source._stop_event.set()

    async def test_handle_config_message(self) -> None:
        """Config messages are parsed and stored."""
        source = RemoteWorldSource("ws://localhost:8000/ws")
        source._connected = True

        config_msg = {
            "type": "config",
            "config": {"world_name": "Test World", "chat_enabled": True},
        }

        await source._handle_message(config_msg)

        assert source.visualization_config is not None
        assert source.visualization_config.world_name == "Test World"

    async def test_handle_tick_message(self) -> None:
        """Tick messages create TickEvents in the queue."""
        source = RemoteWorldSource("ws://localhost:8000/ws")
        source._connected = True
        source._event_queue = asyncio.Queue()

        tick_msg = {
            "type": "tick",
            "snapshot": {"tick": 42, "entity_count": 5, "entities": [], "metadata": {}},
        }

        await source._handle_message(tick_msg)

        assert source._latest_snapshot is not None
        assert source._latest_snapshot.tick == 42

        # Event should be in the queue
        event = await asyncio.wait_for(source._event_queue.get(), timeout=1.0)
        assert isinstance(event, TickEvent)
        assert event.snapshot.tick == 42

    async def test_pause_buffers_events(self) -> None:
        """When paused, tick events are buffered."""
        source = RemoteWorldSource("ws://localhost:8000/ws")
        source._connected = True
        source._event_queue = asyncio.Queue()

        await source.send_command("pause")
        assert source.is_paused is True

        tick_msg = {
            "type": "tick",
            "snapshot": {"tick": 1, "entity_count": 0, "entities": [], "metadata": {}},
        }
        await source._handle_message(tick_msg)

        # Event should be buffered, not in queue
        assert len(source._buffer) == 1
        assert source._event_queue.empty()

    async def test_resume_drains_buffer(self) -> None:
        """Resume drains buffered events to the queue."""
        source = RemoteWorldSource("ws://localhost:8000/ws")
        source._connected = True
        source._event_queue = asyncio.Queue()

        await source.send_command("pause")

        # Buffer some events
        for i in range(3):
            tick_msg = {
                "type": "tick",
                "snapshot": {"tick": i, "entity_count": 0, "entities": [], "metadata": {}},
            }
            await source._handle_message(tick_msg)

        assert len(source._buffer) == 3

        await source.send_command("resume")

        assert source.is_paused is False
        assert len(source._buffer) == 0
        assert source._event_queue.qsize() == 3

    async def test_step_emits_one_event(self) -> None:
        """Step emits exactly one buffered event."""
        source = RemoteWorldSource("ws://localhost:8000/ws")
        source._connected = True
        source._event_queue = asyncio.Queue()

        await source.send_command("pause")

        # Buffer some events
        for i in range(3):
            tick_msg = {
                "type": "tick",
                "snapshot": {"tick": i, "entity_count": 0, "entities": [], "metadata": {}},
            }
            await source._handle_message(tick_msg)

        await source.send_command("step")

        assert len(source._buffer) == 2
        assert source._event_queue.qsize() == 1

        event = await source._event_queue.get()
        assert isinstance(event, TickEvent)
        assert event.snapshot.tick == 0  # First buffered event

    async def test_set_tick_rate_ignored(self) -> None:
        """set_tick_rate is ignored (cannot control remote)."""
        source = RemoteWorldSource("ws://localhost:8000/ws")
        # Should not raise
        await source.send_command("set_tick_rate", ticks_per_second=10)

    async def test_get_snapshot_returns_latest(self) -> None:
        """get_snapshot returns the most recent snapshot."""
        source = RemoteWorldSource("ws://localhost:8000/ws")
        source._connected = True
        source._event_queue = asyncio.Queue()

        tick_msg = {
            "type": "tick",
            "snapshot": {"tick": 99, "entity_count": 10, "entities": [], "metadata": {}},
        }
        await source._handle_message(tick_msg)

        snapshot = await source.get_snapshot()
        assert snapshot.tick == 99
        assert snapshot.entity_count == 10

    async def test_get_snapshot_empty_when_no_data(self) -> None:
        """get_snapshot returns empty snapshot when no data received."""
        source = RemoteWorldSource("ws://localhost:8000/ws")
        snapshot = await source.get_snapshot()
        assert snapshot.tick == 0
        assert snapshot.entity_count == 0

    async def test_buffer_size_limit(self) -> None:
        """Buffer respects size limit."""
        source = RemoteWorldSource("ws://localhost:8000/ws", buffer_size=5)
        source._connected = True
        source._event_queue = asyncio.Queue()
        source._paused = True

        # Buffer more than limit
        for i in range(10):
            tick_msg = {
                "type": "tick",
                "snapshot": {"tick": i, "entity_count": 0, "entities": [], "metadata": {}},
            }
            await source._handle_message(tick_msg)

        # Buffer should be capped at 5 (newest events kept)
        assert len(source._buffer) == 5
        # Should have ticks 5-9 (oldest dropped)
        ticks = [e.snapshot.tick for e in source._buffer]
        assert ticks == [5, 6, 7, 8, 9]


class TestRemoteWorldSourceConnection:
    """Tests for connection lifecycle."""

    async def test_connect_sets_connected(self) -> None:
        """Connect initializes state."""
        source = RemoteWorldSource(
            "ws://localhost:9999/ws",
            reconnect_attempts=0,  # Don't retry
        )

        # Connection will fail immediately since there's no server
        with pytest.raises(ConnectionError):
            await source.connect()

        # State should still be marked as connected until disconnect
        assert source._connected is True
        await source.disconnect()
        assert source._connected is False

    async def test_disconnect_cleans_up(self) -> None:
        """Disconnect cleans up all resources."""
        source = RemoteWorldSource("ws://localhost:8000/ws")
        source._connected = True
        source._stop_event = asyncio.Event()
        source._event_queue = asyncio.Queue()

        await source.disconnect()

        assert source._connected is False
        assert source._stop_event.is_set()
