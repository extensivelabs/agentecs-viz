<script lang="ts">
  import { world } from "./world.svelte";
  import { getArchetypeDisplay } from "./utils";
  import { getArchetypeColorCSS } from "./colors";
  import { isRecord } from "./types";

  interface Props {
    isActive?: boolean;
    onNavigateToPetriDish?: () => void;
  }

  let { isActive = false, onNavigateToPetriDish }: Props = $props();

  // Archetype territory data
  interface ArchetypeTerritory {
    archetype: string[];
    archetypeKey: string;
    count: number;
    entityIds: number[];
  }

  // Component info for registry
  interface ComponentInfo {
    name: string;
    entityCount: number;
    fields: string[];
  }

  // Selected archetype for highlighting
  let selectedArchetype = $state<string | null>(null);

  // Frozen order of archetype keys - only updates when tab becomes active
  let frozenOrder = $state<string[]>([]);
  let wasActive = $state(false);

  // Group entities by archetype (data only, no sorting)
  const archetypeData = $derived(() => {
    const groups = new Map<string, ArchetypeTerritory>();

    for (const entity of world.entities) {
      const key = getArchetypeDisplay(entity.archetype);
      if (!groups.has(key)) {
        groups.set(key, {
          archetype: entity.archetype.slice().sort(),
          archetypeKey: key,
          count: 0,
          entityIds: [],
        });
      }
      const group = groups.get(key)!;
      group.count++;
      group.entityIds.push(entity.id);
    }

    return groups;
  });

  // Update frozen order when tab becomes active
  $effect(() => {
    if (isActive && !wasActive) {
      // Tab just became active - capture current order sorted by count
      const sorted = Array.from(archetypeData().values()).sort((a, b) => b.count - a.count);
      frozenOrder = sorted.map((t) => t.archetypeKey);
    }
    wasActive = isActive;
  });

  // Get territories in frozen order (stable during simulation)
  const archetypeTerritories = $derived(() => {
    const data = archetypeData();

    // If no frozen order yet, sort by count
    if (frozenOrder.length === 0) {
      return Array.from(data.values()).sort((a, b) => b.count - a.count);
    }

    // Use frozen order, appending any new archetypes at the end
    const result: ArchetypeTerritory[] = [];
    const seen = new Set<string>();

    for (const key of frozenOrder) {
      const territory = data.get(key);
      if (territory) {
        result.push(territory);
        seen.add(key);
      }
    }

    // Add any new archetypes that appeared after freeze
    for (const [key, territory] of data) {
      if (!seen.has(key)) {
        result.push(territory);
      }
    }

    return result;
  });

  // Build component registry from all entities
  const componentRegistry = $derived(() => {
    const components = new Map<string, ComponentInfo>();

    for (const entity of world.entities) {
      for (const comp of entity.components) {
        let info = components.get(comp.type_short);
        if (!info) {
          // Extract field names from component data (validate it's an object first)
          const fields = isRecord(comp.data) ? Object.keys(comp.data).slice(0, 5) : [];
          info = {
            name: comp.type_short,
            entityCount: 0,
            fields,
          };
          components.set(comp.type_short, info);
        }
        info.entityCount++;
      }
    }

    // Sort by entity count descending
    return Array.from(components.values()).sort((a, b) => b.entityCount - a.entityCount);
  });

  // Summary stats
  const stats = $derived(() => ({
    totalArchetypes: archetypeTerritories().length,
    totalComponents: componentRegistry().length,
    totalEntities: world.entityCount,
    largestArchetype: archetypeTerritories()[0]?.count ?? 0,
  }));

  // Handle territory click - select archetype and filter Petri Dish
  function selectTerritory(territory: ArchetypeTerritory) {
    const isDeselecting = selectedArchetype === territory.archetypeKey;
    selectedArchetype = isDeselecting ? null : territory.archetypeKey;
    world.setArchetypeFilter(isDeselecting ? null : territory.archetype);
  }

  // View entities in Petri Dish (select first entity of archetype)
  function viewInPetriDish(territory: ArchetypeTerritory) {
    if (territory.entityIds.length > 0) {
      world.selectEntity(territory.entityIds[0]);
      onNavigateToPetriDish?.();
    }
  }
</script>

<div class="space-y-6">
  <!-- Summary Stats -->
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
    <div class="p-4 rounded-lg bg-[var(--color-bg-secondary)]">
      <div class="text-sm text-[var(--color-text-secondary)]">Archetypes</div>
      <div class="text-2xl font-mono text-[var(--color-text-primary)]">{stats().totalArchetypes}</div>
    </div>
    <div class="p-4 rounded-lg bg-[var(--color-bg-secondary)]">
      <div class="text-sm text-[var(--color-text-secondary)]">Components</div>
      <div class="text-2xl font-mono text-[var(--color-text-primary)]">{stats().totalComponents}</div>
    </div>
    <div class="p-4 rounded-lg bg-[var(--color-bg-secondary)]">
      <div class="text-sm text-[var(--color-text-secondary)]">Total Entities</div>
      <div class="text-2xl font-mono text-[var(--color-text-primary)]">{stats().totalEntities}</div>
    </div>
    <div class="p-4 rounded-lg bg-[var(--color-bg-secondary)]">
      <div class="text-sm text-[var(--color-text-secondary)]">Largest Archetype</div>
      <div class="text-2xl font-mono text-[var(--color-text-primary)]">{stats().largestArchetype}</div>
    </div>
  </div>

  <!-- Archetype Territories -->
  <div class="rounded-lg bg-[var(--color-bg-secondary)] overflow-hidden">
    <div class="px-4 py-3 border-b border-[var(--color-bg-tertiary)]">
      <h2 class="font-medium text-[var(--color-text-primary)]">Archetype Territories</h2>
    </div>
    <div class="p-4">
      {#if archetypeTerritories().length === 0}
        <p class="text-[var(--color-text-muted)] text-center py-8">No entities</p>
      {:else}
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {#each archetypeTerritories() as territory (territory.archetypeKey)}
            {@const color = getArchetypeColorCSS(territory.archetype)}
            {@const isSelected = selectedArchetype === territory.archetypeKey}
            <button
              class="text-left p-4 rounded-lg border-2 transition-all
                     {isSelected
                ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)]'
                : 'bg-[var(--color-bg-primary)] border-[var(--color-bg-tertiary)] hover:border-[var(--color-text-muted)]'}"
              onclick={() => selectTerritory(territory)}
            >
              <!-- Archetype name -->
              <div class="flex items-start justify-between mb-2">
                <div class="font-mono text-sm text-[var(--color-text-primary)] break-all">
                  [{territory.archetype.join(", ")}]
                </div>
                <div
                  class="w-3 h-3 rounded-full shrink-0 ml-2"
                  style="background-color: {color}"
                ></div>
              </div>

              <!-- Entity dots visualization -->
              <div class="flex flex-wrap gap-1 my-3 min-h-[24px]">
                {#each Array(Math.min(territory.count, 20)) as _, i (i)}
                  <div
                    class="w-2 h-2 rounded-full opacity-70"
                    style="background-color: {color}"
                  ></div>
                {/each}
                {#if territory.count > 20}
                  <span class="text-xs text-[var(--color-text-muted)]">+{territory.count - 20}</span>
                {/if}
              </div>

              <!-- Count and actions -->
              <div class="flex items-center justify-between mt-2 pt-2 border-t border-[var(--color-bg-tertiary)]">
                <span class="text-sm text-[var(--color-text-secondary)]">
                  {territory.count} {territory.count === 1 ? "entity" : "entities"}
                </span>
<!-- svelte-ignore a11y_no_static_element_interactions -->
                <span
                  class="text-xs text-[var(--color-accent)] hover:underline cursor-pointer"
                  onclick={(e) => {
                    e.stopPropagation();
                    viewInPetriDish(territory);
                  }}
                  onkeydown={(e) => {
                    if (e.key === "Enter") {
                      e.stopPropagation();
                      viewInPetriDish(territory);
                    }
                  }}
                  role="button"
                  tabindex="0"
                >
                  View in Petri Dish
                </span>
              </div>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <!-- Migration Flow (Placeholder) -->
  <div class="rounded-lg bg-[var(--color-bg-secondary)] overflow-hidden">
    <div class="px-4 py-3 border-b border-[var(--color-bg-tertiary)]">
      <h2 class="font-medium text-[var(--color-text-primary)]">Migration Flow</h2>
    </div>
    <div class="p-8 text-center">
      <div class="text-[var(--color-text-muted)]">
        <p>Migration flow visualization not yet available.</p>
        <p class="text-xs mt-2 text-[var(--color-text-muted)]/70">
          Requires tracking archetype changes over time.
        </p>
      </div>
      <!-- Mock flow diagram -->
      <div class="mt-6 flex items-center justify-center gap-2 text-xs text-[var(--color-text-muted)] opacity-30">
        <span class="px-2 py-1 rounded bg-[var(--color-bg-tertiary)]">Archetype A</span>
        <span>→</span>
        <span class="px-2 py-1 rounded bg-[var(--color-bg-tertiary)]">Archetype B</span>
        <span>→</span>
        <span class="px-2 py-1 rounded bg-[var(--color-bg-tertiary)]">Archetype C</span>
      </div>
    </div>
  </div>

  <!-- Component Registry -->
  <div class="rounded-lg bg-[var(--color-bg-secondary)] overflow-hidden">
    <div class="px-4 py-3 border-b border-[var(--color-bg-tertiary)]">
      <h2 class="font-medium text-[var(--color-text-primary)]">Component Registry</h2>
    </div>
    <div class="overflow-x-auto">
      {#if componentRegistry().length === 0}
        <p class="text-[var(--color-text-muted)] text-center py-8">No components registered</p>
      {:else}
        <table class="w-full text-sm">
          <thead class="bg-[var(--color-bg-tertiary)]">
            <tr class="text-left text-[var(--color-text-muted)]">
              <th class="px-4 py-2 font-medium">Component</th>
              <th class="px-4 py-2 font-medium">Entities</th>
              <th class="px-4 py-2 font-medium">Fields</th>
            </tr>
          </thead>
          <tbody>
            {#each componentRegistry() as comp (comp.name)}
              <tr class="border-b border-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-tertiary)]/50">
                <td class="px-4 py-2 font-mono text-[var(--color-accent)]">{comp.name}</td>
                <td class="px-4 py-2 text-[var(--color-text-primary)]">{comp.entityCount}</td>
                <td class="px-4 py-2 text-[var(--color-text-secondary)]">
                  {comp.fields.join(", ")}{comp.fields.length >= 5 ? ", ..." : ""}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  </div>
</div>
