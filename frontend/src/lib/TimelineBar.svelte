<script lang="ts">
  import { world, type PlaybackMode } from "./world.svelte";

  // Mode display configuration
  const modeConfig: Record<PlaybackMode, { label: string; color: string; icon: string }> = {
    live: { label: "LIVE", color: "bg-green-500", icon: "●" },
    recording: { label: "REC", color: "bg-red-500", icon: "⏺" },
    paused: { label: "PAUSED", color: "bg-yellow-500", icon: "⏸" },
    paused_history: { label: "PAUSED", color: "bg-blue-500", icon: "⏸" },
    replay: { label: "REPLAY", color: "bg-blue-500", icon: "⏪" },
  };

  // Track slider position during drag
  let sliderValue = $state(world.tick);
  let isDragging = $state(false);

  // Update slider when not dragging
  $effect(() => {
    if (!isDragging) {
      sliderValue = world.tick;
    }
  });

  function handleSliderInput(e: Event) {
    const target = e.target as HTMLInputElement;
    sliderValue = parseInt(target.value);
  }

  function handleSliderChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const tick = parseInt(target.value);
    world.seek(tick);
    isDragging = false;
  }

  function handleSliderStart() {
    isDragging = true;
    // Stop replay and auto-pause when starting to scrub
    if (!world.isPaused || world.isReplayPlaying) {
      world.pause();
    }
  }

  // Get current mode config
  const currentMode = $derived(modeConfig[world.playbackMode]);
</script>

{#if world.isConnected}
  <div class="flex items-center gap-4 px-4 py-2 bg-[var(--color-bg-secondary)] border-t border-[var(--color-bg-tertiary)]">
    <!-- Mode indicator -->
    <div class="flex items-center gap-2 min-w-[80px]">
      <span class="w-2 h-2 rounded-full {currentMode.color} {world.playbackMode === 'recording' ? 'animate-pulse' : ''}"></span>
      <span class="text-xs font-semibold tracking-wider text-[var(--color-text-secondary)]">
        {currentMode.label}
      </span>
    </div>

    <!-- Timeline slider -->
    {#if world.canScrub}
      <div class="flex-1 flex items-center gap-3">
        <span class="text-xs font-mono text-[var(--color-text-muted)] min-w-[40px]">
          {world.minTick}
        </span>
        <input
          type="range"
          min={world.minTick}
          max={world.maxTick}
          value={sliderValue}
          oninput={handleSliderInput}
          onchange={handleSliderChange}
          onmousedown={handleSliderStart}
          ontouchstart={handleSliderStart}
          class="flex-1 h-1 appearance-none bg-[var(--color-bg-tertiary)] rounded-full cursor-pointer
                 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--color-accent)]
                 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform
                 [&::-webkit-slider-thumb]:hover:scale-125
                 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3
                 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[var(--color-accent)]
                 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
        />
        <span class="text-xs font-mono text-[var(--color-text-muted)] min-w-[40px] text-right">
          {world.maxTick}
        </span>
      </div>
    {:else}
      <div class="flex-1 flex items-center justify-center">
        <span class="text-xs text-[var(--color-text-muted)]">
          {world.supportsReplay ? "Recording..." : "Timeline not available"}
        </span>
      </div>
    {/if}

    <!-- Current tick display -->
    <div class="flex items-center gap-2 min-w-[100px] justify-end">
      <span class="text-xs text-[var(--color-text-secondary)]">Tick:</span>
      <span class="font-mono text-sm text-[var(--color-text-primary)] tabular-nums">
        {isDragging ? sliderValue : world.tick}
      </span>
    </div>
  </div>
{/if}
