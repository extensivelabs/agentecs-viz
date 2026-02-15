# Copilot instructions for `agentecs-viz`

## Repository overview
- This repo is a **Python FastAPI backend** (`src/agentecs_viz`) plus a **Svelte/Vite frontend** (`frontend/`).
- Primary runtime entrypoint: `agentecs_viz/cli.py` (`agentecs-viz serve ...`).
- Backend tests are in `tests/` (pytest).
- Frontend tests are in `frontend/src/__tests__/` (vitest).

## High-impact files and responsibilities
- `src/agentecs_viz/cli.py`: CLI parsing, source loading, static frontend mounting.
- `src/agentecs_viz/server.py`: FastAPI app, REST endpoints, WebSocket protocol handling.
- `src/agentecs_viz/protocol.py` and `src/agentecs_viz/snapshot.py`: message/snapshot models used across server and tests.
- `src/agentecs_viz/sources/`: world source implementations (currently mock source + base logic).
- `Taskfile.yml`: canonical developer tasks (`test`, `lint`, `typecheck`, `check`, `frontend:build`, etc.).

## Fastest way to validate changes
When toolchain is available as defined by the repo:
1. Backend checks: `task lint && task typecheck && task test`
2. Frontend checks (when frontend touched):
   - `cd frontend && npm run test`
   - `cd frontend && npm run build`

For small backend changes, run targeted tests first, then broader checks.

## Coding conventions to follow
- Python typing is strict (`mypy strict` in `pyproject.toml`) — keep annotations precise.
- Ruff is authoritative for lint/format style.
- Keep changes minimal and localized; avoid broad refactors.
- Reuse existing protocol/snapshot models rather than introducing parallel message shapes.
- Preserve existing API/WebSocket message compatibility (tests rely on exact fields like `type`, `tick`, metadata fields).

## Common pitfalls and workarounds (encountered during onboarding)
1. **`task` command missing in some environments**
   - Error: `task: command not found`
   - Workaround: run underlying commands directly (e.g., `python -m pytest`, `python -m ruff check src tests`, `python -m mypy src`, and frontend `npm run test` / `npm run build`).

2. **`uv` command missing in some environments**
   - Taskfile expects `uv`; if absent, setup tasks fail.
   - Workaround: use `python -m pip` for dependency installation and run tools directly.

3. **Editable install can fail due unavailable `agentecs` package index entry**
   - Error: `No matching distribution found for agentecs>=0.1.0`
   - Workaround used for CI/sandbox validation: install required tooling directly (`pytest`, `fastapi`, `uvicorn`, `httpx`, `ruff`, `mypy`, etc.) and run backend tests with `PYTHONPATH=src python -m pytest`.

4. **Frontend dependencies are required before frontend tests/build**
   - Run `cd frontend && npm ci` before `npm run test` / `npm run build`.

## Change-scoping guidance for future agents
- If only backend files changed, prefer backend test/lint/typecheck runs first.
- If only frontend files changed, run frontend tests/build only.
- If protocol, snapshot, CLI, or server wiring changes, run both backend and frontend checks because schema/behavior can affect UI integration.
