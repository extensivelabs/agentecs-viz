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
async def client(app) -> AsyncClient:
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

            for _ in range(5):
                ws.send_json({"command": "step"})
                # Drain all messages until we see the snapshot for this step
                seen_tick_update = False
                seen_snapshot = False
                while not (seen_tick_update and seen_snapshot):
                    msg = ws.receive_json()
                    if msg["type"] == "tick_update":
                        seen_tick_update = True
                    elif msg["type"] == "snapshot":
                        seen_snapshot = True
                    # error_event and span_event are silently consumed

            ws.send_json({"command": "seek", "tick": 1})
            # Drain until we get the snapshot response for our seek
            while True:
                resp = ws.receive_json()
                if resp["type"] == "snapshot":
                    break
            assert resp["tick"] == 1
