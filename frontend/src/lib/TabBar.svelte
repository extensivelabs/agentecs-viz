<script lang="ts">
  export interface Tab {
    id: string;
    label: string;
    icon?: string;
    disabled?: boolean;
  }

  interface Props {
    tabs: Tab[];
    activeTab: string;
    onTabChange: (id: string) => void;
  }

  let { tabs, activeTab, onTabChange }: Props = $props();

  function handleKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    ) {
      return;
    }
    const num = parseInt(event.key);
    if (num >= 1 && num <= tabs.length) {
      const tab = tabs[num - 1];
      if (!tab.disabled) {
        onTabChange(tab.id);
      }
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="flex shrink-0 border-b border-bg-tertiary bg-bg-secondary"
  role="tablist"
>
  {#each tabs as tab, i (tab.id)}
    <button
      role="tab"
      aria-selected={activeTab === tab.id}
      disabled={tab.disabled}
      class="relative px-4 py-2.5 text-sm font-medium transition-colors"
      class:text-text-primary={activeTab === tab.id}
      class:text-text-muted={activeTab !== tab.id && !tab.disabled}
      class:opacity-40={tab.disabled}
      class:cursor-not-allowed={tab.disabled}
      class:hover:text-text-secondary={activeTab !== tab.id && !tab.disabled}
      onclick={() => onTabChange(tab.id)}
    >
      {tab.label}
      <span class="ml-1 text-text-muted opacity-50">{i + 1}</span>
      {#if activeTab === tab.id}
        <span
          class="absolute bottom-0 left-0 right-0 h-0.5 bg-accent"
        ></span>
      {/if}
    </button>
  {/each}
</div>
