<script lang="ts">
  import { world, type EntityLifecycle } from "./world.svelte";

  // Local tracking for entities spawning after backend fetch
  let localHistory = $state<Map<number, EntityLifecycle>>(new Map());
  let lastProcessedTick = $state<number>(-1);
  let backendFetchTick = $state<number>(-1);

  // Filter state
  let filterQuery = $state("");
  let showFilter = $state<"all" | "active" | "destroyed">("all");

  function isAliveAtTick(lifecycle: EntityLifecycle, tick: number): boolean {
    if (tick < lifecycle.spawnTick) return false;
    if (lifecycle.despawnTick === null) return true;
    return tick < lifecycle.despawnTick;
  }

  function refreshLifecycles() {
    if (world.isConnected && world.supportsReplay) {
      world.requestEntityLifecycles();
      backendFetchTick = world.tick;
      localHistory = new Map();
    }
  }

  // Request lifecycle data when connection established
  $effect(() => {
    if (world.isConnected && world.supportsReplay && backendFetchTick === -1) {
      refreshLifecycles();
    }
    if (!world.isConnected) {
      backendFetchTick = -1;
      localHistory = new Map();
      lastProcessedTick = -1;
    }
  });

  // Auto-refresh on Pause to get authoritative spawn ticks from history
  let wasPaused = $state(false);
  $effect(() => {
    if (world.isPaused && !wasPaused && world.supportsReplay) {
      refreshLifecycles();
    }
    wasPaused = world.isPaused;
  });

  // Merge backend (authoritative spawn ticks) with local tracking (live despawns)
  const entityHistory = $derived(() => {
    const merged = new Map<number, EntityLifecycle>();

    for (const lc of world.entityLifecycles) {
      merged.set(lc.entityId, {
        entityId: lc.entityId,
        spawnTick: lc.spawnTick,
        despawnTick: lc.despawnTick,
        archetype: lc.archetype,
      });
    }

    for (const [id, lc] of localHistory) {
      const existing = merged.get(id);
      if (existing) {
        merged.set(id, {
          entityId: id,
          spawnTick: existing.spawnTick,
          despawnTick: lc.despawnTick ?? existing.despawnTick,
          archetype: lc.archetype || existing.archetype,
        });
      } else {
        merged.set(id, lc);
      }
    }

    return merged;
  });

  // Track new entities and despawns during live mode
  $effect(() => {
    const currentTick = world.tick;
    if (currentTick <= lastProcessedTick && lastProcessedTick !== -1) {
      return;
    }

    const currentIds = new Set(world.entities.map((e) => e.id));
    const history = new Map(localHistory);
    const backendIds = new Set(world.entityLifecycles.map((lc) => lc.entityId));

    // Track new entities not in backend
    for (const entity of world.entities) {
      if (!backendIds.has(entity.id) && !history.has(entity.id)) {
        history.set(entity.id, {
          entityId: entity.id,
          spawnTick: currentTick,
          despawnTick: null,
          archetype: entity.archetype.join(", "),
        });
      } else if (history.has(entity.id)) {
        const existing = history.get(entity.id)!;
        const newArchetype = entity.archetype.join(", ");
        if (existing.archetype !== newArchetype) {
          history.set(entity.id, { ...existing, archetype: newArchetype });
        }
      }
    }

    // Mark despawned entities in local history
    for (const [id, lifecycle] of history) {
      if (!currentIds.has(id) && lifecycle.despawnTick === null) {
        history.set(id, { ...lifecycle, despawnTick: currentTick });
      }
    }

    // Track despawns for backend entities still marked alive
    for (const backendLc of world.entityLifecycles) {
      if (backendLc.despawnTick === null && !currentIds.has(backendLc.entityId)) {
        const existing = history.get(backendLc.entityId);
        if (!existing || existing.despawnTick === null) {
          history.set(backendLc.entityId, {
            entityId: backendLc.entityId,
            spawnTick: backendLc.spawnTick,
            despawnTick: currentTick,
            archetype: backendLc.archetype,
          });
        }
      }
    }

    localHistory = history;
    lastProcessedTick = currentTick;
  });

  const filteredLifecycles = $derived(() => {
    let lifecycles = Array.from(entityHistory().values());
    const currentTick = world.tick;

    lifecycles = lifecycles.filter((l) => l.spawnTick <= currentTick);

    if (showFilter === "active") {
      lifecycles = lifecycles.filter((l) => isAliveAtTick(l, currentTick));
    } else if (showFilter === "destroyed") {
      lifecycles = lifecycles.filter(
        (l) => l.despawnTick !== null && currentTick >= l.despawnTick
      );
    }

    if (filterQuery.trim()) {
      const query = filterQuery.toLowerCase();
      lifecycles = lifecycles.filter(
        (l) =>
          l.entityId.toString().includes(query) || l.archetype.toLowerCase().includes(query)
      );
    }

    return lifecycles.sort((a, b) => b.spawnTick - a.spawnTick);
  });

  const timelineBounds = $derived(() => {
    if (!world.canScrub || !world.tickRange) {
      const lifecycles = Array.from(entityHistory().values());
      if (lifecycles.length === 0) return { min: 0, max: world.tick };
      const min = Math.min(...lifecycles.map((l) => l.spawnTick));
      return { min, max: world.tick };
    }
    return { min: world.minTick, max: world.maxTick };
  });

  function getBarStyle(lifecycle: EntityLifecycle): string {
    const { min, max } = timelineBounds();
    const range = max - min || 1;
    const currentTick = world.tick;

    if (currentTick < lifecycle.spawnTick) {
      return `left: 0%; width: 0%`;
    }

    const startPercent = ((lifecycle.spawnTick - min) / range) * 100;
    let endTick = currentTick;
    if (lifecycle.despawnTick !== null && lifecycle.despawnTick <= currentTick) {
      endTick = lifecycle.despawnTick;
    }
    const widthPercent = ((endTick - lifecycle.spawnTick) / range) * 100;

    return `left: ${startPercent}%; width: ${Math.max(widthPercent, 1)}%`;
  }

  function jumpToTick(tick: number) {
    if (world.canScrub) {
      world.seek(tick);
    }
  }

  const modeDisplay = $derived(() => {
    switch (world.playbackMode) {
      case "live":
        return { label: "LIVE", color: "text-[var(--color-success)]" };
      case "recording":
        return { label: "REC", color: "text-red-400" };
      case "paused":
        return { label: "PAUSED", color: "text-[var(--color-warning)]" };
      case "replay":
        return { label: "REPLAY", color: "text-blue-400" };
      default:
        return { label: "---", color: "text-[var(--color-text-muted)]" };
    }
  });
</script>

<div class="space-y-6">
  <!-- Summary Stats -->
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
    <div class="p-4 rounded-lg bg-[var(--color-bg-secondary)]">
      <div class="text-sm text-[var(--color-text-secondary)]">Tick Range</div>
      <div class="text-2xl font-mono text-[var(--color-text-primary)]">
        {timelineBounds().min} - {timelineBounds().max}
      </div>
    </div>
    <div class="p-4 rounded-lg bg-[var(--color-bg-secondary)]">
      <div class="text-sm text-[var(--color-text-secondary)]">Entities Tracked</div>
      <div class="text-2xl font-mono text-[var(--color-text-primary)]">
        {entityHistory().size}
      </div>
    </div>
    <div class="p-4 rounded-lg bg-[var(--color-bg-secondary)]">
      <div class="text-sm text-[var(--color-text-secondary)]">Current Tick</div>
      <div class="text-2xl font-mono text-[var(--color-text-primary)]">{world.tick}</div>
    </div>
    <div class="p-4 rounded-lg bg-[var(--color-bg-secondary)]">
      <div class="text-sm text-[var(--color-text-secondary)]">Playback Mode</div>
      <div class="text-2xl font-mono {modeDisplay().color}">{modeDisplay().label}</div>
    </div>
  </div>

  <!-- Entity Lifecycle Swimlanes -->
  <div class="rounded-lg bg-[var(--color-bg-secondary)] overflow-hidden">
    <div
      class="px-4 py-3 border-b border-[var(--color-bg-tertiary)] flex items-center justify-between"
    >
      <h2 class="font-medium text-[var(--color-text-primary)]">
        Entity Lifecycle Swimlanes
        {#if filteredLifecycles().length !== entityHistory().size}
          <span class="text-[var(--color-text-muted)] font-normal">
            ({filteredLifecycles().length} of {entityHistory().size})
          </span>
        {/if}
      </h2>
      <div class="flex items-center gap-3">
        {#if world.supportsReplay}
          <button
            onclick={refreshLifecycles}
            class="px-2 py-1 rounded text-sm bg-[var(--color-bg-tertiary)]
                   hover:bg-[var(--color-accent)] text-[var(--color-text-secondary)]
                   hover:text-white transition-colors"
            title="Refresh lifecycle data from history"
          >
            Refresh
          </button>
        {/if}
        <select
          bind:value={showFilter}
          class="px-2 py-1 rounded bg-[var(--color-bg-tertiary)] text-sm text-[var(--color-text-primary)]
                 border-none outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="destroyed">Destroyed</option>
        </select>
        <input
          type="text"
          placeholder="Filter..."
          bind:value={filterQuery}
          class="px-3 py-1.5 rounded bg-[var(--color-bg-tertiary)] text-sm text-[var(--color-text-primary)]
                 placeholder-[var(--color-text-muted)] border-none outline-none focus:ring-1 focus:ring-[var(--color-accent)] w-32"
        />
      </div>
    </div>

    <div class="p-4">
      {#if entityHistory().size === 0}
        <p class="text-[var(--color-text-muted)] text-center py-8">
          No entity history tracked yet. Wait for entities to spawn.
        </p>
      {:else if filteredLifecycles().length === 0}
        <p class="text-[var(--color-text-muted)] text-center py-8">No matching entities</p>
      {:else}
        <div class="flex items-center mb-2 text-xs text-[var(--color-text-muted)]">
          <div class="w-20 shrink-0">Entity</div>
          <div class="flex-1 flex justify-between px-1">
            <span>{timelineBounds().min}</span>
            <span>{Math.floor((timelineBounds().min + timelineBounds().max) / 2)}</span>
            <span>{timelineBounds().max}</span>
          </div>
        </div>

        <div class="space-y-1 max-h-64 overflow-y-auto">
          {#each filteredLifecycles() as lifecycle (lifecycle.entityId)}
            {@const isAliveNow = isAliveAtTick(lifecycle, world.tick)}
            {@const hasDespawned = lifecycle.despawnTick !== null}
            <div class="flex items-center group">
              <div
                class="w-20 shrink-0 text-xs font-mono text-[var(--color-text-secondary)] truncate"
                title="Entity {lifecycle.entityId}: {lifecycle.archetype}"
              >
                #{lifecycle.entityId}
              </div>
              <div class="flex-1 relative h-5">
                <div class="absolute inset-0 bg-[var(--color-bg-tertiary)] rounded"></div>
                <button
                  class="absolute h-full rounded transition-all
                         {isAliveNow
                    ? 'bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]'
                    : 'bg-[var(--color-text-muted)] hover:bg-[var(--color-text-secondary)]'}
                         {world.canScrub ? 'cursor-pointer' : 'cursor-default'}"
                  style={getBarStyle(lifecycle)}
                  onclick={() => jumpToTick(lifecycle.spawnTick)}
                  title="Spawn: tick {lifecycle.spawnTick}{hasDespawned
                    ? `, Despawn: tick ${lifecycle.despawnTick}`
                    : ' (alive)'}"
                >
                  {#if lifecycle.despawnTick !== null && world.tick >= lifecycle.despawnTick}
                    <div
                      class="absolute right-0 top-0 h-full w-1 bg-[var(--color-error)] rounded-r"
                    ></div>
                  {/if}
                </button>
              </div>
            </div>
          {/each}
        </div>

        <div class="mt-3 flex items-center gap-4 text-xs text-[var(--color-text-muted)]">
          <div class="flex items-center gap-1">
            <div class="w-3 h-3 rounded bg-[var(--color-accent)]"></div>
            <span>Active</span>
          </div>
          <div class="flex items-center gap-1">
            <div class="w-3 h-3 rounded bg-[var(--color-text-muted)]"></div>
            <span>Despawned</span>
          </div>
          <div class="flex items-center gap-1">
            <div class="w-1 h-3 rounded bg-[var(--color-error)]"></div>
            <span>Despawn point</span>
          </div>
          {#if world.canScrub}
            <span class="ml-auto">Click bar to jump to spawn tick</span>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <!-- System Execution Waterfall (Placeholder) -->
  <div class="rounded-lg bg-[var(--color-bg-secondary)] overflow-hidden">
    <div class="px-4 py-3 border-b border-[var(--color-bg-tertiary)]">
      <h2 class="font-medium text-[var(--color-text-primary)]">System Execution Waterfall</h2>
    </div>
    <div class="p-8 text-center">
      <div class="text-[var(--color-text-muted)]">
        <p>System timing data not yet available.</p>
        <p class="text-xs mt-2 text-[var(--color-text-muted)]/70">
          Requires REQ-TRACE-003: SystemExecutedEvent
        </p>
      </div>
      <div class="mt-6 space-y-2 opacity-30">
        <div class="flex items-center gap-2">
          <div class="w-24 text-right text-xs text-[var(--color-text-muted)]">assignment</div>
          <div class="flex-1 h-4 bg-[var(--color-bg-tertiary)] rounded overflow-hidden">
            <div class="h-full w-1/4 bg-[var(--color-accent)]"></div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <div class="w-24 text-right text-xs text-[var(--color-text-muted)]">processing</div>
          <div class="flex-1 h-4 bg-[var(--color-bg-tertiary)] rounded overflow-hidden">
            <div class="h-full w-3/4 bg-[var(--color-success)] ml-[25%]"></div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <div class="w-24 text-right text-xs text-[var(--color-text-muted)]">cleanup</div>
          <div class="flex-1 h-4 bg-[var(--color-bg-tertiary)] rounded overflow-hidden">
            <div class="h-full w-1/6 bg-[var(--color-warning)] ml-[83%]"></div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Event Log (Placeholder) -->
  <div class="rounded-lg bg-[var(--color-bg-secondary)] overflow-hidden">
    <div class="px-4 py-3 border-b border-[var(--color-bg-tertiary)]">
      <h2 class="font-medium text-[var(--color-text-primary)]">Event Log</h2>
    </div>
    <div class="p-8 text-center">
      <div class="text-[var(--color-text-muted)]">
        <p>Event log not yet available.</p>
        <p class="text-xs mt-2 text-[var(--color-text-muted)]/70">
          Requires backend event emission.
        </p>
      </div>
      <div class="mt-6 text-left font-mono text-xs text-[var(--color-text-muted)] opacity-30">
        <div class="space-y-1">
          <div>47.312 processing Agent2.Task.status: IN_PROGRESS → COMPLETED</div>
          <div>47.298 processing Agent1.AgentState.iteration: 4 → 5</div>
          <div>47.089 assignment Spawned Agent5 with [Task, AgentState]</div>
          <div>47.001 tick_start Tick 47 started</div>
        </div>
      </div>
    </div>
  </div>
</div>
