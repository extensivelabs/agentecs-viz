<script lang="ts">
  import { world } from "./state/world.svelte";

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
    <span class="text-sm font-semibold text-accent">AE</span>
    <span class="text-sm font-medium text-text-primary">{world.worldName}</span>
  </div>

  {#if world.isConnected}
    <div class="flex items-center gap-3 text-xs text-text-secondary">
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
    <span class="text-xs text-text-muted">{world.connectionState}</span>
  </div>
</header>
