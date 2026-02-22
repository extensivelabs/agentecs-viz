from collections.abc import AsyncGenerator

import pytest
from httpx import ASGITransport, AsyncClient

from agentecs_viz.server import create_app
from agentecs_viz.sources.mock import MockWorldSource


@pytest.fixture
def source() -> MockWorldSource:
    return MockWorldSource(entity_count=5, tick_interval=10.0)


@pytest.fixture
def app(source: MockWorldSource):
    return create_app(source)


@pytest.fixture
async def client(app) -> AsyncGenerator[AsyncClient, None]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


class TestRESTEndpoints:
    async def test_health(self, client: AsyncClient, source: MockWorldSource):
        await source.connect()
        try:
            resp = await client.get("/api/health")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "ok"
            assert data["connected"] is True
            assert "tick" in data
        finally:
            await source.disconnect()

    async def test_metadata(self, client: AsyncClient, source: MockWorldSource):
        await source.connect()
        try:
            resp = await client.get("/api/metadata")
            assert resp.status_code == 200
            data = resp.json()
            assert data["name"] == "AgentECS Visualizer"
            assert data["source_type"] == "MockWorldSource"
        finally:
            await source.disconnect()


class TestWebSocket:
    def test_connect_receives_metadata_and_snapshot(self, app):
        from starlette.testclient import TestClient

        with TestClient(app) as tc, tc.websocket_connect("/ws") as ws:
            # First message should be metadata
            msg1 = ws.receive_json()
            assert msg1["type"] == "metadata"

            # Second message should be snapshot
            msg2 = ws.receive_json()
            assert msg2["type"] == "snapshot"

    def test_metadata_contains_protocol_properties(self, app):
        from starlette.testclient import TestClient

        with TestClient(app) as tc, tc.websocket_connect("/ws") as ws:
            msg = ws.receive_json()
            assert msg["type"] == "metadata"
            assert "is_paused" in msg
            assert "supports_history" in msg
            assert "tick_range" in msg
            assert msg["supports_history"] is True
            assert msg["is_paused"] is False

    def test_seek_command(self, source):
        from starlette.testclient import TestClient

        app = create_app(source)
        with TestClient(app) as tc, tc.websocket_connect("/ws") as ws:
            ws.receive_json()  # metadata
            ws.receive_json()  # initial snapshot

            # Build history via the WebSocket protocol (same event loop).
            # Each step produces: tick_update (command ack) + snapshot
            # (event subscription) + possible error_event/span_event.
            ws.send_json({"command": "pause"})
            ws.receive_json()  # tick_update ack for pause

            max_drain = 50  # each step: tick_update + snapshot + ~20-30 span/error events
            for _ in range(5):
                ws.send_json({"command": "step"})
                seen_tick_update = False
                seen_snapshot = False
                for _ in range(max_drain):
                    msg = ws.receive_json()
                    if msg["type"] == "tick_update":
                        seen_tick_update = True
                    elif msg["type"] == "snapshot":
                        seen_snapshot = True
                    if seen_tick_update and seen_snapshot:
                        break
                assert seen_tick_update and seen_snapshot, "step did not produce expected messages"

            ws.send_json({"command": "seek", "tick": 1})
            resp = None
            for _ in range(max_drain):
                resp = ws.receive_json()
                if resp["type"] == "snapshot":
                    break
            assert resp is not None and resp["type"] == "snapshot", "seek did not produce snapshot"
            assert resp["tick"] == 1


class TestCommandValidation:
    """Commands are validated through ClientMessage before dispatching."""

    MAX_DRAIN = 20

    def _pause_and_drain(self, ws) -> None:
        """Consume metadata + snapshot, pause, drain until stable."""
        ws.receive_json()  # metadata
        ws.receive_json()  # initial snapshot
        ws.send_json({"command": "pause"})
        # Drain interleaved events until we get the pause ack
        for _ in range(self.MAX_DRAIN):
            msg = ws.receive_json()
            if msg["type"] == "tick_update":
                break

    def _send_and_expect_error(self, ws, data: dict) -> dict:
        self._pause_and_drain(ws)
        ws.send_json(data)
        last: dict = {}
        for _ in range(self.MAX_DRAIN):
            last = ws.receive_json()
            if last["type"] == "error":
                return last
        raise AssertionError(f"Expected error response, last was {last}")

    def test_unknown_command_rejected(self, app):
        from starlette.testclient import TestClient

        with TestClient(app) as tc, tc.websocket_connect("/ws") as ws:
            resp = self._send_and_expect_error(ws, {"command": "bogus"})
            assert "Invalid command" in resp["message"]

    def test_missing_command_field_rejected(self, app):
        from starlette.testclient import TestClient

        with TestClient(app) as tc, tc.websocket_connect("/ws") as ws:
            resp = self._send_and_expect_error(ws, {"foo": "bar"})
            assert "Invalid command" in resp["message"]

    def test_set_speed_non_numeric_rejected(self, app):
        from starlette.testclient import TestClient

        with TestClient(app) as tc, tc.websocket_connect("/ws") as ws:
            resp = self._send_and_expect_error(
                ws, {"command": "set_speed", "ticks_per_second": "banana"}
            )
            assert "Invalid command" in resp["message"]

    def test_seek_non_numeric_tick_rejected(self, app):
        from starlette.testclient import TestClient

        with TestClient(app) as tc, tc.websocket_connect("/ws") as ws:
            resp = self._send_and_expect_error(ws, {"command": "seek", "tick": "not_a_number"})
            assert "Invalid command" in resp["message"]

    def test_seek_negative_tick_rejected(self, app):
        from starlette.testclient import TestClient

        with TestClient(app) as tc, tc.websocket_connect("/ws") as ws:
            resp = self._send_and_expect_error(ws, {"command": "seek", "tick": -1})
            assert "Invalid command" in resp["message"]

    def test_set_speed_negative_rejected(self, app):
        from starlette.testclient import TestClient

        with TestClient(app) as tc, tc.websocket_connect("/ws") as ws:
            resp = self._send_and_expect_error(
                ws, {"command": "set_speed", "ticks_per_second": -1.0}
            )
            assert "Invalid command" in resp["message"]

    def test_set_speed_zero_rejected(self, app):
        from starlette.testclient import TestClient

        with TestClient(app) as tc, tc.websocket_connect("/ws") as ws:
            resp = self._send_and_expect_error(ws, {"command": "set_speed", "ticks_per_second": 0})
            assert "Invalid command" in resp["message"]

    def test_subscribe_command_rejected(self, app):
        """Subscribe command was removed from the protocol."""
        from starlette.testclient import TestClient

        with TestClient(app) as tc, tc.websocket_connect("/ws") as ws:
            resp = self._send_and_expect_error(ws, {"command": "subscribe"})
            assert "Invalid command" in resp["message"]

    def test_valid_set_speed_accepted(self, app):
        from starlette.testclient import TestClient

        with TestClient(app) as tc, tc.websocket_connect("/ws") as ws:
            self._pause_and_drain(ws)
            ws.send_json({"command": "set_speed", "ticks_per_second": 5.0})
            # set_speed sends no ack — verify no error by sending a
            # subsequent command that does ack
            ws.send_json({"command": "pause"})
            resp = ws.receive_json()
            assert resp["type"] == "tick_update"

    def test_error_response_is_typed_message(self, app):
        """Error responses use the ErrorMessage model (have tick + type fields)."""
        from starlette.testclient import TestClient

        with TestClient(app) as tc, tc.websocket_connect("/ws") as ws:
            resp = self._send_and_expect_error(ws, {"command": "bogus"})
            assert resp["type"] == "error"
            assert "tick" in resp
            assert isinstance(resp["tick"], int)
            assert "message" in resp
