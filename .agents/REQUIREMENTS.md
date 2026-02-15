# Requirements

Active requirements for agentecs-viz development.

**Design Document**: `.agents/VIZ-SPIKE-001-design.md` (source of truth)
**Completed Requirements**: `COMPLETED_REQUIREMENTS.md`

---

## Design Principles

1. **T is the Universal Variable** — Every visualization, query, and computation operates relative to current time T.
2. **Component-Agnostic** — The viz cannot depend on specific component types.
3. **Simple → Complex** — P1 (core), P2 (enhanced), P3 (advanced). Implement in order.
4. **Minimal Upstream** — Derive from OTel where possible. Degrade gracefully.
5. **Fresh Implementation** — Implement against design document, not old code.

---

## Phase 1: Core Debugging

### REQ-006: Timeline Scrubber & History Storage
- [ ] Completed
- **Branch:** `feature/req-006-timeline-history`
- **Task List:** `feature/req-006-timeline-history`
- **Started:**
- **Completed:**
- **Priority:** P1
- **Blocked by:** REQ-002, REQ-003

Timeline control bar for T navigation. Backend history storage enabling state at any tick.

**Scope:**

*Timeline Bar (frontend):*
- Scrubber: draggable position on tick range
- Controls: play, pause, step forward, step backward
- Speed selector: 0.5x, 1x, 2x, 5x, 10x
- Mode indicator: LIVE (red dot), PAUSED, HISTORY
- Tick display: current T / max T
- Cross-tab: visible in all tabs

*T Navigation:*
- Drag scrubber → seek to tick
- Click LIVE → jump to latest, resume streaming
- Step → advance/retreat by one tick
- Keyboard: Space (play/pause), Arrow keys (step)

*Backend Integration (uses HistoryStore from REQ-002):*
- Server wires MockWorldSource ticks into InMemoryHistoryStore
- `seek(tick)` WebSocket command triggers state reconstruction and response
- Streaming resumes from current position after seek

**Acceptance Criteria:**
- Scrubber visible below tabs in all views
- Dragging scrubber changes T and updates all views
- Step forward/backward works
- "LIVE" button returns to streaming mode
- History of at least 100 ticks available for scrubbing
- State at any historical T matches what was live at that tick

**Design Ref:** Section 6 (Unified Time Model)

---

### REQ-020: Remove Archetypes Focus Mode, Keep Components Only
- [ ] Completed
- **Branch:** `feature/req-020-remove-archetype-focus`
- **Task List:** `feature/req-020-remove-archetype-focus`
- **Started:**
- **Completed:**
- **Priority:** P1
- **Blocked by:** REQ-004

Remove the Archetypes focus mode from Entity View. Archetypes mode is redundant — entities with the same archetype share all components, so they naturally cluster tightest in Components mode already. Archetypes mode replaces this gradient proximity with arbitrary even-spacing on a circle, which is strictly less informative.

**Scope:**

*Remove Archetypes Mode:*
- Remove `archetypeLayout()` from `layout.ts`
- Remove focus mode dropdown from EntityView.svelte (no toggle needed with single mode)
- Remove archetype layout tests from `layout.test.ts`
- Clean up any dead code (focus mode state, conditional branches)

*Verify Components Mode:*
- Ensure component-based centroid positioning works correctly as the sole layout
- Entities with identical archetypes cluster at the same centroid (tightest grouping)
- Entities sharing some components have nearby centroids (gradient proximity)
- Entities with disjoint components are far apart
- Position component override still works (`Position`/`Pos`/`Transform` with x/y)

*UI Cleanup:*
- Remove the focus mode selector from the overlay controls
- "Components" layout is now the default and only spatial layout (until Pipeline View in REQ-012)
- Archetype legend (bottom-left) remains — it shows color mapping, which is still useful

**Acceptance Criteria:**
- Focus mode dropdown removed from Entity View
- Single layout algorithm: component-centroid positioning
- Same-archetype entities cluster tightest
- Shared-component entities cluster by degree of overlap
- Position component override still functions
- No dead code from old archetypes mode remains
- Existing tests updated, all passing

---

## Code Health & Architecture

---

---

### REQ-025: EntityView Lifecycle & Reactivity
- [ ] Completed
- **Branch:** `feature/req-025-entityview-lifecycle`
- **Task List:** `feature/req-025-entityview-lifecycle`
- **Started:**
- **Completed:**
- **Priority:** P1
- **Blocked by:** REQ-004

Several reactivity and lifecycle issues in `EntityView.svelte` that will cause bugs as the app grows.

**Scope:**

*`viewport` is not reactive (line 329):*
- `viewport` is a plain `let` variable, not `$state`
- `void viewport` in `$effect` does NOT establish reactive tracking
- Changes to `viewport` during async init won't re-trigger the render effect
- Fix: make `viewport` a `$state` rune

*PixiJS object Maps survive re-mount (lines 35-40):*
- `entityGraphics`, `entityHitRadii`, `entityLabels` are closure-scoped `let` Maps
- If the component re-mounts (e.g., tab switch), stale references persist
- Fix: re-initialize Maps inside `onMount`, not at module scope

*O(n) hover lookup (line 157):*
- `pointerover` handler calls `world.entities.find((en) => en.id === entityId)` on every hover
- Fix: use a `Map<number, EntitySnapshot>` lookup built once per render cycle

*Set reactivity audit (world.svelte.ts lines 26-27):*
- `newEntityIds` and `changedEntityIds` are `$state(new Set())`
- Full Set reassignment in `updateEntityTracking` should trigger reactivity, but `.has()` tracking may be unreliable
- Audit and confirm or fix

**Acceptance Criteria:**
- `viewport` change triggers re-render
- Component re-mount starts with clean state
- Hover lookup is O(1)
- Set reactivity verified with test
- All existing tests pass

---

### REQ-026: Frontend Robustness
- [ ] Completed
- **Branch:** `feature/req-026-frontend-robustness`
- **Task List:** `feature/req-026-frontend-robustness`
- **Started:**
- **Completed:**
- **Priority:** P2

Collection of warning-level frontend issues from code review.

**Scope:**

*WebSocket silent JSON catch (websocket.ts:68-70):*
- Malformed JSON messages silently swallowed with empty `catch {}`
- Add logging or invoke error callback

*Timeline speed edge cases (timeline.svelte.ts:13-14):*
- `nextSpeed()`/`prevSpeed()` misbehave if current `playbackSpeed` is not in `availableSpeeds`
- `indexOf` returns -1, causing `nextSpeed` to wrap to index 0 (counterintuitive)
- Add guard for speed not in list

*Delta messages silently discarded (world.svelte.ts:187-189):*
- Delta case is a no-op with comment — if server sends deltas, frontend misses updates
- Add a `console.warn` or structured log until delta application is implemented in REQ-006/007

*StatusBar color semantic mismatch (StatusBar.svelte:8):*
- `replay` mode uses `text-entity-agent` color class — semantic mismatch
- Use a dedicated replay color or neutral color

*Colors module coupling (colors.ts:3):*
- `colors.ts` imports `world` singleton at module level — prevents isolated testing
- Consider passing config as parameter instead

**Acceptance Criteria:**
- Malformed WebSocket messages logged (not silently dropped)
- Timeline speed controls handle out-of-list speeds gracefully
- Delta message no-op produces a visible warning
- Color semantic mismatches resolved
- All existing tests pass

---

### REQ-007: Component Diff
- [ ] Completed
- **Branch:** `feature/req-007-component-diff`
- **Task List:** `feature/req-007-component-diff`
- **Started:**
- **Completed:**
- **Priority:** P1
- **Blocked by:** REQ-005, REQ-006

Show what changed in entity state. L1 (T vs T-1) and L2 (T1 vs T2) diffs.

**Scope:**

*Diff Computation (frontend):*
- Deep diff between two snapshots of same entity
- Detect: added fields, removed fields, changed values
- Handle nested objects and arrays

*Diff Display (in Inspector):*
- "Changes" section showing diff since previous tick
- Green highlight for additions
- Red highlight for removals
- Old → New display for changed values
- Diff badge count ("3 changes")

*Entity View Integration:*
- Yellow ring on entities that changed this tick
- Diff badge overlay showing change count

*L2 (Historical Diff):*
- "Compare to tick..." selector in Inspector
- Shows diff between current T and selected T

**Acceptance Criteria:**
- Inspector shows what changed since T-1
- Changed fields highlighted with old → new values
- Entities with changes have yellow rings in Entity View
- Can compare entity state at any two historical ticks

**Design Ref:** Section 7 (Diff View, L1/L2), VIZ-OPS-003

---

### REQ-008: Error Events & Display
- [ ] Completed
- **Branch:** `feature/req-008-error-display`
- **Task List:** `feature/req-008-error-display`
- **Started:**
- **Completed:**
- **Priority:** P1
- **Blocked by:** REQ-004, REQ-006

Surface errors prominently with entity-time correlation.

**Scope:**

*Backend:*
- `ErrorEvent` message type in protocol
- Error capture from MockWorldSource (simulated errors)
- Error storage indexed by tick and entity

*Frontend — Indicators:*
- Error count in header bar (clickable)
- Red ring on error entities in Entity View
- Error icon overlay

*Frontend — Error Panel:*
- Expandable panel from header click
- List of errors with: entity ID, tick, message, severity
- Severity: Critical (red), Warning (yellow), Info (blue)
- "Jump to tick" button per error
- "View Entity" button per error
- "View Trace" button per error (functional after REQ-009, shown disabled before)

*Error-Time Correlation:*
- Errors at T shown prominently
- Past errors shown as gray indicators
- Future errors not shown (T-relative)

**Acceptance Criteria:**
- MockWorldSource generates occasional errors
- Error count visible in header
- Red rings appear on error entities
- Error panel lists errors with jump-to-tick
- Clicking "Jump to tick" changes T and selects entity

**Design Ref:** Section 8 (Error Analysis), VIZ-OPS-002

---

## Phase 2: LLM Visibility

### REQ-009: Trace View & LLM Spans
- [ ] Completed
- **Branch:** `feature/req-009-trace-view`
- **Task List:** `feature/req-009-trace-view`
- **Started:**
- **Completed:**
- **Priority:** P2
- **Blocked by:** REQ-003, REQ-006

Traces tab displaying OTel spans with LLM-specific rendering.

**Scope:**

*Backend:*
- Trace/span data in protocol (span ID, parent, name, attributes, timing, status)
- MockWorldSource generates mock spans (LLM calls, tool calls, system execution)
- Spans indexed by tick and entity

*Waterfall (`TracesTab.svelte`):*
- Hierarchical span display with timing bars
- Grouped by tick
- Span name, duration, status indicators
- Click to select → shows detail panel

*Span Type Detection:*
- LLM spans: detect `llm.*` or `gen_ai.*` attributes
  - Render: model badge, token counts, cost, expandable messages
- Tool spans: detect `tool.*` or `function.*` attributes
  - Render: input/output, duration
- Retrieval spans: detect `retriever.*` or `embedding.*` attributes
  - Render: vector counts, similarity scores
- System spans: detect `agentecs.system_name`
  - Render: system name, entity count
- Generic: formatted attribute tree

*Attribute Panel:*
- Selected span's full attributes as expandable key-value tree
- Heuristic highlighting: `*error*` → red, `*token*` → summary, `*message*` → conversation format

*Entity-Trace Correlation:*
- Filter traces by selected entity
- Inspector "Traces" section linking to relevant spans

**Acceptance Criteria:**
- Traces tab shows waterfall of mock spans
- LLM spans render with token counts and model badge
- Click span → attribute panel shows details
- Filter by entity works
- Spans update when T changes

**Upstream Dependency:** `agentecs.tick` and `agentecs.entity_id` OTel attributes (required for correlation)

**Design Ref:** Section 4 (Trace View), VIZ-OPS-005

---

### REQ-010: Token & Cost Tracking
- [ ] Completed
- **Branch:** `feature/req-010-token-cost`
- **Task List:** `feature/req-010-token-cost`
- **Started:**
- **Completed:**
- **Priority:** P2
- **Blocked by:** REQ-009, REQ-005

Aggregate and display token usage and cost across entities and models.

**Scope:**
- Header: running total tokens, total cost
- Per-entity token attribution in Inspector
- Cost breakdown by model (from span attributes)
- Budget warning at configurable threshold

**Acceptance Criteria:**
- Header shows cumulative tokens and cost
- Inspector shows per-entity token breakdown
- Model-level cost breakdown available
- Warning indicator when budget threshold exceeded

**Design Ref:** VIZ-OPS-006

---

### REQ-011: Loop Detection
- [ ] Completed
- **Branch:** `feature/req-011-loop-detection`
- **Task List:** `feature/req-011-loop-detection`
- **Started:**
- **Completed:**
- **Priority:** P2
- **Blocked by:** REQ-006, REQ-004

Detect entities stuck in repetitive state patterns.

**Scope:**
- Algorithm: compare entity state across consecutive ticks, detect repetition
- Visual indicator on looping entities (distinct from change/error rings)
- Optional auto-pause when loop detected
- Loop details in Inspector (cycle length, repeated fields)

**Acceptance Criteria:**
- MockWorldSource can generate looping entities
- Looping entities visually indicated in Entity View
- Inspector shows loop details (which fields repeat, cycle length)
- Auto-pause option works

**Design Ref:** VIZ-OPS-007

---

### REQ-012: Pipeline View Mode
- [ ] Completed
- **Branch:** `feature/req-012-pipeline-view`
- **Task List:** `feature/req-012-pipeline-view`
- **Started:**
- **Completed:**
- **Priority:** P2
- **Blocked by:** REQ-004

Alternative Entity View positioning: kanban-style columns by execution phase.

**Scope:**
- Toggle between Spatial (default) and Pipeline views
- Columns determined by configurable status field (from VisualizationConfig)
- Entities positioned within their column
- Column headers with entity count
- Smooth transition animation between modes

**Acceptance Criteria:**
- View toggle switches between Spatial and Pipeline
- Entities grouped into columns by detected status field
- Entity count per column visible
- Selection and hover still work in Pipeline mode

**Design Ref:** VIZ-OPS-008, Section 12 (Wireframes — Pipeline View)

---

### REQ-013: Entity Filtering & Query Builder
- [ ] Completed
- **Branch:** `feature/req-013-query-builder`
- **Task List:** `feature/req-013-query-builder`
- **Started:**
- **Completed:**
- **Priority:** P2
- **Blocked by:** REQ-004

Visual query interface for filtering entities by component presence/absence and field values.

**Scope:**
- Query UI: "WITH [Component] AND [Component] NOT [Component]"
- Component type autocomplete from current snapshot
- Query results highlighted/filtered in Entity View
- Saved queries with user-defined names

**Acceptance Criteria:**
- Can build component-based queries
- Autocomplete suggests available component types
- Entity View filters to matching entities
- Saved queries persist during session

**Design Ref:** VIZ-OPS-010

---

### REQ-014: Component Value Distribution
- [ ] Completed
- **Branch:** `feature/req-014-value-distribution`
- **Task List:** `feature/req-014-value-distribution`
- **Started:**
- **Completed:**
- **Priority:** P2
- **Blocked by:** REQ-003

Visualize distribution of component field values across entities.

**Scope:**
- Select component type → field → show distribution
- Histogram for numeric fields (pure SVG)
- Bar chart for string/enum fields (pure SVG)
- Click value → filter Entity View to matching entities

**Charting:** Pure CSS/SVG. Add LayerCake only if interactivity demands it.

**Acceptance Criteria:**
- Can select any component field and see its distribution
- Numeric fields show histogram
- String fields show bar chart
- Click on chart segment filters entities
- Distribution reflects state at current T (updates on T change)

**Design Ref:** VIZ-OPS-012

---

### REQ-015: Advanced Diff
- [ ] Completed
- **Branch:** `feature/req-015-advanced-diff`
- **Task List:** `feature/req-015-advanced-diff`
- **Started:**
- **Completed:**
- **Priority:** P2
- **Blocked by:** REQ-007, REQ-006

Global and filtered diffs comparing world state between any two ticks.

**Scope:**
- L3: All entities T1 vs T2 — summary (spawned, destroyed, modified counts) + expandable details
- L4: Filtered diff — by archetype, component, change type, magnitude
- Diff summary statistics panel
- Accessible from Timeline (select range) or dedicated UI

**Acceptance Criteria:**
- Can select two ticks and see global diff
- Summary shows spawn/destroy/modify counts
- Can filter diff by archetype, component presence, change type
- Expandable per-entity details within diff
- Magnitude filter ("only entities with >N changes") works

**Design Ref:** Section 7 (Diff View, L3/L4)

---

## Phase 3: Systems & Advanced

### REQ-016: Systems View & Execution Groups
- [ ] Completed
- **Branch:** `feature/req-016-systems-view`
- **Task List:** `feature/req-016-systems-view`
- **Started:**
- **Completed:**
- **Priority:** P3
- **Blocked by:** REQ-009

Dedicated systems visualization showing execution groups, system metrics, and entity flow.

**Scope:**
- Execution group pipeline layout (groups → systems → metrics)
- Per-system metrics: entity count, execution time, token usage, error count
- Click system → entity list
- "Show entities processed by [System X]" filter in Entity View
- Entity execution graph: show entity's journey through systems over ticks

**Upstream Dependency:**
- `SystemExecutedEvent` with per-system timing (required)
- System Registry API: `GET /systems` returning system names, query patterns, execution groups (optional, graceful degradation)
- `agentecs.system_name` OTel attribute

**Acceptance Criteria:**
- Systems tab shows execution group pipeline
- Per-system metrics visible (timing, entity count, errors)
- Click system → see entity list
- Gracefully hidden if no system data available

**Design Ref:** Section 5 (Systems View), VIZ-OPS-009, VIZ-OPS-013

---

### REQ-017: Archetype Migration Tracking
- [ ] Completed
- **Branch:** `feature/req-017-archetype-migration`
- **Task List:** `feature/req-017-archetype-migration`
- **Started:**
- **Completed:**
- **Priority:** P3
- **Blocked by:** REQ-006, REQ-004

Track and visualize entity archetype transitions over time.

**Scope:**
- Detect archetype changes from component add/remove in history
- Sankey diagram showing archetype transitions (flow quantities)
- "Stuck entities" detector (entities that haven't changed archetype in N ticks)
- Migration history section in Inspector

**Acceptance Criteria:**
- Archetype transitions detected from history
- Sankey diagram renders transition flows
- Inspector shows migration history for selected entity
- Stuck entity detection works

**Design Ref:** VIZ-OPS-011

---

### REQ-018: Advanced Analysis
- [ ] Completed
- **Branch:** `feature/req-018-advanced-analysis`
- **Task List:** `feature/req-018-advanced-analysis`
- **Started:**
- **Completed:**
- **Priority:** P3
- **Blocked by:** REQ-015, REQ-016

System-based diffs, animated playback, and error aggregation.

**Scope:**
- L5: System-based diff — "What did System X change between T1 and T2?"
- L6: Animated diff playback — scrub through changes step by step
- Error aggregation: group similar errors, show patterns
- Error timeline chart: error count over ticks
- System affinity focus mode in Entity View (position by system execution)

**Upstream Dependency:** System-entity execution tracking (agentecs.system_name)

**Acceptance Criteria:**
- L5: Can diff by system ("what did System X change between T1 and T2?")
- L6: Animated playback scrubs through tick range with accumulating changes
- Error aggregation groups similar errors by message/type
- Error timeline chart shows error frequency over ticks
- System affinity positioning arranges entities by which systems process them

**Design Ref:** Section 7 (Diff View, L5/L6), Section 8 (Error Analysis P3), Section 3 (Focus Mode: Systems)

---

## Phase 4: Navigation & Management

### REQ-019: Navigation Sidebar with Run Browser
- [ ] Completed
- **Branch:** `feature/req-019-nav-sidebar`
- **Task List:** `feature/req-019-nav-sidebar`
- **Started:**
- **Completed:**
- **Priority:** P2
- **Blocked by:** REQ-003

Collapsible left sidebar providing navigation, run/session browsing, and extensible sections for future management features (admin, account, settings).

**Scope:**

*Sidebar Shell (frontend):*
- Left-side panel, collapsible via toggle button (hamburger or chevron in header)
- Collapsed state: hidden entirely (not icon-only), content area expands to fill
- Sidebar state persisted in localStorage
- Smooth open/close transition
- Resizable width (optional, drag handle)

*Run Browser Section:*
- Tree view of available runs/sessions from backend storage
- Hierarchical organization: categories/folders → runs
- Each run shows: name, date, entity count, duration, status (active/completed/failed)
- Click run → connect to that run (switch active data source)
- Active run highlighted
- Folder expand/collapse with item counts
- Search/filter within runs

*Backend — Run Listing API:*
- `GET /api/runs` — list available runs with metadata
- `GET /api/runs/{id}` — run detail (entity count, tick range, source type)
- Run metadata model: id, name, category/folder path, created_at, status, entity_count, tick_count, source_type
- Categories derived from folder structure or explicit tags
- MockWorldSource provides sample run listing for development

*Extensibility Sections (placeholders):*
- Section architecture supports adding new sidebar sections declaratively
- Placeholder slots for future additions: Admin, Account, Settings, Bookmarks
- Each section: icon, label, collapsible content area
- Sections can have badges (e.g., notification count)

**Acceptance Criteria:**
- Sidebar toggles open/closed from header button
- Collapsed state persists across page reloads
- Run browser lists available runs organized by category
- Clicking a run switches the active connection
- Active run visually indicated
- Search filters the run list
- Sidebar sections are extensible (adding a new section requires only a config entry + content component)
- Layout works with existing EntityView + InspectorPanel (three-panel layout when all open)

---

## Upstream Coordination (Cross-Cutting)

These are not implementation requirements for agentecs-viz but coordination items with the agentecs core team.

### Required (for P1/P2 features)
- `agentecs.tick` and `agentecs.entity_id` as OTel span attributes — needed for trace-entity correlation (REQ-009)
- Upstream cost: Low

### Optional (for P3 features)
- `agentecs.system_name` as OTel span attribute — needed for system-centric views (REQ-016)
- System Registry API: `GET /systems` — needed for Systems Tab (REQ-016)
- `SystemExecutedEvent` with per-system timing — needed for system waterfall (REQ-016)
- Shared component metadata in snapshots — needed for shared component visualization (future)

**Design Ref:** Section 9 (Upstream Interface Requirements)

---

## Dependency Graph

```
REQ-001 (Migration)
  └──▶ REQ-002 (Backend Core)
         ├──▶ REQ-021 (Protocol Compliance)
         ├──▶ REQ-022 (History Performance)
         └──▶ REQ-003 (Frontend Shell)
                ├──▶ REQ-023 (Shared Test Infrastructure)
                ├──▶ REQ-024 (Version Source of Truth)
                ├──▶ REQ-004 (Entity View)
                │      ├──▶ REQ-025 (EntityView Lifecycle)
                │      ├──▶ REQ-005 (Inspector Panel)
                │      │      ├──▶ REQ-007 (Component Diff) ◀── REQ-006
                │      │      └──▶ REQ-010 (Token/Cost) ◀── REQ-009
                │      ├──▶ REQ-008 (Error Display) ◀── REQ-006
                │      ├──▶ REQ-011 (Loop Detection) ◀── REQ-006
                │      ├──▶ REQ-012 (Pipeline View)
                │      ├──▶ REQ-013 (Query Builder)
                │      ├──▶ REQ-017 (Archetype Migration) ◀── REQ-006
                │      └──▶ REQ-020 (Remove Archetypes Focus Mode)
                ├──▶ REQ-006 (Timeline & History)
                │      └──▶ REQ-015 (Advanced Diff) ◀── REQ-007
                │             └──▶ REQ-018 (Advanced Analysis) ◀── REQ-016
                ├──▶ REQ-009 (Trace View)
                │      └──▶ REQ-016 (Systems View)
                ├──▶ REQ-014 (Value Distribution)
                ├──▶ REQ-019 (Nav Sidebar & Run Browser)
                └──▶ REQ-026 (Frontend Robustness)
```

## Implementation Order

Recommended sequence respecting dependencies:

```
 1. REQ-001  Fresh Migration           P0  ✅
 2. REQ-002  Backend Core              P0  ✅
 3. REQ-003  Frontend Shell            P0  ✅
 ── Code Health (do before new features) ──
 4. REQ-021  Protocol Compliance       P1  (architecture fix, no deps)
 5. REQ-022  History Performance       P1  (architecture fix, no deps)
 6. REQ-023  Shared Test Infra         P1  (enables faster test writing)
 7. REQ-024  Version Source of Truth   P1  done
 8. REQ-025  EntityView Lifecycle      P1  (fix before building on EntityView)
 ── Phase 1 ──────────────────────────────
 9. REQ-004  Entity View               P1  ✅
10. REQ-005  Inspector Panel           P1  ✅
11. REQ-020  Remove Archetypes Focus   P1  (small, can do immediately)
12. REQ-006  Timeline & History        P1  (can parallel with REQ-020)
13. REQ-007  Component Diff            P1
14. REQ-008  Error Display             P1
 ── Phase 2 ──────────────────────────────
15. REQ-026  Frontend Robustness       P2  (can parallel with Phase 2 features)
16. REQ-009  Trace View                P2
17. REQ-010  Token & Cost              P2
18. REQ-012  Pipeline View             P2  (can parallel with REQ-009)
19. REQ-013  Query Builder             P2  (can parallel)
20. REQ-014  Value Distribution        P2  (can parallel)
21. REQ-011  Loop Detection            P2
22. REQ-015  Advanced Diff             P2
 ── Phase 3 ──────────────────────────────
23. REQ-016  Systems View              P3
24. REQ-017  Archetype Migration       P3  (can parallel with REQ-016)
25. REQ-018  Advanced Analysis         P3
 ── Phase 4: Navigation & Management ───
26. REQ-019  Nav Sidebar & Run Browser P2  (can parallel with Phase 1+)
```

## Future (Not Yet Scoped)

Design document features intentionally deferred beyond P3:
- **Span comparison**: Side-by-side trace comparison (Section 4, P3)
- **System-centric trace grouping**: Group traces by system name (Section 4, P3)
- **Shared component visualization**: Connection lines for shared component instances (Section 3)
- **Entity View density heatmap**: P2 overlay for Overview mode (Section 3)
- **Entity View network graph**: P3 force-directed layout (Section 3)
- **Visual Composer**: Drag-drop entity creation, system designer (Phase 5+)

These will be scoped as requirements when P3 implementation is underway.

---

## Charting Strategy

Pure CSS/SVG for simple charts (bars, sparklines). Add LayerCake (~3kb, Svelte-native) only if time-series or interactive charts demand it.
