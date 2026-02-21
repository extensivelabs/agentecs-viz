<script lang="ts">
  import { world } from "./state/world.svelte";
  import { severityLabel, severityClasses } from "./utils";
  import type { ErrorEventMessage } from "./types";

  let sortedErrors = $derived(
    [...world.visibleErrors].sort((a, b) => b.tick - a.tick),
  );

  function isPast(error: ErrorEventMessage): boolean {
    return error.tick < world.tick;
  }
</script>

{#if world.errorPanelOpen}
  <div
    class="border-b border-bg-tertiary bg-bg-secondary"
    data-testid="error-panel"
  >
    <div class="flex items-center gap-2 px-4 py-2">
      <span class="text-sm font-medium text-error">
        {world.visibleErrorCount} {world.visibleErrorCount === 1 ? "error" : "errors"}
      </span>
      <button
        class="ml-auto text-sm text-text-muted hover:text-text-secondary"
        onclick={() => world.toggleErrorPanel()}
        data-testid="error-panel-close"
      >
        close
      </button>
    </div>

    <div class="max-h-48 overflow-y-auto">
      {#if sortedErrors.length === 0}
        <div class="px-4 py-3 text-sm text-text-muted" data-testid="error-panel-empty">
          No errors detected
        </div>
      {:else}
        {#each sortedErrors as error, i (error.tick + ':' + error.entity_id + ':' + error.message + ':' + i)}
          <div
            class="flex items-center gap-2 border-t border-bg-tertiary px-4 py-2 text-sm"
            class:opacity-50={isPast(error)}
            data-testid="error-row"
          >
            <span class="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium {severityClasses(error.severity)}">
              {severityLabel(error.severity)}
            </span>
            <span class="shrink-0 font-mono text-text-muted">T{error.tick}</span>
            <span class="shrink-0 font-mono text-text-secondary">#{error.entity_id}</span>
            <span class="min-w-0 truncate text-text-primary">{error.message}</span>
            <div class="ml-auto flex shrink-0 items-center gap-1">
              <button
                class="rounded px-2 py-0.5 text-xs text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
                onclick={() => world.jumpToError(error)}
                data-testid="error-jump"
              >Jump</button>
              <button
                class="rounded px-2 py-0.5 text-xs text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
                onclick={() => world.selectEntity(error.entity_id)}
                data-testid="error-entity"
              >Entity</button>
              <button
                class="rounded px-2 py-0.5 text-xs text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
                onclick={() => world.selectEntity(error.entity_id)}
                data-testid="error-trace"
              >Trace</button>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>
{/if}
