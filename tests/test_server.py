import pytest
from httpx import ASGITransport, AsyncClient

from agentecs_viz.server import create_app
from agentecs_viz.sources.mock import MockWorldSource


@pytest.fixture
def source() -> MockWorldSource:
    return MockWorldSource(entity_count=5, tick_interval=0.5)


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
    async def test_connect_receives_metadata_and_snapshot(self, app, source: MockWorldSource):
        await source.connect()
        try:
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as _:
                from starlette.testclient import TestClient

                with TestClient(app) as tc, tc.websocket_connect("/ws") as ws:
                    # First message should be metadata
                    msg1 = ws.receive_json()
                    assert msg1["type"] == "metadata"

                    # Second message should be snapshot
                    msg2 = ws.receive_json()
                    assert msg2["type"] == "snapshot"
        finally:
            await source.disconnect()

    async def test_seek_command(self, app, source: MockWorldSource):
        await source.connect()
        try:
            # Advance a few ticks
            await source.send_command("pause")
            for _ in range(5):
                await source.send_command("step")

            from starlette.testclient import TestClient

            with TestClient(app) as tc, tc.websocket_connect("/ws") as ws:
                # Consume metadata + initial snapshot
                ws.receive_json()
                ws.receive_json()

                # Send seek command
                ws.send_json({"command": "seek", "tick": 1})
                resp = ws.receive_json()
                assert resp["type"] == "snapshot"
                assert resp["tick"] == 1
        finally:
            await source.disconnect()
