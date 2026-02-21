<script lang="ts">
  import { world } from "./state/world.svelte";

  const modeColors: Record<string, string> = {
    live: "text-success",
    paused: "text-warning",
    history: "text-accent",
    replay: "text-accent",
  };

  let lastTimestamp = $derived(
    world.snapshot?.timestamp != null
      ? new Date(world.snapshot.timestamp * 1000).toLocaleTimeString()
      : null,
  );
</script>

<footer
  class="flex h-7 shrink-0 items-center justify-between border-t border-bg-tertiary bg-bg-secondary px-4 text-sm text-text-muted"
>
  <span>{world.connectionState === "connected" ? "Connected" : world.connectionState}</span>

  <div class="flex items-center gap-3">
    {#if lastTimestamp}
      <span>{lastTimestamp}</span>
    {/if}
    {#if world.isConnected}
      <span class={modeColors[world.playbackMode] ?? "text-text-muted"}>
        {world.playbackMode.toUpperCase()}
      </span>
    {/if}
  </div>
</footer>
