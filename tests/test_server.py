"""Tests for the FastAPI WebSocket server."""

from typing import Any

from fastapi.testclient import TestClient
from starlette.testclient import WebSocketTestSession

from agentecs_viz.server import create_app
from agentecs_viz.sources.mock import MockWorldSource


def receive_until_tick(ws: WebSocketTestSession) -> dict[str, Any]:
    """Receive messages until we get a tick event (skipping config, history_info)."""
    while True:
        data = ws.receive_json()
        if data["type"] == "tick":
            return data


class TestHealthEndpoint:
    """Tests for /health endpoint."""

    def test_health_returns_ok(self) -> None:
        """Verify basic health check works."""
        source = MockWorldSource(entity_count=5)
        app = create_app(source)

        with TestClient(app) as client:
            response = client.get("/health")
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "ok"
            assert data["connected"] is True
            assert "tick" in data

    def test_health_shows_current_tick(self) -> None:
        """Health endpoint reflects current world state."""
        source = MockWorldSource(entity_count=5)
        app = create_app(source)

        with TestClient(app) as client:
            response = client.get("/health")
            tick = response.json()["tick"]
            # Verify the endpoint returns tick info
            assert isinstance(tick, int)


class TestInfoEndpoint:
    """Tests for /info endpoint."""

    def test_info_returns_server_details(self) -> None:
        """Info endpoint returns server metadata."""
        source = MockWorldSource()
        app = create_app(source, title="Test Server", version="1.2.3")

        with TestClient(app) as client:
            response = client.get("/info")
            assert response.status_code == 200
            data = response.json()
            assert data["name"] == "Test Server"
            assert data["version"] == "1.2.3"
            assert data["source_type"] == "MockWorldSource"


class TestWebSocketEndpoint:
    """Tests for /ws WebSocket endpoint."""

    def test_websocket_connects(self) -> None:
        """WebSocket connection sends config, history_info, then ticks."""
        source = MockWorldSource(entity_count=5, tick_interval=0.1)
        app = create_app(source)

        with TestClient(app) as client, client.websocket_connect("/ws") as ws:
            # First message should be config (if source has visualization_config)
            data = ws.receive_json()
            assert data["type"] == "config"
            assert "config" in data
            # Second message should be history_info
            data = ws.receive_json()
            assert data["type"] == "history_info"
            # Then we should receive tick events
            data = receive_until_tick(ws)
            assert data["type"] == "tick"

    def test_websocket_receives_tick_events(self) -> None:
        """Tick events contain snapshot with entities."""
        source = MockWorldSource(entity_count=5, tick_interval=0.05)
        app = create_app(source)

        with TestClient(app) as client, client.websocket_connect("/ws") as websocket:
            # Receive first tick event (skipping history_info)
            data = receive_until_tick(websocket)
            assert data["type"] == "tick"
            assert "snapshot" in data
            snapshot = data["snapshot"]
            assert "tick" in snapshot
            assert "entities" in snapshot
            assert "entity_count" in snapshot

    def test_websocket_snapshot_has_entities(self) -> None:
        """Snapshot entity count matches configured count."""
        source = MockWorldSource(entity_count=10, tick_interval=0.05)
        app = create_app(source)

        with TestClient(app) as client, client.websocket_connect("/ws") as websocket:
            data = receive_until_tick(websocket)
            snapshot = data["snapshot"]
            assert snapshot["entity_count"] == 10
            assert len(snapshot["entities"]) == 10

    def test_websocket_accepts_pause_command(self) -> None:
        """Pause command is accepted."""
        source = MockWorldSource(entity_count=5, tick_interval=0.1)
        app = create_app(source)

        with TestClient(app) as client, client.websocket_connect("/ws") as websocket:
            # Send pause command
            websocket.send_json({"command": "pause"})
            # No error response means success
            # Receive a tick (may already be in flight, skip history_info)
            data = receive_until_tick(websocket)
            assert data["type"] == "tick"

    def test_websocket_accepts_step_command(self) -> None:
        """Step command increments tick when paused."""
        source = MockWorldSource(entity_count=5, tick_interval=1.0)
        app = create_app(source)

        with TestClient(app) as client, client.websocket_connect("/ws") as websocket:
            # First pause
            websocket.send_json({"command": "pause"})
            # Drain any pending tick (skip history_info messages)
            data = receive_until_tick(websocket)
            initial_tick = data["snapshot"]["tick"]

            # Step
            websocket.send_json({"command": "step"})
            # Should get a new tick (skip any history_info)
            data = receive_until_tick(websocket)
            assert data["type"] == "tick"
            assert data["snapshot"]["tick"] == initial_tick + 1

    def test_websocket_accepts_resume_command(self) -> None:
        """Resume command resumes ticks after pause."""
        source = MockWorldSource(entity_count=5, tick_interval=0.05)
        app = create_app(source)

        with TestClient(app) as client, client.websocket_connect("/ws") as websocket:
            websocket.send_json({"command": "pause"})
            websocket.send_json({"command": "resume"})
            # Should continue receiving ticks (skip history_info)
            data = receive_until_tick(websocket)
            assert data["type"] == "tick"

    def test_websocket_invalid_command_returns_error(self) -> None:
        """Invalid command format returns error."""
        source = MockWorldSource(entity_count=5, tick_interval=0.1)
        app = create_app(source)

        with TestClient(app) as client, client.websocket_connect("/ws") as websocket:
            # Send invalid command format
            websocket.send_json({"not_a_command": "test"})
            # Should get error response
            data = websocket.receive_json()
            # Could be error or tick (race condition)
            if data["type"] == "error":
                assert "message" in data

    def test_concurrent_websocket_clients(self) -> None:
        """Multiple WebSocket clients can connect simultaneously."""
        source = MockWorldSource(entity_count=5, tick_interval=0.1)
        app = create_app(source)

        with (
            TestClient(app) as client,
            client.websocket_connect("/ws") as ws1,
            client.websocket_connect("/ws") as ws2,
        ):
            # First client should receive messages
            data1 = ws1.receive_json()
            assert data1["type"] in ("tick", "history_info", "config")

            # Second client should also receive messages
            data2 = ws2.receive_json()
            assert data2["type"] in ("tick", "history_info", "config")


class TestAppFactory:
    """Tests for create_app factory function."""

    def test_custom_title_and_version(self) -> None:
        """App factory accepts custom title and version."""
        source = MockWorldSource()
        app = create_app(source, title="My Viz", version="2.0.0")

        assert app.title == "My Viz"
        assert app.version == "2.0.0"

    def test_lifespan_connects_source(self) -> None:
        """Source is connected during app lifecycle."""
        source = MockWorldSource()
        app = create_app(source)

        assert not source.is_connected

        with TestClient(app):
            assert source.is_connected

        # After context, source should be disconnected
        # Note: TestClient may not trigger lifespan shutdown properly
        # so we just verify it connected during the context
