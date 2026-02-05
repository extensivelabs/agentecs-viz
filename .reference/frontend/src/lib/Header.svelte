<script lang="ts">
  import { world } from "./world.svelte";

  // Connection indicator colors
  const stateColors = {
    disconnected: "bg-gray-500",
    connecting: "bg-yellow-500 animate-pulse",
    connected: "bg-green-500",
    error: "bg-red-500",
  };
</script>

<header class="flex items-center justify-between px-4 py-3 bg-[var(--color-bg-secondary)] border-b border-[var(--color-bg-tertiary)]">
  <!-- Logo and title -->
  <div class="flex items-center gap-3">
    <div class="w-8 h-8 rounded-full bg-[var(--color-accent)] flex items-center justify-center">
      <span class="text-white font-bold text-sm">A</span>
    </div>
    <h1 class="text-lg font-semibold text-[var(--color-text-primary)]">AgentECS Visualizer</h1>
  </div>

  <!-- Status and controls -->
  <div class="flex items-center gap-6">
    <!-- Tick counter -->
    {#if world.isConnected}
      <div class="flex items-center gap-2 text-sm" aria-live="polite" aria-atomic="true">
        <span class="text-[var(--color-text-secondary)]">Tick:</span>
        <span class="font-mono text-[var(--color-text-primary)]">{world.tick}</span>
      </div>

      <!-- Entity count -->
      <div class="flex items-center gap-2 text-sm" aria-live="polite" aria-atomic="true">
        <span class="text-[var(--color-text-secondary)]">Entities:</span>
        <span class="font-mono text-[var(--color-text-primary)]">{world.entityCount}</span>
      </div>

      <!-- Playback controls -->
      <div class="flex items-center gap-2" role="group" aria-label="Playback controls">
        <button
          onclick={() => world.togglePause()}
          aria-label={world.isPaused && !world.isReplayPlaying ? "Play" : "Pause"}
          aria-pressed={!world.isPaused || world.isReplayPlaying}
          class="px-3 py-1.5 rounded text-sm font-medium transition-colors
                 bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-accent)] hover:text-white"
        >
          {world.isPaused && !world.isReplayPlaying ? "▶ Play" : "⏸ Pause"}
        </button>

        {#if world.isPaused || world.isReplayPlaying}
          <button
            onclick={() => world.step()}
            aria-label="Step forward one tick"
            class="px-3 py-1.5 rounded text-sm font-medium transition-colors
                   bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-accent)] hover:text-white"
          >
            ⏭ Step
          </button>
        {/if}

        {#if !world.isAtLive}
          <button
            onclick={() => world.goToLive()}
            aria-label="Go to live"
            class="px-3 py-1.5 rounded text-sm font-medium transition-colors
                   bg-[var(--color-bg-tertiary)] hover:bg-red-600 hover:text-white"
          >
            ● Live
          </button>
        {/if}
      </div>
    {/if}

    <!-- Connection status -->
    <div class="flex items-center gap-2" role="status" aria-live="polite">
      <div class="w-2.5 h-2.5 rounded-full {stateColors[world.connectionState]}" aria-hidden="true"></div>
      <span class="text-sm text-[var(--color-text-secondary)] capitalize">
        {world.connectionState}
      </span>
    </div>
  </div>
</header>
