"""AgentECS Visualization Server.

Real-time visualization for AgentECS worlds via WebSocket streaming.
"""

from agentecs_viz.history import HistoryCapturingSource, InMemoryHistoryStore
from agentecs_viz.protocol import WorldStateSource
from agentecs_viz.server import create_app
from agentecs_viz.snapshot import ComponentSnapshot, EntitySnapshot, WorldSnapshot

__all__ = [
    "WorldStateSource",
    "WorldSnapshot",
    "EntitySnapshot",
    "ComponentSnapshot",
    "create_app",
    # History
    "InMemoryHistoryStore",
    "HistoryCapturingSource",
]
