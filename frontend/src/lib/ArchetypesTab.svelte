<script lang="ts">
  import { archetypes } from "./state/archetypes.svelte";
  import { world } from "./state/world.svelte";

  interface Props {
    onOpenEntities?: () => void;
  }

  let { onOpenEntities = () => {} }: Props = $props();

  let activeArchetypeKey = $derived.by(() =>
    (world.activeQuery?.clauses ?? []).find((clause) => clause.type === "archetype_eq")?.component ?? "",
  );

  function selectArchetype(archetype: string[]): void {
    world.applyArchetypeFilter(archetype);
    onOpenEntities();
  }

  function formatPercentage(percentage: number): string {
    return `${percentage.toFixed(1).replace(/\.0$/, "")}%`;
  }

  function componentList(archetype: string[]): string {
    return archetype.length > 0 ? archetype.join(", ") : "(empty)";
  }

  function rowClasses(isActive: boolean): string {
    if (isActive) {
      return "border-accent bg-accent/10";
    }

    return "border-bg-tertiary bg-bg-secondary/30 hover:bg-bg-tertiary/40";
  }
</script>

<div class="flex h-full flex-col" data-testid="archetypes-tab">
  <div class="border-b border-bg-tertiary bg-bg-secondary/50 px-4 py-3">
    <div class="flex flex-wrap items-center gap-3">
      <div>
        <div class="text-base font-medium text-text-primary">Archetype Composition</div>
        <div class="text-sm text-text-muted">Current snapshot at T{world.tick}</div>
      </div>
      <div class="ml-auto flex items-center gap-2 text-sm text-text-secondary">
        <span>{archetypes.populationRows.length} archetypes</span>
        <span class="text-text-muted/60">|</span>
        <span>{world.entityCount} entities</span>
      </div>
    </div>
    <div class="mt-2 text-sm text-text-muted">
      Click a row to apply an exact archetype filter and jump to the Entities tab.
    </div>
  </div>

  {#if archetypes.populationRows.length === 0}
    <div class="flex flex-1 items-center justify-center text-base text-text-muted" data-testid="archetypes-empty">
      No archetypes at the current tick
    </div>
  {:else}
    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      <div class="space-y-3">
        {#each archetypes.populationRows as row (row.key)}
          <button
            class={`block w-full rounded-xl border px-4 py-3 text-left transition-colors ${rowClasses(row.key === activeArchetypeKey)}`}
            onclick={() => selectArchetype(row.archetype)}
            data-testid="archetype-row"
          >
            <div class="flex items-center gap-3">
              <span
                class="inline-block h-3.5 w-3.5 shrink-0 rounded-full"
                style:background-color={row.color}
              ></span>
              <div class="min-w-0 flex-1">
                <div class="truncate text-base font-medium text-text-primary">{row.label}</div>
                <div class="truncate text-sm text-text-muted">{componentList(row.archetype)}</div>
              </div>
              <div class="text-right text-sm">
                <div class="font-medium text-text-primary">
                  {row.entityCount} {row.entityCount === 1 ? "entity" : "entities"}
                </div>
                <div class="text-text-muted">{formatPercentage(row.percentage)}</div>
              </div>
            </div>

            <div class="mt-3 h-2 overflow-hidden rounded-full bg-bg-tertiary">
              <div
                class="h-full rounded-full"
                style:width={`${Math.max(row.percentage, 2)}%`}
                style:background-color={row.color}
              ></div>
            </div>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>
