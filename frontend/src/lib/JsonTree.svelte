<script lang="ts">
  import JsonTree from "./JsonTree.svelte";

  interface Props {
    data: Record<string, unknown>;
    statusFields?: string[];
    errorFields?: string[];
    depth?: number;
  }

  let { data, statusFields = [], errorFields = [], depth = 0 }: Props = $props();

  let collapsed = $state<Record<string, boolean>>({});

  function isCollapsed(key: string): boolean {
    return collapsed[key] ?? depth > 0;
  }

  function toggle(key: string): void {
    collapsed[key] = !isCollapsed(key);
  }

  function sortedKeys(obj: Record<string, unknown>): string[] {
    return Object.keys(obj).sort();
  }

  function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function isArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
  }

  function objectKeyCount(value: Record<string, unknown>): number {
    return Object.keys(value).length;
  }

  function isStatusField(key: string): boolean {
    return statusFields.includes(key);
  }

  function isErrorField(key: string): boolean {
    return errorFields.includes(key);
  }
</script>

<div class="font-mono text-xs" data-testid="json-tree">
  {#each sortedKeys(data) as key}
    {@const value = data[key]}
    <div class="py-0.5" style:padding-left={depth > 0 ? "12px" : "0"}>
      {#if isObject(value)}
        <button
          class="flex items-center gap-1 text-left text-text-secondary hover:text-text-primary"
          onclick={() => toggle(key)}
          data-testid="json-toggle"
        >
          <span class="inline-block w-3 text-center text-text-muted">{isCollapsed(key) ? "\u25B8" : "\u25BE"}</span>
          <span class:text-accent={isStatusField(key)} class:text-error={isErrorField(key)}>{key}</span>
          {#if isCollapsed(key)}
            <span class="text-text-muted">{"{...}"} {objectKeyCount(value)} {objectKeyCount(value) === 1 ? "key" : "keys"}</span>
          {/if}
        </button>
        {#if !isCollapsed(key)}
          <JsonTree data={value} {statusFields} {errorFields} depth={depth + 1} />
        {/if}
      {:else if isArray(value)}
        <button
          class="flex items-center gap-1 text-left text-text-secondary hover:text-text-primary"
          onclick={() => toggle(key)}
          data-testid="json-toggle"
        >
          <span class="inline-block w-3 text-center text-text-muted">{isCollapsed(key) ? "\u25B8" : "\u25BE"}</span>
          <span class:text-accent={isStatusField(key)} class:text-error={isErrorField(key)}>{key}</span>
          {#if isCollapsed(key)}
            <span class="text-text-muted">[...] {value.length} {value.length === 1 ? "item" : "items"}</span>
          {/if}
        </button>
        {#if !isCollapsed(key)}
          <div style:padding-left="12px">
            {#each value as item, i}
              <div class="py-0.5">
                {#if isObject(item)}
                  <button
                    class="flex items-center gap-1 text-left text-text-secondary hover:text-text-primary"
                    onclick={() => toggle(`${key}.${i}`)}
                    data-testid="json-toggle"
                  >
                    <span class="inline-block w-3 text-center text-text-muted">{isCollapsed(`${key}.${i}`) ? "\u25B8" : "\u25BE"}</span>
                    <span class="text-text-muted">{i}</span>
                    {#if isCollapsed(`${key}.${i}`)}
                      <span class="text-text-muted">{"{...}"} {objectKeyCount(item)} {objectKeyCount(item) === 1 ? "key" : "keys"}</span>
                    {/if}
                  </button>
                  {#if !isCollapsed(`${key}.${i}`)}
                    <JsonTree data={item} {statusFields} {errorFields} depth={depth + 1} />
                  {/if}
                {:else}
                  <span class="text-text-muted">{i}:</span>
                  {#if typeof item === "string"}
                    <span class="text-green-400">"{item}"</span>
                  {:else if typeof item === "number"}
                    <span class="text-accent">{item}</span>
                  {:else if typeof item === "boolean"}
                    <span class="text-purple-400">{item}</span>
                  {:else if item === null}
                    <span class="italic text-text-muted">null</span>
                  {:else}
                    <span class="text-text-secondary">{JSON.stringify(item)}</span>
                  {/if}
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      {:else}
        <div class="flex items-center gap-1">
          <span class="inline-block w-3"></span>
          <span class:text-accent={isStatusField(key)} class:text-error={isErrorField(key)} class="text-text-secondary">{key}:</span>
          {#if typeof value === "string"}
            {#if isStatusField(key)}
              <span class="rounded bg-accent/20 px-1 text-accent">{value}</span>
            {:else if isErrorField(key)}
              <span class="rounded bg-error/20 px-1 text-error">{value}</span>
            {:else}
              <span class="text-green-400">"{value}"</span>
            {/if}
          {:else if typeof value === "number"}
            <span class="text-accent">{value}</span>
          {:else if typeof value === "boolean"}
            <span class="text-purple-400">{value}</span>
          {:else if value === null || value === undefined}
            <span class="italic text-text-muted">null</span>
          {:else}
            <span class="text-text-secondary">{JSON.stringify(value)}</span>
          {/if}
        </div>
      {/if}
    </div>
  {/each}
</div>
