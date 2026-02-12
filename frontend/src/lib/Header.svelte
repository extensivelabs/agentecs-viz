<script lang="ts">
  import { world } from "./state/world.svelte";

  const playIcon =
    "M8 5.14v14l11-7-11-7z";
  const pauseIcon =
    "M6 19h4V5H6v14zm8-14v14h4V5h-4z";
  const stepIcon =
    "M6 18l8.5-6L6 6v12zm2 0h3v-12h-3v12z";

  let tickInputValue: string = $state("");
  let isEditingTick = $state(false);

  function startEditTick() {
    tickInputValue = String(world.tick);
    isEditingTick = true;
  }

  function commitTick() {
    const n = Number(tickInputValue.trim());
    if (Number.isInteger(n) && Number.isFinite(n)) {
      const clamped = world.tickRange
        ? Math.min(world.tickRange[1], Math.max(world.tickRange[0], n))
        : n;
      world.seek(clamped);
    }
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

    <div class="ml-auto flex items-center gap-1">
      <button
        class="flex h-7 w-7 items-center justify-center rounded text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
        onclick={() => world.togglePause()}
        title={world.isPaused ? "Resume" : "Pause"}
        aria-label={world.isPaused ? "Resume" : "Pause"}
      >
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
          <path d={world.isPaused ? playIcon : pauseIcon} />
        </svg>
      </button>

      {#if world.isPaused}
        <button
          class="flex h-7 w-7 items-center justify-center rounded text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
          onclick={() => world.step()}
          title="Step"
          aria-label="Step forward one tick"
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
            <path d={stepIcon} />
          </svg>
        </button>
      {/if}

      {#if !world.isAtLive && world.supportsHistory}
        <button
          class="rounded px-2 py-0.5 text-xs font-medium text-accent hover:bg-bg-tertiary"
          onclick={() => world.goToLive()}
        >
          LIVE
        </button>
      {/if}
    </div>
  {/if}

  <div class="flex items-center gap-1.5" class:ml-auto={!world.isConnected}>
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
