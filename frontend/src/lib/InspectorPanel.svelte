<script lang="ts">
  import { world } from "./state/world.svelte";
  import { getArchetypeKey, getArchetypeDisplay, severityLabel, severityClasses } from "./utils";
  import { getArchetypeColorCSS } from "./colors";
  import JsonTree from "./JsonTree.svelte";
  import type { ComponentChanges } from "./diff";

  let entitySpanCount = $derived(world.selectedEntitySpans.length);
  let entityTokenUsage = $derived(world.selectedEntityTokenUsage);
  let entityModelTokenUsage = $derived(world.selectedEntityModelTokenUsage);

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

  let removedComponents = $derived.by(() => {
    if (!activeDiff) return [];
    const currentTypes = new Set(sortedComponents.map((c) => c.type_short));
    return activeDiff.components
      .filter((c) => c.status === "removed" && !currentTypes.has(c.componentType))
      .sort((a, b) => a.componentType.localeCompare(b.componentType));
  });

  let statusFields = $derived(world.config?.field_hints?.status_fields ?? []);
  let errorFields = $derived(world.config?.field_hints?.error_fields ?? []);

  let entityErrors = $derived.by(() => {
    if (!entity) return [];
    return world.visibleErrors
      .filter((e) => e.entity_id === entity.id)
      .sort((a, b) => b.tick - a.tick);
  });

  let diff = $derived(world.selectedEntityDiff);
  let pinnedDiff = $derived(world.selectedEntityPinnedDiff);
  let activeDiff = $derived(pinnedDiff ?? diff);
  let previousTick = $derived(world.previousSnapshot?.tick ?? 0);

  function componentChanges(typeShort: string): ComponentChanges | undefined {
    return activeDiff?.components.find((c) => c.componentType === typeShort);
  }

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

  function formatTokens(count: number): string {
    return count.toLocaleString();
  }

  function formatCost(costUsd: number): string {
    if (costUsd >= 1) return `$${costUsd.toFixed(2)}`;
    return `$${costUsd.toFixed(4)}`;
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
      {#if entityErrors.length > 0}
        <div class="border-b border-bg-tertiary px-4 py-2" data-testid="inspector-errors">
          <div class="mb-1 text-xs font-medium text-error">
            {entityErrors.length} {entityErrors.length === 1 ? "error" : "errors"}
          </div>
          {#each entityErrors as error, i (error.tick + ':' + error.message + ':' + i)}
            <div
              class="flex items-center gap-1.5 py-0.5 text-xs"
              class:opacity-50={error.tick < world.tick}
            >
              <span class="shrink-0 rounded px-1 py-0.5 text-[10px] font-medium {severityClasses(error.severity)}">
                {severityLabel(error.severity)}
              </span>
              <span class="font-mono text-text-muted">T{error.tick}</span>
              <span class="min-w-0 truncate text-text-primary">{error.message}</span>
            </div>
          {/each}
        </div>
      {/if}

      {#if activeDiff && activeDiff.totalChanges > 0}
        <div class="border-b border-bg-tertiary px-4 py-2" data-testid="diff-summary">
          <span class="rounded bg-warning/20 px-1.5 py-0.5 text-xs text-warning">
            {activeDiff.totalChanges} {activeDiff.totalChanges === 1 ? "change" : "changes"}
          </span>
          <span class="ml-1 text-xs text-text-muted">
            {#if world.pinnedTick !== null}
              vs pinned tick {world.pinnedTick}
            {:else}
              since tick {previousTick}
            {/if}
          </span>
        </div>
      {/if}

      {#if world.supportsHistory}
        <div class="border-b border-bg-tertiary px-4 py-2 text-xs" data-testid="pin-compare">
          {#if world.pinnedTick !== null}
            <span class="text-text-muted">Comparing to tick {world.pinnedTick}</span>
            <button
              class="ml-2 text-text-secondary hover:text-text-primary"
              onclick={() => world.clearPinnedState()}
              data-testid="clear-pin-btn"
            >Clear</button>
          {:else}
            <button
              class="text-text-secondary hover:text-text-primary"
              onclick={() => world.pinCurrentState()}
              data-testid="pin-state-btn"
            >Pin current state</button>
          {/if}
        </div>
      {/if}

      <div class="border-b border-bg-tertiary px-4 py-2 text-xs text-text-muted">
        {sortedComponents.length} {sortedComponents.length === 1 ? "component" : "components"}
      </div>

      {#each sortedComponents as comp (entity.id + ':' + comp.type_short)}
        {@const compChanges = componentChanges(comp.type_short)}
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
            {#if compChanges}
              <span class="ml-auto rounded bg-warning/20 px-1 text-warning" data-testid="component-diff-badge">
                {#if compChanges.status === "added"}NEW{:else}{compChanges.fields.length}{/if}
              </span>
            {/if}
          </button>
          {#if isSectionExpanded(comp.type_short)}
            <div class="px-4 pb-2">
              <JsonTree data={comp.data} {statusFields} {errorFields}
                diff={compChanges?.fields} pathPrefix={[]} />
            </div>
          {/if}
        </div>
      {/each}

      {#each removedComponents as removed (entity.id + ':removed:' + removed.componentType)}
        <div class="border-b border-bg-tertiary bg-error/10" data-testid="component-section">
          <div class="flex w-full items-center gap-2 px-4 py-2 text-left text-xs">
            <span class="inline-block w-3"></span>
            <span class="font-medium text-error/70">{removed.componentType}</span>
            <span class="ml-auto rounded bg-error/20 px-1 text-error" data-testid="component-diff-badge">DEL</span>
          </div>
        </div>
      {/each}

      <div class="px-4 py-3" data-testid="traces-section">
        <div class="flex items-center gap-2 text-xs">
          <span class="text-xs text-text-muted">
            {entitySpanCount} {entitySpanCount === 1 ? "span" : "spans"}
          </span>
        </div>
        <div class="mt-1 text-xs text-text-muted" data-testid="entity-token-summary">
          <span class="text-text-secondary">{formatTokens(entityTokenUsage.total)}</span>
          <span> tokens</span>
          <span class="mx-1 text-text-muted/60">|</span>
          <span class="text-text-secondary">{formatCost(entityTokenUsage.costUsd)}</span>
          <span> cost</span>
        </div>
        {#if entityModelTokenUsage.length > 0}
          <div class="mt-2 space-y-1" data-testid="entity-model-breakdown">
            {#each entityModelTokenUsage as modelUsage (modelUsage.model)}
              <div class="flex items-center justify-between text-xs">
                <span class="truncate text-text-secondary">{modelUsage.model}</span>
                <span class="font-mono text-text-muted">
                  {formatTokens(modelUsage.total)} / {formatCost(modelUsage.costUsd)}
                </span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <div class="flex flex-1 items-center justify-center text-xs text-text-muted" data-testid="inspector-empty">
      Select an entity to inspect
    </div>
  {/if}
</aside>
