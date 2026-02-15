# Repository Context

## Overview

agentecs-viz is the visualization server for AgentECS—a debugging workbench providing live state inspection, temporal navigation, and trace correlation for ECS-based agent systems.

**Design Document**: `.agents/VIZ-SPIKE-001-design.md` (source of truth)

**Relationship to agentecs**: Separate package that depends on agentecs. For local development: `uv pip install -e ../agentecs`

---

## Environment Setup

### Development Tools
- **uv**: Fast Python package manager
- **Task**: Task runner (Taskfile.yml)
- **direnv**: Automatic environment activation (.envrc)
- **npm**: Frontend package management

### Quick Start
```bash
task install       # Initialize everything (venv, deps, frontend, hooks)
task serve         # Start with mock data
task test          # Run Python tests
task frontend:dev  # Frontend dev server (hot reload)
task check         # All checks (lint, type, test)
```

### Python Environment
- Python >= 3.11 required
- Build system: hatchling (custom hook for frontend bundling)
- Virtual environment: `.venv/`

---

## Architecture (Design Target)

See `VIZ-SPIKE-001-design.md` for full architecture. Key concepts:

### T-Relative Model
Everything computed relative to current time T:
- Live mode: T = "now" (latest tick)
- History mode: T = user-selected point
- When T changes, entire view updates

### Package Structure (Target)
```
src/agentecs_viz/
  cli.py              # CLI entry point
  config.py           # Configuration dataclasses
  server.py           # FastAPI + WebSocket server
  protocol.py         # WebSocket message protocol (T-relative)
  snapshot.py         # World snapshot structures
  history.py          # Snapshot + delta history storage
  sources/
    _base.py          # Base classes
    local.py          # LocalWorldSource
    mock.py           # MockWorldSource
    replay.py         # ReplayWorldSource

frontend/
  src/
    lib/
      EntityView.svelte     # Main visualization (two-level zoom)
      InspectorPanel.svelte # Selected entity details
      TracesTab.svelte      # OTel trace waterfall
      TimelineTab.svelte    # Temporal analysis
      ArchetypesTab.svelte  # Component groupings
      state/
        world.svelte.ts     # T-relative world state
        timeline.svelte.ts  # Timeline state
      types.ts              # TypeScript types
    App.svelte
    main.ts
```

### Reference Implementation
Old implementation preserved in `.reference/` for consultation during rewrite.
**Rule**: Never import from `.reference/`—rewrite fresh.

---

## Tech Stack

**Frontend**:
- Svelte 5 (reactive UI framework, runes)
- PixiJS 8 (WebGL rendering)
- pixi-viewport (zoom/pan)
- Tailwind CSS 4 (styling)
- Vite (build tool)
- TypeScript strict mode

**Backend**:
- FastAPI (async web framework)
- uvicorn (ASGI server)
- WebSockets (real-time)
- Pydantic (validation)

---

## Key Patterns

### Component-Agnostic Design
The viz CANNOT depend on specific component types:
- Task, AgentState, Memory are optional standard library components
- The viz must work with ANY ECS world
- Use heuristic field detection and `VisualizationConfig` for specialization

### WorldStateSource Protocol
Runtime-checkable Protocol in `protocol.py`. All data sources implement:
- `connect()` / `disconnect()` — Lifecycle
- `get_snapshot(tick=None)` — World state at tick (None = current)
- `subscribe()` — AsyncIterator of ServerMessage variants
- `send_command(command, **kwargs)` — Control commands (pause, resume, step, seek, set_speed)
- `get_current_tick()` — Current tick number
- `is_connected` / `visualization_config` — Properties

`TickLoopSource` in `sources/_base.py` provides base implementation with background loop, event queue, and subscription streaming. Subclasses only implement `_tick_loop_body()`, `get_snapshot()`, `get_current_tick()`, `send_command()`.

### History Storage
`InMemoryHistoryStore` in `history.py`:
- Full snapshots at configurable checkpoint_interval (every N ticks)
- Compact TickDelta between checkpoints (spawned, destroyed, modified entities)
- Bounded by max_ticks with eviction promoting next delta to checkpoint
- `compute_entity_lifecycles()` derives spawn/despawn timelines from stored history

---

## Testing

- Python: pytest with pytest-asyncio (asyncio_mode = "auto")
- Frontend: Vitest with happy-dom
- Run: `task test` (Python), `npm test` in frontend/ (frontend)
- Server tests use httpx ASGITransport + starlette TestClient for WebSocket

### Shared Test Helpers
- **Frontend**: `frontend/src/__tests__/helpers.ts` -- `MockWebSocket`, `makeEntity()`, `makeSnapshot()`, `makeConfig()`, `setWorldState()`
- **Backend**: `tests/helpers.py` -- `make_entity()`, `make_snapshot()`
- `pyproject.toml` includes `"tests"` in `pythonpath` so `from helpers import ...` works directly
- `makeEntity()` accepts either `string[]` archetype names (auto-generates components) or `ComponentInput[]` objects with data
- `setWorldState()` sets both `world.snapshot` and `world.config` for inspector/component tests

---

## Dependencies

### Core
- agentecs >= 0.1.0
- fastapi >= 0.115.0
- uvicorn[standard] >= 0.32.0
- websockets >= 14.0
- pydantic >= 2.0

### Development
- pytest, pytest-asyncio, pytest-cov
- httpx (FastAPI testing)
- ruff, mypy

---

## Learnings

### Pre-commit hooks and .reference/
- `.pre-commit-config.yaml` must exclude `.reference/` — otherwise `git mv` files get linted during commit
- All hooks (ruff, ruff-format, mypy, bandit, trailing-whitespace, end-of-file-fixer, check-yaml) need the exclusion
- Pattern: `exclude: ^(tests/|\.agents/|\.reference/)`

### pytest exit code 5
- pytest returns exit code 5 when no tests are collected (empty test dir with only `__init__.py`)
- `task check` treats this as failure since Taskfile chains commands
- Solution: include at least one smoke test (`test_package.py` with import check)

### Frontend config files are safe to copy verbatim
- `package.json`, `vite.config.ts`, `tsconfig.json`, etc. have no code-specific content
- `app.css` design tokens are also safe — they're design decisions, not implementation

### Ruff docstring suppressions
- D100, D104, D105, D107 globally suppressed
- D101-D103 suppressed in tests
- D101, D102 suppressed for Pydantic data models (snapshot.py, protocol.py) -- Field descriptions serve as docs
- D102 suppressed for source implementations and history store trivial properties

### Svelte 5 + Vitest + happy-dom
- Vitest config needs `resolve: { conditions: ["browser"] }` to use browser build of Svelte 5 (otherwise `mount()` throws `lifecycle_function_unavailable`)
- `@testing-library/svelte` needed separately (not included in vitest defaults)
- Svelte a11y: `<nav>` cannot have `role="tablist"` — use `<div role="tablist">` instead

### WebSocket testing pattern
- Mock WebSocket class needs static constants (`OPEN = 1`, `CLOSED = 3`, etc.) when production code checks `ws.readyState === WebSocket.OPEN`
- `disconnect()` must not double-fire state change — either the explicit call or the `onclose` handler, not both

### Vite dev proxy for backend
- `vite.config.ts` server proxy: `'/ws': { target: 'http://localhost:8000', ws: true }` enables `task frontend:dev` against `task serve`
- Frontend derives WS URL from `window.location` — works in both dev (proxied) and production (same-origin)

### PixiJS hitArea must be a proper Shape
- Plain objects with `contains()` method do NOT work for hitArea in PixiJS 8 -- use `new Circle()`, `new Rectangle()`, etc.
- Small entities need a minimum hit radius (MIN_HIT_RADIUS=12) to be clickable at default zoom

### Server must ack pause/resume/step commands
- The WebSocket event stream only sends updates on tick boundaries; pause/resume/step need immediate `TickUpdateMessage` ack so the frontend updates `is_paused` state without waiting for the next tick

### Svelte conditional rendering vs component self-hiding
- Wrapping a panel in `{#if condition}` prevents it from managing its own empty/placeholder state
- Better pattern: always render the component and let it handle the no-selection case internally (InspectorPanel shows placeholder when no entity selected)

### Layout spacing adapts to entity count
- `layoutSpacing(entityCount)` in `rendering.ts` returns `2 * adaptiveMaxRadius(entityCount)`
- `adaptiveMaxRadius()` lerps: ≤30 entities → DETAIL_MAX_RADIUS (20), 30-100 → down to DETAIL_MID_RADIUS (12), 100-500 → down to DETAIL_MIN_RADIUS (6)
- Spiral minimum center-to-center distance is `spacing` (entity 0 at center, entity 1 at distance `spacing`)
- So `spacing >= 2 * max_radius` guarantees no overlap for any entity size
- `entityRadius(componentCount, maxRadius)` accepts optional maxRadius cap (defaults to DETAIL_MAX_RADIUS)

### Component clustering via circle-anchor positioning
- `componentLayout()` assigns each unique component name an anchor point evenly distributed on a circle (radius = WORLD_SIZE * 0.3)
- Each archetype's centroid = average of its components' anchor (x, y) positions
- Archetypes sharing components naturally cluster toward the same anchors
- Replaced earlier hash-based centroids which produced effectively random placement

### Floating-point precision in layout tests
- Spiral positions computed with `Math.sqrt` produce imprecision (e.g., 39.99999999999998 vs 40)
- Use epsilon tolerance in assertions: `expect(dist).toBeGreaterThanOrEqual(layoutSpacing(n) - 1e-9)`

### GitHub API: Replying to PR review comments
- Correct: `gh api repos/{owner}/{repo}/pulls/{pr}/comments -f body="..." -F in_reply_to={comment_id}`
- Wrong (404): `repos/{owner}/{repo}/pulls/comments/{id}/replies` — this endpoint does not exist
- Issue-level comments use `/issues/{pr}/comments`, review-line comments use `/pulls/{pr}/comments`

### Resolving GitHub PR review threads
- Use GraphQL mutation `resolveReviewThread(input: {threadId: "..."})` — REST API has no resolve endpoint
- Get thread IDs via `pullRequest(number: N) { reviewThreads { nodes { id isResolved } } }`

### svelte-check has pre-existing node_modules errors
- 6 errors in `esrap/types/index.d.ts` and `@types/css-font-loading-module/index.d.ts`
- These are third-party type declaration conflicts, not our source code
- Frontend builds fine; these only appear in `svelte-check` output

### Version via importlib.metadata
- `importlib.metadata.version("agentecs-viz")` reads from installed package metadata (set by `pyproject.toml`)
- `PackageNotFoundError` fallback to `"0.0.0-dev"` handles running from source without an installed distribution
- `_version.py` is the canonical import point; `__init__.py` re-exports `__version__`

### Svelte $state for $effect dependency tracking
- Variables read inside `$effect` must be `$state` runes for reactive tracking -- plain `let` variables are invisible to the effect system
- `void someVar` in `$effect` only establishes tracking if `someVar` is `$state`
- PixiJS object caches (Maps) should be re-initialized inside `onMount`, not at module scope, to handle component re-mount (e.g., tab switches)

### No task frontend:test or task frontend:check
- Taskfile only has `task frontend:dev` and `task frontend:build`
- Run frontend tests directly: `cd frontend && npx vitest run`

---

## Implementation Notes

### REQ-002 Backend Core (implemented)
- All backend modules implemented: config, snapshot, protocol, history, sources/_base, sources/mock, server, cli
- 74 tests covering models, history compression, mock source lifecycle, REST endpoints, WebSocket handshake, CLI parsing
- Pydantic v2 throughout with `computed_field` for derived properties (archetype, archetypes)
- `# type: ignore[prop-decorator]` needed on computed_field properties (Pydantic/mypy interaction)
- WebSocket protocol: metadata message first, then snapshot, then event stream
- Server uses dual asyncio tasks for bidirectional WebSocket (receive_commands + send_events)
- MockWorldSource seeds with `_generate_entities()` on connect, advances via `_execute_tick()`

### REQ-003 Frontend App Shell (implemented)
- 10 source files in `frontend/src/lib/` + 3 test files in `frontend/src/__tests__/`, 26 tests
- Svelte 5 runes pattern: `$state` for mutable, `$derived` for computed, class-based singletons exported as `world`/`timeline`
- WebSocket client uses flat command format matching backend protocol: `{"command":"seek","tick":5}`
- Entity change tracking via structural hashing (`entityHash()`) — detects new and changed entities between snapshots
- App shell layout: Header → TabBar → content → StatusBar, connection state machines (connecting/connected/error/disconnected)
- Tab content is placeholder divs referencing future REQs — ready for drop-in component replacement
- Delta message handling deferred (stub) — full application comes with REQ-006/007

### REQ-004 Entity View (implemented)
- 5 new source files: `colors.ts`, `rendering.ts`, `layout.ts`, `EntityView.svelte` + `archetypeConfigMap` added to `world.svelte.ts`
- 3 new test files: `colors.test.ts` (14 tests), `layout.test.ts` (17 tests), `entityview.test.ts` (4 smoke tests)
- PixiJS 8 + pixi-viewport: async `Application.init()` with try/catch for graceful degradation in test environments (happy-dom has no Canvas)
- Two-level semantic zoom: Detail (clickable entities, labels at high zoom, selection/changed rings) and Overview (point cloud)
- Auto zoom detection: `entityPixelSize = DETAIL_BASE_RADIUS * 2 * viewport.scaled`, threshold 15px
- Two focus modes: Archetypes (groups by exact archetype, Position component used when present) and Components (centroid via circle-anchor clustering)
- Color resolution priority: (1) `ArchetypeConfig.color` from server config, (2) `config.color_palette` hashed, (3) `DEFAULT_COLOR_PALETTE` hashed
- Layout uses golden-angle spiral for within-group entity placement, circular orbit for group placement
- Adaptive entity sizing: `adaptiveMaxRadius(entityCount)` scales down as entity count grows
- Viewport fit: initial view fits entity bounding box (with VIEWPORT_FIT_PADDING) instead of full world
- Zoom controls: +/−/reset overlay buttons (bottom-right)
- Editable tick field: click tick in header → input, Enter seeks, Escape cancels; regex-validated, clamped to tickRange
- HTML overlay controls: view level toggle (top-right), focus mode dropdown (top-left), archetype legend (bottom-left), hover tooltip
- Keyboard: Escape to deselect; click entity toggles selection via `world.selectEntity()`
- `app.test.ts` updated: tab assertion uses `getAllByRole("tab")` instead of `getByText` to avoid conflict with EntityView's "Archetypes" option

### REQ-005 Inspector Panel (implemented)
- 2 new source files: `JsonTree.svelte`, `InspectorPanel.svelte` + 2 test files (18 tests)
- JsonTree is a recursive Svelte component with depth-aware collapse defaults (expanded at depth 0, collapsed deeper)
- Status/error field hints from `VisualizationConfig.field_hints` drive badge styling in JsonTree
- InspectorPanel reads `world.selectedEntity` (derived from `selectedEntityId` + entity list scan) -- no separate fetch needed
- App.svelte wraps EntityView in a flex container; InspectorPanel always renders beside it (manages its own empty state)
- Component sections default to expanded (opposite of JsonTree nested objects) for immediate visibility
- Inspector test pattern: `setWorldState()` helper sets `world.snapshot` and `world.config` directly, then `world.selectEntity(id)` triggers derived state
