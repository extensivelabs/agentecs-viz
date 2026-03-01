<script lang="ts">
  import { PLAYBACK_MODE_TEXT_CLASS } from "./config";
  import { world } from "./state/world.svelte";

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
      <span class={PLAYBACK_MODE_TEXT_CLASS[world.playbackMode] ?? "text-text-muted"}>
        {world.playbackMode.toUpperCase()}
      </span>
    {/if}
  </div>
</footer>
