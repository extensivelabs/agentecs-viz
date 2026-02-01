# AgentECS Visualizer

Real-time visualization server for AgentECS worlds.

**Documentation**: [extensivelabs.github.io/agentecs/viz/](https://extensivelabs.github.io/agentecs/viz/)

## Installation

```bash
pip install agentecs-viz
```

This installs `agentecs` as a dependency automatically.

## Quick Start

```bash
# Start with mock data for demo
agentecs-viz serve --mock

# Start with your world module
agentecs-viz serve -m myapp.world
```

Open [http://localhost:8000](http://localhost:8000) in your browser.

## Features

- Real-time WebSocket streaming of world state
- Multi-scale Petri Dish visualization (MICRO → MACRO)
- Tab-based views: Petri Dish, Timeline, Archetypes, Data, Chat
- Play/pause/step controls with timeline scrubbing
- Entity inspection and selection
- Recording and replay support

## Technology Stack

- **Backend**: FastAPI + uvicorn + WebSocket
- **Frontend**: Svelte 5 + PixiJS 8 + Tailwind CSS

## Development

```bash
git clone https://github.com/extensivelabs/agentecs-viz
cd agentecs-viz
task install    # Sets up venv, deps, frontend, hooks
task test       # Run tests
task serve      # Start server with mock data
```

**Available tasks:** `task --list`

### Local Development with agentecs

For simultaneous development of both packages:

```bash
# Clone repos side by side
git clone https://github.com/extensivelabs/agentecs
git clone https://github.com/extensivelabs/agentecs-viz

cd agentecs-viz
task install    # Auto-detects ../agentecs and installs as editable
```

For custom paths: `uv pip install -e /path/to/agentecs` before `task install`

## License

MIT
