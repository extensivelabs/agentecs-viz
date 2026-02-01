<script lang="ts">
  import { onMount } from "svelte";

  export type Tab = {
    id: string;
    label: string;
    icon?: string;
    disabled?: boolean;
  };

  interface Props {
    tabs: Tab[];
    activeTab: string;
    onTabChange: (tabId: string) => void;
  }

  let { tabs, activeTab, onTabChange }: Props = $props();

  // Keyboard shortcuts (1-9 for tabs)
  function handleKeydown(e: KeyboardEvent) {
    // Only handle if not in an input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }

    const num = parseInt(e.key);
    if (num >= 1 && num <= tabs.length) {
      const tab = tabs[num - 1];
      if (!tab.disabled) {
        onTabChange(tab.id);
      }
    }
  }

  onMount(() => {
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });
</script>

<div
  class="flex items-center gap-1 border-b border-[var(--color-bg-tertiary)]"
  role="tablist"
  aria-label="View tabs (press 1-9 to switch)"
>
  {#each tabs as tab, i (tab.id)}
    <button
      onclick={() => !tab.disabled && onTabChange(tab.id)}
      disabled={tab.disabled}
      role="tab"
      aria-selected={activeTab === tab.id}
      aria-label="{tab.label} (press {i + 1})"
      aria-disabled={tab.disabled}
      class="group relative px-4 py-2 text-sm font-medium transition-colors
             {activeTab === tab.id
               ? 'text-[var(--color-accent)]'
               : tab.disabled
                 ? 'text-[var(--color-text-muted)] cursor-not-allowed'
                 : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}"
    >
      <span class="flex items-center gap-2">
        {#if tab.icon}
          <span class="text-base" aria-hidden="true">{tab.icon}</span>
        {/if}
        {tab.label}
        <span
          class="text-xs opacity-50 ml-1 hidden md:inline
                 {tab.disabled ? 'opacity-30' : ''}"
          aria-hidden="true"
        >
          {i + 1}
        </span>
      </span>

      <!-- Active indicator -->
      {#if activeTab === tab.id}
        <span
          class="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--color-accent)]"
          aria-hidden="true"
        ></span>
      {/if}
    </button>
  {/each}
</div>
