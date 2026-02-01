<script lang="ts">
  import { world } from "./world.svelte";
  import { getArchetypeDisplay } from "./utils";

  // Search/filter state
  let searchQuery = $state("");
  let debouncedQuery = $state("");
  let archetypeFilter = $state<string | null>(null);
  let expandedEntityId = $state<number | null>(null);

  // Debounce search query (150ms delay)
  $effect(() => {
    const timer = setTimeout(() => {
      debouncedQuery = searchQuery;
    }, 150);
    return () => clearTimeout(timer);
  });

  // Group entities by archetype
  const archetypeGroups = $derived(() => {
    const groups = new Map<string, number>();
    for (const entity of world.entities) {
      const key = getArchetypeDisplay(entity.archetype);
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    return Array.from(groups.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([archetype, count]) => ({ archetype, count }));
  });

  // Filtered entities based on search and archetype filter
  const filteredEntities = $derived(() => {
    let entities = world.entities;

    // Filter by archetype
    if (archetypeFilter) {
      entities = entities.filter(
        (e) => getArchetypeDisplay(e.archetype) === archetypeFilter
      );
    }

    // Filter by search query (debounced)
    if (debouncedQuery.trim()) {
      const query = debouncedQuery.toLowerCase();
      entities = entities.filter((e) => {
        // Match entity ID
        if (e.id.toString().includes(query)) return true;
        // Match archetype
        if (e.archetype.some((a) => a.toLowerCase().includes(query))) return true;
        // Match component data
        for (const comp of e.components) {
          if (comp.type_short.toLowerCase().includes(query)) return true;
          const dataStr = JSON.stringify(comp.data).toLowerCase();
          if (dataStr.includes(query)) return true;
        }
        return false;
      });
    }

    return entities;
  });

  // Export error state
  let exportError = $state<string | null>(null);

  // Export as CSV
  function exportCSV() {
    try {
      exportError = null;
      const headers = ["id", "archetype", "components"];
      const rows = world.entities.map((e) => [
        e.id.toString(),
        e.archetype.join("+"),
        e.components.map((c) => `${c.type_short}:${JSON.stringify(c.data)}`).join("; "),
      ]);

      const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join(
        "\n"
      );
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `world-tick-${world.tick}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("CSV export failed:", e);
      exportError = "Failed to export CSV";
    }
  }

  // Export as JSON
  function exportJSON() {
    try {
      exportError = null;
      const data = JSON.stringify(world.snapshot, null, 2);
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `world-tick-${world.tick}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("JSON export failed:", e);
      exportError = "Failed to export JSON";
    }
  }
</script>

<div class="space-y-6">
  <!-- Summary Stats -->
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
    <div class="p-4 rounded-lg bg-[var(--color-bg-secondary)]">
      <div class="text-sm text-[var(--color-text-secondary)]">Total Entities</div>
      <div class="text-3xl font-mono text-[var(--color-text-primary)]">{world.entityCount}</div>
    </div>
    <div class="p-4 rounded-lg bg-[var(--color-bg-secondary)]">
      <div class="text-sm text-[var(--color-text-secondary)]">Archetypes</div>
      <div class="text-3xl font-mono text-[var(--color-text-primary)]">{world.archetypes.length}</div>
    </div>
    <div class="p-4 rounded-lg bg-[var(--color-bg-secondary)]">
      <div class="text-sm text-[var(--color-text-secondary)]">Current Tick</div>
      <div class="text-3xl font-mono text-[var(--color-text-primary)]">{world.tick}</div>
    </div>
    <div class="p-4 rounded-lg bg-[var(--color-bg-secondary)]">
      <div class="text-sm text-[var(--color-text-secondary)]">Status</div>
      <div class="text-3xl font-mono {world.isPaused ? 'text-[var(--color-warning)]' : 'text-[var(--color-success)]'}">
        {world.isPaused ? "Paused" : "Running"}
      </div>
    </div>
  </div>

  <!-- Archetype Distribution -->
  <div class="rounded-lg bg-[var(--color-bg-secondary)] overflow-hidden">
    <div class="px-4 py-3 border-b border-[var(--color-bg-tertiary)]">
      <h2 class="font-medium text-[var(--color-text-primary)]">Archetype Distribution</h2>
    </div>
    <div class="p-4">
      {#if archetypeGroups().length === 0}
        <p class="text-[var(--color-text-muted)] text-center py-4">No entities</p>
      {:else}
        <div class="space-y-3">
          {#each archetypeGroups() as { archetype, count }}
            {@const percentage = world.entityCount > 0 ? (count / world.entityCount) * 100 : 0}
            {@const isFiltered = archetypeFilter === archetype}
            <button
              class="w-full text-left"
              onclick={() => (archetypeFilter = isFiltered ? null : archetype)}
            >
              <div class="flex justify-between text-sm mb-1">
                <span
                  class="font-mono transition-colors {isFiltered
                    ? 'text-[var(--color-accent)]'
                    : 'text-[var(--color-text-secondary)]'}">{archetype}</span
                >
                <span class="text-[var(--color-text-muted)]"
                  >{count} ({percentage.toFixed(1)}%)</span
                >
              </div>
              <div class="h-2 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden">
                <div
                  class="h-full transition-all duration-300 {isFiltered
                    ? 'bg-[var(--color-accent)]'
                    : 'bg-[var(--color-accent)]/60'}"
                  style="width: {percentage}%"
                ></div>
              </div>
            </button>
          {/each}
        </div>
        {#if archetypeFilter}
          <button
            onclick={() => (archetypeFilter = null)}
            class="mt-3 text-xs text-[var(--color-accent)] hover:underline"
          >
            Clear filter
          </button>
        {/if}
      {/if}
    </div>
  </div>

  <!-- Entity Table -->
  <div class="rounded-lg bg-[var(--color-bg-secondary)] overflow-hidden">
    <div class="px-4 py-3 border-b border-[var(--color-bg-tertiary)] flex items-center justify-between">
      <h2 class="font-medium text-[var(--color-text-primary)]">
        Entities
        {#if filteredEntities().length !== world.entityCount}
          <span class="text-[var(--color-text-muted)] font-normal">
            ({filteredEntities().length} of {world.entityCount})
          </span>
        {/if}
      </h2>
      <label for="entity-search" class="sr-only">Search entities</label>
      <input
        id="entity-search"
        type="text"
        placeholder="Search entities..."
        bind:value={searchQuery}
        aria-label="Search entities by ID, archetype, or component data"
        class="px-3 py-1.5 rounded bg-[var(--color-bg-tertiary)] text-sm text-[var(--color-text-primary)]
               placeholder-[var(--color-text-muted)] border-none outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
      />
    </div>
    <div class="max-h-80 overflow-y-auto">
      {#if filteredEntities().length === 0}
        <p class="text-[var(--color-text-muted)] text-center py-8">
          {searchQuery || archetypeFilter ? "No matching entities" : "No entities"}
        </p>
      {:else}
        <table class="w-full text-sm">
          <thead class="sticky top-0 bg-[var(--color-bg-secondary)]">
            <tr class="text-left text-[var(--color-text-muted)] border-b border-[var(--color-bg-tertiary)]">
              <th class="px-4 py-2 font-medium">ID</th>
              <th class="px-4 py-2 font-medium">Archetype</th>
              <th class="px-4 py-2 font-medium">Components</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredEntities() as entity (entity.id)}
              {@const isExpanded = expandedEntityId === entity.id}
              <tr
                class="border-b border-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-tertiary)]/50 cursor-pointer transition-colors"
                onclick={() => (expandedEntityId = isExpanded ? null : entity.id)}
              >
                <td class="px-4 py-2 font-mono text-[var(--color-text-primary)]">{entity.id}</td>
                <td class="px-4 py-2 text-[var(--color-text-secondary)]">
                  {entity.archetype.join(", ")}
                </td>
                <td class="px-4 py-2 text-[var(--color-text-muted)]">
                  {entity.components.length} component{entity.components.length !== 1 ? "s" : ""}
                </td>
              </tr>
              {#if isExpanded}
                <tr class="bg-[var(--color-bg-tertiary)]/30">
                  <td colspan="3" class="px-4 py-3">
                    <div class="space-y-2">
                      {#each entity.components as comp}
                        <div>
                          <span class="text-[var(--color-accent)] font-mono text-xs"
                            >{comp.type_short}</span
                          >
                          <pre
                            class="mt-1 text-xs text-[var(--color-text-secondary)] bg-[var(--color-bg-primary)] rounded p-2 overflow-x-auto">{JSON.stringify(comp.data, null, 2)}</pre>
                        </div>
                      {/each}
                    </div>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  </div>

  <!-- Export buttons -->
  <div class="flex flex-col gap-2">
    <div class="flex gap-2">
      <button
        onclick={exportJSON}
        class="px-4 py-2 rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)]
               hover:bg-[var(--color-bg-tertiary)] transition-colors text-sm"
      >
        Export JSON
      </button>
      <button
        onclick={exportCSV}
        class="px-4 py-2 rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)]
               hover:bg-[var(--color-bg-tertiary)] transition-colors text-sm"
      >
        Export CSV
      </button>
    </div>
    {#if exportError}
      <p class="text-sm text-red-400">{exportError}</p>
    {/if}
  </div>
</div>
