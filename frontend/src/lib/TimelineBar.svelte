<script lang="ts">
  import { world } from "./state/world.svelte";
  import { timeline } from "./state/timeline.svelte";

  let scrubbing = $state(false);
  let lastSeekTime = 0;

  const modeLabels: Record<string, string> = {
    live: "LIVE",
    paused: "PAUSED",
    history: "HISTORY",
    replay: "REPLAY",
  };

  const modeColors: Record<string, string> = {
    live: "text-success",
    paused: "text-warning",
    history: "text-accent",
    replay: "text-accent",
  };

  function throttledSeek(tick: number) {
    const now = Date.now();
    if (now - lastSeekTime < 100) return;
    lastSeekTime = now;
    const clamped = Math.min(world.maxTick, Math.max(world.minTick, tick));
    world.seek(clamped);
  }

  function handlePointerDown(e: PointerEvent) {
    if (!world.canScrub) return;
    scrubbing = true;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    seekFromPointer(e);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!scrubbing) return;
    seekFromPointer(e);
  }

  function handlePointerUp() {
    scrubbing = false;
  }

  function seekFromPointer(e: PointerEvent) {
    const track = e.currentTarget as HTMLElement;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const range = world.maxTick - world.minTick;
    const tick = Math.round(world.minTick + ratio * range);
    throttledSeek(tick);
  }

  function handleKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    ) {
      return;
    }

    if (e.key === " ") {
      e.preventDefault();
      world.togglePause();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      world.step();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      world.stepBack();
    }
  }

  let thumbPercent = $derived(
    world.maxTick > world.minTick
      ? ((world.tick - world.minTick) / (world.maxTick - world.minTick)) * 100
      : 0,
  );

  let tickInputValue = $state("");
  let editingTick = $state(false);
  let tickInputEl: HTMLInputElement | undefined = $state();

  let tickInputWidth = $derived(Math.max(2, String(world.maxTick).length));

  function startTickEdit(): void {
    if (!world.canScrub) return;
    editingTick = true;
    tickInputValue = String(world.tick);
    // Focus after Svelte renders the input
    requestAnimationFrame(() => tickInputEl?.select());
  }

  function commitTickEdit(): void {
    if (!editingTick) return;
    editingTick = false;
    const val = parseInt(tickInputValue, 10);
    if (!isNaN(val)) {
      const clamped = Math.min(world.maxTick, Math.max(world.minTick, val));
      world.seek(clamped);
    }
  }

  function cancelTickEdit(): void {
    editingTick = false;
  }

  function handleTickInputKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      commitTickEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelTickEdit();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="flex h-11 shrink-0 items-center gap-2 border-b border-bg-tertiary bg-bg-secondary px-3"
  role="toolbar"
  aria-label="Timeline controls"
>
  <div class="flex items-center gap-0.5">
    <button
      class="flex h-8 w-8 items-center justify-center rounded text-text-secondary hover:bg-bg-tertiary hover:text-text-primary disabled:opacity-30 disabled:pointer-events-none"
      onclick={() => world.stepBack()}
      disabled={!world.canScrub || world.tick <= world.minTick || world.isReplayPlaying}
      aria-label="Step back"
    >
      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
      </svg>
    </button>

    <button
      class="flex h-8 w-8 items-center justify-center rounded text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
      onclick={() => world.togglePause()}
      aria-label={world.isPaused && !world.isReplayPlaying ? "Play" : "Pause"}
    >
      <svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        {#if world.isPaused && !world.isReplayPlaying}
          <path d="M8 5v14l11-7z" />
        {:else}
          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
        {/if}
      </svg>
    </button>

    <button
      class="flex h-8 w-8 items-center justify-center rounded text-text-secondary hover:bg-bg-tertiary hover:text-text-primary disabled:opacity-30 disabled:pointer-events-none"
      onclick={() => world.step()}
      disabled={world.isReplayPlaying}
      aria-label="Step forward"
    >
      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
      </svg>
    </button>
  </div>

  <span class="text-text-muted">|</span>

  <button
    class="rounded px-2 py-1 text-sm font-medium text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
    onclick={() => timeline.nextSpeed()}
    aria-label="Playback speed"
    data-testid="speed-button"
  >
    {timeline.playbackSpeed}x
  </button>

  <span class="flex items-center gap-1.5 text-sm font-medium {modeColors[world.playbackMode] ?? 'text-text-muted'}" data-testid="mode-indicator">
    {#if world.playbackMode === "live"}
      <span class="relative flex h-2 w-2">
        <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75"></span>
        <span class="relative inline-flex h-2 w-2 rounded-full bg-success"></span>
      </span>
    {/if}
    {modeLabels[world.playbackMode] ?? world.playbackMode.toUpperCase()}
  </span>

  {#if !world.isAtLive && world.supportsHistory}
    <button
      class="rounded bg-accent/20 px-2.5 py-1 text-sm font-semibold text-accent hover:bg-accent/30"
      onclick={() => world.goToLive()}
      aria-label="Go to live"
    >
      LIVE
    </button>
  {/if}

  <span class="text-text-muted">|</span>

  <div
    class="relative flex h-full flex-1 items-center overflow-hidden px-1.5"
    class:cursor-pointer={world.canScrub}
    class:cursor-not-allowed={!world.canScrub}
    role="slider"
    aria-label="Timeline scrubber"
    aria-valuenow={world.tick}
    aria-valuemin={world.minTick}
    aria-valuemax={world.maxTick}
    aria-disabled={!world.canScrub}
    tabindex={world.canScrub ? 0 : -1}
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerUp}
  >
    <div class="relative h-1.5 w-full rounded-full bg-bg-tertiary">
      <div
        class="absolute left-0 top-0 h-full rounded-full bg-accent"
        style="width: {thumbPercent}%"
      ></div>
      <div
        class="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full bg-accent shadow-sm"
        style="left: {thumbPercent}%"
        class:scale-125={scrubbing}
      ></div>
    </div>
  </div>

  <span class="flex items-center whitespace-nowrap text-sm" style="font-variant-numeric: tabular-nums" data-testid="tick-display">
    {#if editingTick}
      <input
        bind:this={tickInputEl}
        bind:value={tickInputValue}
        class="rounded border border-accent bg-bg-primary px-1.5 py-0.5 text-right text-sm text-text-primary outline-none"
        style="width: {tickInputWidth + 1}ch"
        onblur={commitTickEdit}
        onkeydown={handleTickInputKeydown}
        data-testid="tick-input"
      />
    {:else}
      <button
        class="rounded border border-transparent px-1 py-0.5 text-right text-text-secondary hover:border-bg-tertiary hover:text-text-primary"
        class:cursor-text={world.canScrub}
        onclick={startTickEdit}
        disabled={!world.canScrub}
        data-testid="tick-value"
        title="Click to seek to tick"
      >{world.tick}</button>
    {/if}
    <span class="text-text-muted">&nbsp;/ {world.maxTick}</span>
  </span>
</div>
