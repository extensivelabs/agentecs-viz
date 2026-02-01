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
# Clone the repo
git clone https://github.com/extensivelabs/agentecs-viz
cd agentecs-viz

# Set up development environment
task setup

# Run tests
task test

# Start dev server with mock data
task serve
```

See [Taskfile.yml](Taskfile.yml) for all available tasks.

## License

MIT
