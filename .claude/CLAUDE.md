# Project Configuration (agentecs-viz)

**Documentation**: Full documentation lives in the main agentecs repo at `docs/viz/`.
See https://extensivelabs.github.io/agentecs/viz/

<vibe_coding>
**This is a vibe coding project.** Claude writes code autonomously, manages PRs, handles reviews, and merges. The user steers direction but does not write code.

## Post-Implementation Workflow

After quality-check passes and user confirms ready:

1. **Create PR** via `gh pr create`
2. **Copilot review loop** — run until clean:
   a. Ask user to request Copilot review (or wait if auto-triggered)
   b. When user says review is ready, fetch comments — `gh api repos/{owner}/{repo}/pulls/{pr}/comments?per_page=100`
   c. For each comment, assess and either:
      - **Implement**: fix the code, commit, push, reply explaining the fix
      - **Reject**: reply with a clear technical reason why the suggestion doesn't apply
   d. Resolve ALL threads and verify 0 unresolved — use "Resolve and verify" script below
   e. Ask user to re-request Copilot review
   f. Repeat b-e until no new comments remain
3. **Merge** — `gh pr merge --squash --delete-branch`
4. **Finalize** — invoke `/requirement-complete`

## Addressing Existing PR Review Comments

When tackling review comments on existing PRs, follow this checklist for **each PR**:

1. **Fetch comments** — `gh api repos/{owner}/{repo}/pulls/{pr}/comments?per_page=100`
2. **Triage** — categorize each comment as actionable code fix, documentation update, or decline
3. **Implement fixes** — code changes, test additions, PR description updates
4. **Run tests** — `task test` (Python) + `cd frontend && npx vitest run` (frontend)
5. **Commit and push** — atomic commit with review fix summary
6. **Reply to each comment** — explain fix or reason for declining
7. **Resolve threads and verify** — run the resolve-and-verify script below. **A PR is NOT done until this reports 0 unresolved.**

Replying to a comment does NOT resolve it. You must explicitly resolve threads via GraphQL.

### Resolve and verify (run after every PR review pass)
```bash
# For each PR, run this AFTER replying to all comments:
PR=20  # set PR number
OWNER=extensivelabs
REPO=agentecs-viz

# 1. Get unresolved thread IDs
THREADS=$(gh api graphql -f query="{ repository(owner: \"$OWNER\", name: \"$REPO\") {
  pullRequest(number: $PR) { reviewThreads(first: 100) { nodes { id isResolved } } }
}}" --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false) | .id')

# 2. Resolve each one
for tid in $THREADS; do
  gh api graphql -f query="mutation { resolveReviewThread(input: {threadId: \"$tid\"}) { thread { isResolved } } }"
done

# 3. Verify zero unresolved (MUST be 0 to consider PR done)
REMAINING=$(gh api graphql -f query="{ repository(owner: \"$OWNER\", name: \"$REPO\") {
  pullRequest(number: $PR) { reviewThreads(first: 100) { nodes { isResolved } } }
}}" --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)] | length')
echo "PR #$PR: $REMAINING unresolved threads"
# If REMAINING > 0, something was missed — investigate before declaring done.
```
</vibe_coding>

<language_rules>
- Python version: 3.11+
- Always type everything correctly. Use modern typing without the typing library if possible.
- Prefer pydantic models for data and input/output.
- Check how other functionalities are implemented and align your approach.
- Frontend: Svelte 5 with runes, TypeScript strict mode, Tailwind CSS v4
</language_rules>

<commands>
## Task Runner (Taskfile.yml)

- `task install` - Full setup (venv, deps, frontend, hooks)
- `task test` - Run tests (add `-- --cov=src/agentecs_viz` for coverage)
- `task lint` - Lint and auto-fix
- `task format` - Format code (add `-- --check` for check-only)
- `task typecheck` - Run mypy
- `task check` - All checks (for CI)
- `task serve` - Start server with mock data
- `task build` - Build wheel
- `task frontend:dev` - Frontend hot reload
- `task frontend:build` - Build frontend
- `task frontend:test` - Run frontend tests (vitest)
- `task frontend:check` - Frontend type checking + tests
- `task clean` - Clean artifacts (add `-- --all` for venv too)
</commands>

<architecture>
agentecs-viz is the visualization server for AgentECS.

**Backend** (`src/agentecs_viz/`):
```
cli.py              # CLI entry point
server.py           # FastAPI + WebSocket server
protocol.py         # WebSocket message protocol
snapshot.py         # World snapshot data structures
history.py          # History storage for replay
config.py           # Configuration
sources/            # WorldStateSource implementations
  _base.py          # TickLoopSource base class
  local.py          # LocalWorldSource (wraps live World)
  mock.py           # MockWorldSource (test data)
  replay.py         # ReplayWorldSource (playback)
```

**Frontend** (`frontend/`):
```
src/
  lib/
    EntityView.svelte     # Main visualization (PixiJS two-level zoom)
    InspectorPanel.svelte # Selected entity detail sidebar
    JsonTree.svelte       # Recursive JSON tree renderer
    Header.svelte         # App header with controls
    TabBar.svelte         # Tab navigation
    StatusBar.svelte      # Connection status footer
    colors.ts             # Archetype color resolution
    rendering.ts          # Rendering constants (radii, colors, layout spacing)
    layout.ts             # Entity layout algorithms (archetype/component spiral)
    utils.ts              # Archetype key/display helpers
    state/
      world.svelte.ts     # Reactive world state (singleton)
      timeline.svelte.ts  # Timeline state
    types.ts              # TypeScript types
  App.svelte
  main.ts
```

**Principles:**
- Protocol-driven: All world access via WorldStateSource protocol
- Component agnostic: Adapts to any components
- Local-first: Easy local development with mock data
</architecture>

<testing>
- Python: pytest with pytest-asyncio
- Frontend: Vitest with happy-dom
- Run tests: `task test` (Python), `task frontend:test` (frontend)
- `task check` runs all checks: Python (ruff, mypy, pytest) + frontend (svelte-check, tsc, vitest)
- Focus on core functionality, not coverage metrics
</testing>

<tool_pitfalls>
## Glob does NOT find dotfiles/dotdirs

The Glob tool fails to match hidden directories (`.claude/`, `.agents/`, `.opencode/`).
**NEVER use Glob to find or check existence of dotfile paths.**

Instead use:
- `ls -la .claude/ .agents/ 2>/dev/null` via Bash
- `Read` tool on the directory path directly (e.g., read `.agents/`)

This applies to ALL paths starting with `.` — config files, harness files, agent working files.
</tool_pitfalls>

<quick_reference>
## Skills (slash commands)
- `/agents-init` - Create .agents/ directory
- `/requirement-complete` - Finalize completed requirement
- `/harness-update` - Update existing .agents/ and .claude/ to latest patterns

## Subagents (dispatch via Task tool)
- `debugging-agent` - Bug/failure investigation
- `quality-check` - Post-implementation review
- `code-review` - On-demand codebase review

## Keyboard Shortcuts
- `Ctrl+T` - Toggle task list view
- `Ctrl+B` - Background current task
</quick_reference>
