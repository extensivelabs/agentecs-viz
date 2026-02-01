<script lang="ts">
  import { world } from "./world.svelte";
  import type { EntitySnapshot } from "./websocket";

  function formatValue(value: unknown): string {
    if (typeof value === "number") {
      return Number.isInteger(value) ? value.toString() : value.toFixed(2);
    }
    if (typeof value === "string") {
      return value.length > 30 ? value.slice(0, 30) + "..." : value;
    }
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
    if (value === null || value === undefined) {
      return "—";
    }
    return JSON.stringify(value);
  }

  function getHighlightClass(entity: EntitySnapshot): string {
    if (world.isNewEntity(entity.id)) {
      return "animate-highlight-new";
    }
    if (world.isChangedEntity(entity.id)) {
      return "animate-highlight-changed";
    }
    return "";
  }
</script>

<div class="rounded-lg bg-[var(--color-bg-secondary)] overflow-hidden">
  <div class="px-4 py-3 border-b border-[var(--color-bg-tertiary)] flex items-center justify-between">
    <h2 class="font-medium text-[var(--color-text-primary)]">Entities</h2>
    <span class="text-sm text-[var(--color-text-muted)]">{world.entityCount} total</span>
  </div>

  <div class="max-h-[500px] overflow-y-auto">
    {#if world.entities.length === 0}
      <div class="p-8 text-center text-[var(--color-text-muted)]">
        No entities in world
      </div>
    {:else}
      <table class="w-full text-sm">
        <thead class="bg-[var(--color-bg-tertiary)] sticky top-0 z-10">
          <tr>
            <th class="px-4 py-2 text-left text-[var(--color-text-secondary)] font-medium w-20">ID</th>
            <th class="px-4 py-2 text-left text-[var(--color-text-secondary)] font-medium">Archetype</th>
            <th class="px-4 py-2 text-right text-[var(--color-text-secondary)] font-medium w-24">Components</th>
          </tr>
        </thead>
        <tbody>
          {#each world.entities as entity (entity.id)}
            {@const isSelected = world.selectedEntityId === entity.id}
            {@const highlightClass = getHighlightClass(entity)}
            <tr
              class="border-t border-[var(--color-bg-tertiary)] cursor-pointer transition-colors
                     {isSelected ? 'bg-[var(--color-accent)]/20' : 'hover:bg-[var(--color-bg-tertiary)]/50'}
                     {highlightClass}"
              onclick={() => world.selectEntity(isSelected ? null : entity.id)}
            >
              <td class="px-4 py-2 font-mono text-[var(--color-text-primary)]">
                {entity.id}
                {#if world.isNewEntity(entity.id)}
                  <span class="ml-1 text-xs text-[var(--color-success)]">●</span>
                {:else if world.isChangedEntity(entity.id)}
                  <span class="ml-1 text-xs text-[var(--color-warning)]">●</span>
                {/if}
              </td>
              <td class="px-4 py-2">
                <div class="flex flex-wrap gap-1">
                  {#each entity.archetype as comp}
                    <span class="px-1.5 py-0.5 rounded text-xs bg-[var(--color-accent)]/20 text-[var(--color-accent)]">
                      {comp}
                    </span>
                  {/each}
                </div>
              </td>
              <td class="px-4 py-2 text-right text-[var(--color-text-secondary)]">
                {entity.components.length}
              </td>
            </tr>

            <!-- Expanded component details -->
            {#if isSelected}
              <tr class="bg-[var(--color-bg-tertiary)]/30">
                <td colspan="3" class="px-4 py-3">
                  <div class="space-y-3">
                    {#each entity.components as component}
                      <div class="bg-[var(--color-bg-primary)]/50 rounded p-3">
                        <div class="flex items-center gap-2 mb-2">
                          <span class="font-medium text-[var(--color-text-primary)]">
                            {component.type_short}
                          </span>
                          <span class="text-xs text-[var(--color-text-muted)]">
                            {component.type_name}
                          </span>
                        </div>
                        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 text-sm">
                          {#each Object.entries(component.data) as [key, value]}
                            <div class="flex justify-between gap-2 bg-[var(--color-bg-secondary)] rounded px-2 py-1">
                              <span class="text-[var(--color-text-secondary)]">{key}</span>
                              <span class="font-mono text-[var(--color-text-primary)]">{formatValue(value)}</span>
                            </div>
                          {/each}
                        </div>
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

<style>
  @keyframes highlight-new {
    0% {
      background-color: rgba(52, 211, 153, 0.3);
    }
    100% {
      background-color: transparent;
    }
  }

  @keyframes highlight-changed {
    0% {
      background-color: rgba(251, 191, 36, 0.2);
    }
    100% {
      background-color: transparent;
    }
  }

  .animate-highlight-new {
    animation: highlight-new 1s ease-out;
  }

  .animate-highlight-changed {
    animation: highlight-changed 0.5s ease-out;
  }
</style>
