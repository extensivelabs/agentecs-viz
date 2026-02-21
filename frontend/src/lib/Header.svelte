<script lang="ts">
  import { world } from "./state/world.svelte";
  import { formatCostUsd, formatTokens } from "./utils";

  let tickInputValue: string = $state("");
  let isEditingTick = $state(false);

  function startEditTick() {
    tickInputValue = String(world.tick);
    isEditingTick = true;
  }

  function commitTick() {
    const value = tickInputValue.trim();
    if (!/^-?\d+$/.test(value)) {
      isEditingTick = false;
      return;
    }
    const n = Number(value);
    const clamped = world.tickRange
      ? Math.min(world.tickRange[1], Math.max(world.tickRange[0], n))
      : n;
    world.seek(clamped);
    isEditingTick = false;
  }

  function cancelTick() {
    isEditingTick = false;
  }

  function handleTickKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitTick();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelTick();
    }
  }

  function autofocus(el: HTMLInputElement) {
    el.focus();
    el.select();
  }

</script>

<header
  class="flex h-12 shrink-0 items-center gap-4 border-b border-bg-tertiary bg-bg-secondary px-4"
>
  <div class="flex items-center gap-2">
    <span class="text-base font-semibold text-accent">AE</span>
    <span class="text-base font-medium text-text-primary">{world.worldName}</span>
  </div>

  {#if world.isConnected}
    <div class="flex items-center gap-3 text-sm text-text-secondary">
      <span class="flex items-center gap-1">Tick
        {#if isEditingTick}
          <input
            type="text"
            class="w-14 bg-transparent font-mono text-text-primary outline-none border-b border-accent"
            bind:value={tickInputValue}
            onkeydown={handleTickKeydown}
            onblur={cancelTick}
            use:autofocus
          />
        {:else}
          <button
            class="font-mono text-text-primary hover:text-accent cursor-text"
            onclick={startEditTick}
          >{world.tick}</button>
        {/if}
      </span>
      <span class="text-text-muted">|</span>
      <span><span class="font-mono text-text-primary">{world.entityCount}</span> entities</span>
      <span class="text-text-muted">|</span>
      <span><span class="font-mono text-text-primary">{formatTokens(world.totalTokenUsage.total)}</span> tokens</span>
      <span class="text-text-muted">|</span>
      <span><span class="font-mono text-text-primary">{formatCostUsd(world.totalTokenUsage.costUsd)}</span> cost</span>
      {#if world.tokenCostBudgetExceeded}
        <span
          class="rounded bg-warning/20 px-1.5 py-0.5 text-warning"
          data-testid="cost-budget-warning"
        >Budget {formatCostUsd(world.tokenCostBudgetUsd)}</span>
      {/if}
      {#if world.visibleErrorCount > 0}
        <span class="text-text-muted">|</span>
        <button
          class="flex items-center gap-1 text-error hover:text-error/80"
          onclick={() => world.toggleErrorPanel()}
          data-testid="error-badge"
        >
          <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <span class="font-mono">{world.visibleErrorCount}</span>
        </button>
      {/if}
    </div>

  {/if}

  <div class="ml-auto flex items-center gap-1.5">
    <span
      class="h-2 w-2 rounded-full"
      class:bg-success={world.connectionState === "connected"}
      class:bg-warning={world.connectionState === "connecting"}
      class:bg-error={world.connectionState === "error"}
      class:bg-text-muted={world.connectionState === "disconnected"}
    ></span>
    <span class="text-sm text-text-muted">{world.connectionState}</span>
  </div>
</header>
