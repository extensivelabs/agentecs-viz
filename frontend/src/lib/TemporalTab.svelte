<script lang="ts">
  import { onMount } from "svelte";
  import JsonTree from "./JsonTree.svelte";
  import type { ComponentChanges, EntityChangeType, WorldDiffEntry } from "./diff";
  import { world } from "./state/world.svelte";
  import { archetypeKey, temporal } from "./state/temporal.svelte";

  type VisibleComponent = {
    type: string;
    data: Record<string, unknown>;
    change?: ComponentChanges;
  };

  const CHANGE_TYPE_LABELS: Record<EntityChangeType, string> = {
    spawned: "Spawned",
    destroyed: "Destroyed",
    modified: "Modified",
  };

  const CHANGE_TYPE_BADGES: Record<EntityChangeType, string> = {
    spawned: "bg-success/15 text-success",
    destroyed: "bg-error/15 text-error",
    modified: "bg-warning/15 text-warning",
  };

  const SUMMARY_COLORS: Record<EntityChangeType, string> = {
    spawned: "rgb(34 197 94)",
    destroyed: "rgb(239 68 68)",
    modified: "rgb(245 158 11)",
  };

  onMount(() => {
    temporal.reset();
    temporal.initDefaults();
  });

  let statusFields = $derived(world.config?.field_hints?.status_fields ?? []);
  let errorFields = $derived(world.config?.field_hints?.error_fields ?? []);
  let summarySegments = $derived.by(() => {
    if (!temporal.worldDiff) return [];

    const total = temporal.worldDiff.summary.spawnedCount
      + temporal.worldDiff.summary.destroyedCount
      + temporal.worldDiff.summary.modifiedCount;
    if (total === 0) return [];

    const counts = [
      { key: "spawned" as const, count: temporal.worldDiff.summary.spawnedCount },
      { key: "destroyed" as const, count: temporal.worldDiff.summary.destroyedCount },
      { key: "modified" as const, count: temporal.worldDiff.summary.modifiedCount },
    ].filter((segment) => segment.count > 0);

    let offset = 0;
    return counts.map((segment) => {
      const width = (segment.count / total) * 100;
      const value = {
        ...segment,
        offset,
        width,
      };
      offset += width;
      return value;
    });
  });

  function parseTick(value: string): number {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 0;
    return parsed;
  }

  function parseThreshold(value: string): number {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return parsed;
  }

  function componentChangesByType(entry: WorldDiffEntry): Map<string, ComponentChanges> {
    return new Map(entry.components.map((component: ComponentChanges) => [component.componentType, component]));
  }

  function visibleComponents(entry: WorldDiffEntry): { type: string; data: Record<string, unknown>; change: ComponentChanges }[] {
    const changes = componentChangesByType(entry);
    return entry.entity.components
      .map((component): VisibleComponent => ({
        type: component.type_short,
        data: component.data,
        change: changes.get(component.type_short),
      }))
      .filter(
        (component: VisibleComponent): component is { type: string; data: Record<string, unknown>; change: ComponentChanges } => Boolean(component.change),
      )
      .filter((component: { type: string; data: Record<string, unknown>; change: ComponentChanges }) => component.change.status !== "removed");
  }

  function removedComponents(entry: WorldDiffEntry): ComponentChanges[] {
    return entry.components.filter((component: ComponentChanges) => component.status === "removed");
  }

  function archetypeLabel(entry: WorldDiffEntry): string {
    const key = archetypeKey(entry.archetype);
    return world.archetypeConfigMap.get(key)?.label ?? key;
  }

  function changeTypeLabel(changeType: string): string {
    return CHANGE_TYPE_LABELS[changeType as EntityChangeType] ?? changeType;
  }

  function changeTypeBadge(changeType: string): string {
    return CHANGE_TYPE_BADGES[changeType as EntityChangeType] ?? "bg-bg-tertiary text-text-secondary";
  }

  function selectedArchetype(): string {
    return temporal.filters.archetypes[0] ?? "";
  }

  function selectedComponent(): string {
    return temporal.filters.components[0] ?? "";
  }
</script>

<div class="flex h-full flex-col" data-testid="temporal-tab">
  {#if !world.supportsHistory}
    <div class="flex h-full items-center justify-center text-base text-text-muted" data-testid="temporal-no-history">
      History is not available for this session
    </div>
  {:else}
    <div class="border-b border-bg-tertiary bg-bg-secondary/70 px-4 py-3">
      <div class="flex flex-wrap items-end gap-3">
        <label class="flex flex-col gap-1 text-sm text-text-secondary" for="temporal-t1">
          <span>T1</span>
          <input
            id="temporal-t1"
            class="w-28 rounded border border-bg-tertiary bg-bg-primary px-2 py-1 text-text-primary outline-none focus:border-accent"
            type="number"
            min={world.minTick}
            max={world.maxTick}
            value={temporal.t1}
            oninput={(event) => (temporal.t1 = parseTick((event.currentTarget as HTMLInputElement).value))}
            data-testid="temporal-t1"
          />
        </label>

        <label class="flex flex-col gap-1 text-sm text-text-secondary" for="temporal-t2">
          <span>T2</span>
          <input
            id="temporal-t2"
            class="w-28 rounded border border-bg-tertiary bg-bg-primary px-2 py-1 text-text-primary outline-none focus:border-accent"
            type="number"
            min={world.minTick}
            max={world.maxTick}
            value={temporal.t2}
            oninput={(event) => (temporal.t2 = parseTick((event.currentTarget as HTMLInputElement).value))}
            data-testid="temporal-t2"
          />
        </label>

        <button
          class="rounded bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
          onclick={() => temporal.fetchSnapshots()}
          disabled={temporal.loading}
          data-testid="temporal-compare"
        >
          {#if temporal.loading}Comparing...{:else}Compare{/if}
        </button>

        <div class="pb-2 text-sm text-text-muted">
          Range {world.minTick} - {world.maxTick}
        </div>
      </div>

      {#if temporal.error}
        <div class="mt-3 rounded border border-error/30 bg-error/10 px-3 py-2 text-sm text-error" data-testid="temporal-error">
          {temporal.error}
        </div>
      {/if}
    </div>

    {#if !temporal.hasComparison}
      <div class="flex flex-1 items-center justify-center text-base text-text-muted" data-testid="temporal-empty">
        Select two ticks and click Compare
      </div>
    {:else if temporal.worldDiff && temporal.worldDiff.entries.length === 0}
      <div class="flex flex-1 items-center justify-center text-base text-text-muted" data-testid="temporal-no-changes">
        No changes between tick {temporal.worldDiff.t1} and tick {temporal.worldDiff.t2}
      </div>
    {:else if temporal.worldDiff}
      <div class="border-b border-bg-tertiary px-4 py-3" data-testid="temporal-summary">
        <div class="text-sm text-text-secondary">
          <span class="font-medium text-success">{temporal.worldDiff.summary.spawnedCount}</span>
          <span> spawned</span>
          <span class="mx-2 text-text-muted/60">|</span>
          <span class="font-medium text-error">{temporal.worldDiff.summary.destroyedCount}</span>
          <span> destroyed</span>
          <span class="mx-2 text-text-muted/60">|</span>
          <span class="font-medium text-warning">{temporal.worldDiff.summary.modifiedCount}</span>
          <span> modified</span>
          <span class="mx-2 text-text-muted/60">|</span>
          <span>{temporal.worldDiff.summary.totalFieldChanges} field changes</span>
        </div>

        <svg class="mt-3 h-3 w-full" viewBox="0 0 100 12" preserveAspectRatio="none" aria-label="Temporal diff summary">
          <rect x="0" y="0" width="100" height="12" rx="6" fill="rgb(51 65 85)" />
          {#each summarySegments as segment (segment.key)}
            <rect
              x={segment.offset}
              y="0"
              width={segment.width}
              height="12"
              fill={SUMMARY_COLORS[segment.key]}
            />
          {/each}
        </svg>
      </div>

      <div class="border-b border-bg-tertiary bg-bg-secondary/40 px-4 py-3">
        <div class="flex flex-wrap items-end gap-3">
          <label class="flex flex-col gap-1 text-sm text-text-secondary" for="temporal-archetype-filter">
            <span>Archetype</span>
            <select
              id="temporal-archetype-filter"
              class="min-w-44 rounded border border-bg-tertiary bg-bg-primary px-2 py-1 text-text-primary outline-none focus:border-accent"
              value={selectedArchetype()}
              onchange={(event) => temporal.setArchetypeFilter((event.currentTarget as HTMLSelectElement).value)}
              data-testid="temporal-archetype-filter"
            >
              <option value="">All archetypes</option>
              {#each temporal.availableArchetypes as archetype (archetype)}
                <option value={archetype}>{world.archetypeConfigMap.get(archetype)?.label ?? archetype}</option>
              {/each}
            </select>
          </label>

          <label class="flex flex-col gap-1 text-sm text-text-secondary" for="temporal-component-filter">
            <span>Component</span>
            <select
              id="temporal-component-filter"
              class="min-w-40 rounded border border-bg-tertiary bg-bg-primary px-2 py-1 text-text-primary outline-none focus:border-accent"
              value={selectedComponent()}
              onchange={(event) => temporal.setComponentFilter((event.currentTarget as HTMLSelectElement).value)}
              data-testid="temporal-component-filter"
            >
              <option value="">All components</option>
              {#each temporal.availableComponents as component (component)}
                <option value={component}>{component}</option>
              {/each}
            </select>
          </label>

          <label class="flex flex-col gap-1 text-sm text-text-secondary" for="temporal-min-field-changes">
            <span>Min field changes</span>
            <input
              id="temporal-min-field-changes"
              class="w-32 rounded border border-bg-tertiary bg-bg-primary px-2 py-1 text-text-primary outline-none focus:border-accent"
              type="number"
              min="0"
              value={temporal.filters.minFieldChanges}
              oninput={(event) => temporal.setMinFieldChanges(parseThreshold((event.currentTarget as HTMLInputElement).value))}
              data-testid="temporal-min-field-changes"
            />
          </label>

          <button
            class="rounded border border-bg-tertiary px-3 py-2 text-sm text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
            onclick={() => temporal.resetFilters()}
            data-testid="temporal-reset-filters"
          >
            Reset filters
          </button>
        </div>

        <div class="mt-3 flex flex-wrap gap-4 text-sm text-text-secondary" data-testid="temporal-change-type-filters">
          {#each Object.entries(CHANGE_TYPE_LABELS) as [changeType, label] (changeType)}
            <label class="flex items-center gap-2">
              <input
                type="checkbox"
                checked={temporal.filters.changeTypes.includes(changeType as EntityChangeType)}
                onchange={() => temporal.toggleChangeType(changeType as EntityChangeType)}
              />
              <span>{label}</span>
            </label>
          {/each}
        </div>
      </div>

      {#if temporal.filteredEntries.length === 0}
        <div class="flex flex-1 items-center justify-center text-base text-text-muted" data-testid="temporal-no-filtered-results">
          No entities match the current filters
        </div>
      {:else}
        <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3" data-testid="temporal-results">
          <div class="space-y-3">
            {#each temporal.pagedEntries as entry (entry.changeType + ':' + entry.entityId)}
              <div class="rounded-lg border border-bg-tertiary bg-bg-secondary/30" data-testid="temporal-entity-row">
                <button
                  class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-bg-tertiary/30"
                  onclick={() => temporal.toggleEntity(entry.entityId)}
                  aria-expanded={temporal.isEntityExpanded(entry.entityId)}
                  data-testid={`temporal-entity-toggle-${entry.entityId}`}
                >
                  <span class="inline-block w-3 text-center text-text-muted">
                    {temporal.isEntityExpanded(entry.entityId) ? "\u25BE" : "\u25B8"}
                  </span>
                  <span class="font-medium text-text-primary">Entity {entry.entityId}</span>
                  <span class={`rounded px-2 py-0.5 text-xs font-semibold ${changeTypeBadge(entry.changeType)}`}>
                    {changeTypeLabel(entry.changeType)}
                  </span>
                  <span class="truncate text-sm text-text-muted">{archetypeLabel(entry)}</span>
                  <span class="ml-auto text-sm text-text-secondary">{entry.totalChanges} changes</span>
                </button>

                {#if temporal.isEntityExpanded(entry.entityId)}
                  <div class="border-t border-bg-tertiary px-4 py-3">
                    <div class="mb-3 text-xs uppercase tracking-wide text-text-muted">Component diff</div>

                    {#each visibleComponents(entry) as component (component.type)}
                      <div class="mb-3 rounded border border-bg-tertiary/70 bg-bg-primary/40 p-3" data-testid="temporal-component-diff">
                        <div class="mb-2 flex items-center gap-2">
                          <span class="font-medium text-text-primary">{component.type}</span>
                          <span class="rounded bg-warning/15 px-1.5 py-0.5 text-xs text-warning">
                            {component.change.status === "added" ? "NEW" : component.change.fields.length}
                          </span>
                        </div>
                        <JsonTree data={component.data} {statusFields} {errorFields} diff={component.change.fields} pathPrefix={[]} />
                      </div>
                    {/each}

                    {#each removedComponents(entry) as component (component.componentType)}
                      <div class="mb-3 rounded border border-error/20 bg-error/5 p-3" data-testid="temporal-component-removed">
                        <div class="mb-2 flex items-center gap-2">
                          <span class="font-medium text-error">{component.componentType}</span>
                          <span class="rounded bg-error/15 px-1.5 py-0.5 text-xs text-error">DEL</span>
                        </div>
                        <JsonTree data={{}} {statusFields} {errorFields} diff={component.fields} pathPrefix={[]} />
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </div>

        <div class="flex items-center justify-between border-t border-bg-tertiary px-4 py-3 text-sm text-text-secondary">
          <span data-testid="temporal-pagination">Page {temporal.page + 1} of {temporal.totalPages}</span>
          <div class="flex items-center gap-2">
            <button
              class="rounded border border-bg-tertiary px-3 py-1.5 hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50"
              onclick={() => temporal.prevPage()}
              disabled={temporal.page === 0}
              data-testid="temporal-prev-page"
            >
              Previous
            </button>
            <button
              class="rounded border border-bg-tertiary px-3 py-1.5 hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50"
              onclick={() => temporal.nextPage()}
              disabled={temporal.page >= temporal.totalPages - 1}
              data-testid="temporal-next-page"
            >
              Next
            </button>
          </div>
        </div>
      {/if}
    {/if}
  {/if}
</div>
