<script lang="ts">
  import { world } from "./state/world.svelte";

  const playIcon =
    "M8 5.14v14l11-7-11-7z";
  const pauseIcon =
    "M6 19h4V5H6v14zm8-14v14h4V5h-4z";
  const stepIcon =
    "M6 18l8.5-6L6 6v12zm2 0h3v-12h-3v12z";
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
      <span>Tick <span class="font-mono text-text-primary">{world.tick}</span></span>
      <span class="text-text-muted">|</span>
      <span><span class="font-mono text-text-primary">{world.entityCount}</span> entities</span>
    </div>

    <div class="ml-auto flex items-center gap-1">
      <button
        class="flex h-7 w-7 items-center justify-center rounded text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
        onclick={() => world.togglePause()}
        title={world.isPaused ? "Resume" : "Pause"}
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
