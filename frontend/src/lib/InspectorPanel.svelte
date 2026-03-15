<script lang="ts">
  import { untrack } from "svelte";
  import { archetypes } from "./state/archetypes.svelte";
  import { world } from "./state/world.svelte";
  import {
    formatCostUsd,
    formatTokens,
    getArchetypeKey,
    getArchetypeDisplay,
    severityLabel,
    severityClasses,
  } from "./utils";
  import { resolveArchetypeColorCSS } from "./colors";
  import DistributionPanel from "./DistributionPanel.svelte";
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
  let archetypeColor = $derived(
    entity
      ? resolveArchetypeColorCSS(entity.archetype, world.archetypeConfigMap, world.config?.color_palette)
      : "#888",
  );

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
  let loopInfo = $derived(world.selectedEntityLoopInfo);
  let previousTick = $derived(world.previousSnapshot?.tick ?? 0);
  let archetypeHistory = $derived(archetypes.selectedEntityHistory);
  let archetypeHistoryError = $derived(archetypes.selectedEntityHistoryError);
  let archetypeHistoryLoading = $derived(entity ? archetypes.loadingEntityId === entity.id : false);
  let hasArchetypeTransitions = $derived(archetypeHistory.length > 1);

  $effect(() => {
    const entityId = entity?.id;
    const currentTick = world.tick;
    const minTick = world.minTick;
    const historyConfig = world.config;

    if (entityId == null || !historyConfig || !world.supportsHistory || currentTick < minTick) return;

    untrack(() => {
      void archetypes.ensureEntityHistory(entityId);
    });
  });

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

  function formatFrozenFields(fields: string[]): string {
    const preview = fields.slice(0, 5).join(", ");
    if (fields.length <= 5) return preview;
    return `${preview}, +${fields.length - 5} more`;
  }

  function historyColor(archetype: string[]): string {
    return resolveArchetypeColorCSS(archetype, world.archetypeConfigMap, world.config?.color_palette);
  }

  function close(): void {
    world.selectEntity(null);
  }

</script>

<aside
  class="flex h-full w-1/4 min-w-[280px] max-w-[420px] shrink-0 flex-col border-l border-bg-tertiary bg-bg-secondary"
  data-testid="inspector-panel"
>
  {#if entity}
    <div class="flex items-center gap-2 border-b border-bg-tertiary px-4 py-3">
      <span
        class="inline-block h-3 w-3 shrink-0 rounded-full"
        style:background-color={archetypeColor}
      ></span>
      <div class="min-w-0 flex-1">
        <div class="text-base font-medium text-text-primary">Entity #{entity.id}</div>
        <div class="truncate text-sm text-text-muted">{archetypeLabel}</div>
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
          <div class="mb-1 text-sm font-medium text-error">
            {entityErrors.length} {entityErrors.length === 1 ? "error" : "errors"}
          </div>
          {#each entityErrors as error, i (error.tick + ':' + error.message + ':' + i)}
            <div
              class="flex items-center gap-1.5 py-0.5 text-sm"
              class:opacity-50={error.tick < world.tick}
            >
              <span class="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium {severityClasses(error.severity)}">
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
          <span class="rounded bg-warning/20 px-2 py-0.5 text-sm text-warning">
            {activeDiff.totalChanges} {activeDiff.totalChanges === 1 ? "change" : "changes"}
          </span>
          <span class="ml-1 text-sm text-text-muted">
            {#if world.pinnedTick !== null}
              vs pinned tick {world.pinnedTick}
            {:else}
              since tick {previousTick}
            {/if}
          </span>
        </div>
      {/if}

      {#if loopInfo}
        <div class="border-b border-bg-tertiary px-4 py-2" data-testid="loop-status">
          <div class="mb-1 flex items-center gap-2 text-sm">
            <span
              class="rounded px-2 py-0.5 font-medium"
              style="background-color: rgba(168, 85, 247, 0.2); color: #c084fc;"
            >
              Loop detected
            </span>
            <span class="text-text-muted">cycle length {loopInfo.cycleLength}</span>
          </div>
          <div class="text-sm text-text-muted">
            unchanged for {loopInfo.unchangedTicks} {loopInfo.unchangedTicks === 1 ? "tick" : "ticks"}
            since tick {loopInfo.unchangedSinceTick}
          </div>
          <div class="mt-1 text-sm text-text-muted">
            {loopInfo.frozenFields.length} frozen {loopInfo.frozenFields.length === 1 ? "field" : "fields"}
            {#if loopInfo.frozenFields.length > 0}
              <span class="font-mono text-text-secondary">: {formatFrozenFields(loopInfo.frozenFields)}</span>
            {/if}
          </div>
          <label class="mt-1 flex items-center gap-1.5 text-sm text-text-muted">
            <input
              type="checkbox"
              class="accent-purple-400"
              checked={world.autoPauseOnLoop}
              onchange={() => world.toggleAutoPauseOnLoop()}
              data-testid="auto-pause-loop-toggle"
            />
            Auto-pause on loop
          </label>
        </div>
      {/if}

      {#if world.supportsHistory}
        <div class="border-b border-bg-tertiary px-4 py-2 text-sm" data-testid="pin-compare">
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

      {#if world.supportsHistory}
        <div class="border-b border-bg-tertiary px-4 py-2" data-testid="archetype-history">
          <div class="mb-1 text-sm font-medium text-text-secondary">Archetype History</div>

          {#if archetypeHistoryLoading}
            <div class="text-sm text-text-muted" data-testid="archetype-history-loading">
              Loading archetype history...
            </div>
          {:else if archetypeHistoryError}
            <div class="text-sm text-error" data-testid="archetype-history-error">
              {archetypeHistoryError}
            </div>
          {:else if !hasArchetypeTransitions}
            <div class="text-sm text-text-muted" data-testid="archetype-history-empty">
              No archetype changes through T{world.tick}
            </div>
            {#if archetypeHistory.length > 0}
              <div class="mt-1 text-sm text-text-muted">
                Spawned as <span class="text-text-secondary">{archetypeHistory[0].label}</span>
                at T{archetypeHistory[0].tick}
              </div>
            {/if}
          {:else}
            <div class="space-y-1" data-testid="archetype-history-list">
              {#each archetypeHistory as entry (entry.tick + ':' + entry.kind + ':' + entry.key)}
                <div class="flex items-center gap-2 text-sm">
                  <span class="font-mono text-text-muted">T{entry.tick}</span>
                  <span
                    class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style:background-color={historyColor(entry.archetype)}
                  ></span>
                  <span class="rounded px-1.5 py-0.5 text-xs text-text-secondary bg-bg-tertiary">
                    {entry.kind === "spawned" ? "SPAWN" : "SHIFT"}
                  </span>
                  <span class="truncate text-text-primary">{entry.label}</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <div class="border-b border-bg-tertiary px-4 py-2 text-sm text-text-muted">
        {sortedComponents.length} {sortedComponents.length === 1 ? "component" : "components"}
      </div>

      {#each sortedComponents as comp (entity.id + ':' + comp.type_short)}
        {@const compChanges = componentChanges(comp.type_short)}
        <div class="border-b border-bg-tertiary" data-testid="component-section">
          <button
            class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-bg-tertiary/50"
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
          <div class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm">
            <span class="inline-block w-3"></span>
            <span class="font-medium text-error/70">{removed.componentType}</span>
            <span class="ml-auto rounded bg-error/20 px-1 text-error" data-testid="component-diff-badge">DEL</span>
          </div>
        </div>
      {/each}

      <div class="px-4 py-3" data-testid="traces-section">
        <div class="flex items-center gap-2 text-sm">
          <span class="text-sm text-text-muted">
            {entitySpanCount} {entitySpanCount === 1 ? "span" : "spans"}
          </span>
        </div>
        <div class="mt-1 text-sm text-text-muted" data-testid="entity-token-summary">
          <span class="text-text-secondary">{formatTokens(entityTokenUsage.total)}</span>
          <span> tokens</span>
          <span class="mx-1 text-text-muted/60">|</span>
          <span class="text-text-secondary">{formatCostUsd(entityTokenUsage.costUsd)}</span>
          <span> cost</span>
        </div>
        {#if entityModelTokenUsage.length > 0}
          <div class="mt-2 space-y-1" data-testid="entity-model-breakdown">
            {#each entityModelTokenUsage as modelUsage (modelUsage.model)}
              <div class="flex items-center justify-between text-sm">
                <span class="truncate text-text-secondary">{modelUsage.model}</span>
                <span class="font-mono text-text-muted">
                  {formatTokens(modelUsage.total)} / {formatCostUsd(modelUsage.costUsd)}
                </span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <DistributionPanel />
  {/if}
</aside>
