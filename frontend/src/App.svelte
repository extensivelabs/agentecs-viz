<script lang="ts">
  import { onMount } from "svelte";
  import Header from "./lib/Header.svelte";
  import TabBar, { type Tab } from "./lib/TabBar.svelte";
  import TimelineBar from "./lib/TimelineBar.svelte";
  import PetriDish from "./lib/PetriDish.svelte";
  import EntityList from "./lib/EntityList.svelte";
  import DataTab from "./lib/DataTab.svelte";
  import TimelineTab from "./lib/TimelineTab.svelte";
  import ChatTab from "./lib/ChatTab.svelte";
  import ArchetypesTab from "./lib/ArchetypesTab.svelte";
  import { world } from "./lib/world.svelte";

  // Tab definitions (order: Petri Dish → Timeline → Archetypes → Entities → Data → Chat)
  // Chat tab visibility controlled by world.chatEnabled from config
  const allTabs: Tab[] = [
    { id: "petri", label: "Petri Dish", icon: "🧫" },
    { id: "timeline", label: "Timeline", icon: "📅" },
    { id: "archetypes", label: "Archetypes", icon: "🧬" },
    { id: "list", label: "Entities", icon: "📋" },
    { id: "data", label: "Data", icon: "📊" },
    { id: "chat", label: "Chat", icon: "💬" },
  ];

  // Filter tabs based on config (chat enabled/disabled)
  const tabs = $derived(
    world.chatEnabled ? allTabs : allTabs.filter((t) => t.id !== "chat")
  );

  let activeTab = $state("petri");

  // Auto-connect on mount
  onMount(() => {
    world.connect().catch((e) => {
      console.error("Failed to connect:", e);
    });

    return () => {
      world.disconnect();
    };
  });
</script>

<Header />

<main class="flex-1 p-4 overflow-hidden">
  {#if world.lastError}
    <div class="mb-4 p-3 rounded bg-red-900/30 border border-red-700 text-red-200">
      {world.lastError}
    </div>
  {/if}

  {#if !world.isConnected}
    <div class="flex flex-col items-center justify-center h-64 text-[var(--color-text-secondary)]">
      {#if world.connectionState === "connecting"}
        <div class="animate-spin w-8 h-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full mb-4"></div>
        <p>Connecting to server...</p>
      {:else if world.connectionState === "error"}
        <p class="text-red-400 mb-2">Connection failed</p>
        <button
          onclick={() => world.connect()}
          class="px-4 py-2 rounded bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          Retry
        </button>
      {:else}
        <p>Not connected</p>
        <button
          onclick={() => world.connect()}
          class="mt-2 px-4 py-2 rounded bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          Connect
        </button>
      {/if}
    </div>
  {:else}
    <div class="flex flex-col gap-4 h-full">
      <!-- Tab bar -->
      <TabBar {tabs} {activeTab} onTabChange={(id) => (activeTab = id)} />

      <!-- Tab content -->
      <div class="flex-1 min-h-0 relative {activeTab === 'petri' ? 'overflow-hidden' : 'overflow-auto'}">
        {#if activeTab === "petri"}
          <PetriDish />
        {:else if activeTab === "list"}
          <EntityList />
        {:else if activeTab === "data"}
          <DataTab />
        {:else if activeTab === "timeline"}
          <TimelineTab />
        {:else if activeTab === "chat"}
          <ChatTab onNavigateToPetriDish={() => (activeTab = "petri")} />
        {:else if activeTab === "archetypes"}
          <ArchetypesTab isActive={true} onNavigateToPetriDish={() => (activeTab = "petri")} />
        {/if}
      </div>
    </div>
  {/if}
</main>

<TimelineBar />
