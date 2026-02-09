<script lang="ts">
  import { world } from "./state/world.svelte";
  import { getArchetypeKey, getArchetypeDisplay } from "./utils";
  import { getArchetypeColorCSS } from "./colors";
  import JsonTree from "./JsonTree.svelte";

  let expandedSections = $state<Record<string, boolean>>({});

  let entity = $derived(world.selectedEntity);

  let archetypeKey = $derived(entity ? getArchetypeKey(entity.archetype) : "");
  let archetypeLabel = $derived.by(() => {
    if (!entity) return "";
    const cfg = world.archetypeConfigMap.get(archetypeKey);
    return cfg?.label ?? getArchetypeDisplay(entity.archetype);
  });
  let archetypeColor = $derived(entity ? getArchetypeColorCSS(entity.archetype) : "#888");

  let sortedComponents = $derived(
    entity ? [...entity.components].sort((a, b) => a.type_short.localeCompare(b.type_short)) : [],
  );

  let statusFields = $derived(world.config?.field_hints?.status_fields ?? []);
  let errorFields = $derived(world.config?.field_hints?.error_fields ?? []);

  function isSectionExpanded(typeShort: string): boolean {
    return expandedSections[typeShort] ?? true;
  }

  function toggleSection(typeShort: string): void {
    expandedSections[typeShort] = !isSectionExpanded(typeShort);
  }

  function fieldCount(data: Record<string, unknown>): number {
    return Object.keys(data).length;
  }

  function close(): void {
    world.selectEntity(null);
  }
</script>

<aside
  class="flex h-full w-[360px] shrink-0 flex-col border-l border-bg-tertiary bg-bg-secondary"
  data-testid="inspector-panel"
>
  {#if entity}
    <div class="flex items-center gap-2 border-b border-bg-tertiary px-4 py-3">
      <span
        class="inline-block h-3 w-3 shrink-0 rounded-full"
        style:background-color={archetypeColor}
      ></span>
      <div class="min-w-0 flex-1">
        <div class="text-sm font-medium text-text-primary">Entity #{entity.id}</div>
        <div class="truncate text-xs text-text-muted">{archetypeLabel}</div>
      </div>
      <button
        class="shrink-0 rounded p-1 text-text-muted hover:bg-bg-tertiary hover:text-text-primary"
        onclick={close}
        aria-label="Close inspector"
        data-testid="inspector-close"
      >
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>

    <div class="flex-1 overflow-y-auto">
      <div class="border-b border-bg-tertiary px-4 py-2 text-xs text-text-muted">
        {sortedComponents.length} {sortedComponents.length === 1 ? "component" : "components"}
      </div>

      {#each sortedComponents as comp}
        <div class="border-b border-bg-tertiary" data-testid="component-section">
          <button
            class="flex w-full items-center gap-2 px-4 py-2 text-left text-xs hover:bg-bg-tertiary/50"
            onclick={() => toggleSection(comp.type_short)}
            data-testid="component-toggle"
          >
            <span class="inline-block w-3 text-center text-text-muted">
              {isSectionExpanded(comp.type_short) ? "\u25BE" : "\u25B8"}
            </span>
            <span class="font-medium text-text-primary">{comp.type_short}</span>
            <span class="text-text-muted">({fieldCount(comp.data)} {fieldCount(comp.data) === 1 ? "field" : "fields"})</span>
          </button>
          {#if isSectionExpanded(comp.type_short)}
            <div class="px-4 pb-2">
              <JsonTree data={comp.data} {statusFields} {errorFields} />
            </div>
          {/if}
        </div>
      {/each}

      <div class="px-4 py-3" data-testid="systems-placeholder">
        <div class="text-xs text-text-muted/50">Systems (Phase 2)</div>
      </div>
    </div>
  {:else}
    <div class="flex flex-1 items-center justify-center text-xs text-text-muted" data-testid="inspector-empty">
      Select an entity to inspect
    </div>
  {/if}
</aside>
