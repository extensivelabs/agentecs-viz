<script lang="ts">
  import { onMount } from "svelte";
  import Header from "./lib/Header.svelte";
  import TabBar from "./lib/TabBar.svelte";
  import TimelineBar from "./lib/TimelineBar.svelte";
  import StatusBar from "./lib/StatusBar.svelte";
  import { world } from "./lib/state/world.svelte";
  import EntityView from "./lib/EntityView.svelte";
  import InspectorPanel from "./lib/InspectorPanel.svelte";
  import type { Tab } from "./lib/TabBar.svelte";

  const baseTabs: Tab[] = [
    { id: "entities", label: "Entities" },
    { id: "traces", label: "Traces" },
    { id: "timeline", label: "Timeline" },
    { id: "archetypes", label: "Archetypes" },
  ];

  const chatTab: Tab = { id: "chat", label: "Chat" };

  let activeTab = $state("entities");

  let tabs = $derived(
    world.chatEnabled ? [...baseTabs, chatTab] : baseTabs,
  );

  $effect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      activeTab = "entities";
    }
  });

  onMount(() => {
    world.connect();
    return () => world.disconnect();
  });
</script>

<div class="flex h-full flex-col">
  <Header />

  {#if world.connectionState === "connecting"}
    <div class="flex flex-1 items-center justify-center text-text-muted">
      <div class="flex items-center gap-2">
        <svg
          class="h-4 w-4 animate-spin text-accent"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            class="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            stroke-width="4"
          ></circle>
          <path
            class="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          ></path>
        </svg>
        <span class="text-sm">Connecting...</span>
      </div>
    </div>

  {:else if world.connectionState === "error"}
    <div class="flex flex-1 flex-col items-center justify-center gap-3 text-text-muted">
      <span class="text-error text-sm">Connection failed</span>
      <button
        class="rounded border border-bg-tertiary px-3 py-1 text-xs text-text-secondary hover:bg-bg-tertiary"
        onclick={() => world.connect()}
      >
        Retry
      </button>
    </div>

  {:else if world.connectionState === "disconnected"}
    <div class="flex flex-1 items-center justify-center text-text-muted">
      <span class="text-sm">Not connected</span>
    </div>

  {:else}
    {#if world.lastError}
      <div
        class="flex items-center gap-2 border-b border-error/20 bg-error/10 px-4 py-1.5"
      >
        <span class="text-xs text-error">{world.lastError}</span>
        <button
          class="ml-auto text-xs text-text-muted hover:text-text-secondary"
          onclick={() => (world.lastError = null)}
        >
          dismiss
        </button>
      </div>
    {/if}

    <TabBar {tabs} {activeTab} onTabChange={(id) => (activeTab = id)} />
    <TimelineBar />

    <main class="flex-1 overflow-hidden">
      {#if activeTab === "entities"}
        <div class="flex h-full">
          <div class="min-w-0 flex-1">
            <EntityView />
          </div>
          <InspectorPanel />
        </div>
      {:else if activeTab === "traces"}
        <div class="flex h-full items-center justify-center text-text-muted text-sm">
          Trace View (REQ-009)
        </div>
      {:else if activeTab === "timeline"}
        <div class="flex h-full items-center justify-center text-text-muted text-sm">
          Timeline Analysis (REQ-015)
        </div>
      {:else if activeTab === "archetypes"}
        <div class="flex h-full items-center justify-center text-text-muted text-sm">
          Archetypes View (REQ-017)
        </div>
      {:else if activeTab === "chat"}
        <div class="flex h-full items-center justify-center text-text-muted text-sm">
          Chat View
        </div>
      {/if}
    </main>

    <StatusBar />
  {/if}
</div>
