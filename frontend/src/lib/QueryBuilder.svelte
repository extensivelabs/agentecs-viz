<script lang="ts">
  import { world } from "./state/world.svelte";
  import { filterSuggestions, type ClauseType, type QueryClause } from "./query";

  let expanded = $state(false);
  let clauseType: ClauseType = $state("with");
  let inputValue = $state("");
  let showSuggestions = $state(false);
  let saveName = $state("");
  let showSaveInput = $state(false);
  let inputEl: HTMLInputElement | undefined = $state();

  const usedComponents = $derived(
    new Set(world.activeQuery?.clauses.map((c) => c.component) ?? []),
  );

  const suggestions = $derived(
    inputValue.length > 0
      ? filterSuggestions(world.availableComponents, inputValue, usedComponents)
      : [],
  );

  function addClause(component: string): void {
    const existing = world.activeQuery?.clauses ?? [];
    if (existing.some((c) => c.component === component)) return;
    const clause: QueryClause = { type: clauseType, component };
    const clauses = [...existing, clause];
    world.setQuery({ name: world.activeQuery?.name ?? "", clauses });
    inputValue = "";
    showSuggestions = false;
    inputEl?.focus();
  }

  function removeClause(index: number): void {
    const clauses = [...(world.activeQuery?.clauses ?? [])];
    clauses.splice(index, 1);
    if (clauses.length === 0) {
      world.clearQuery();
    } else {
      world.setQuery({ name: world.activeQuery?.name ?? "", clauses });
    }
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter" && suggestions.length > 0) {
      e.preventDefault();
      addClause(suggestions[0]);
    } else if (e.key === "Escape") {
      showSuggestions = false;
      inputValue = "";
    }
  }

  function handleSave(): void {
    if (!saveName.trim() || !world.activeQuery?.clauses.length) return;
    world.saveQuery({ name: saveName.trim(), clauses: world.activeQuery.clauses });
    saveName = "";
    showSaveInput = false;
  }
</script>

<div class="border-b border-bg-tertiary" data-testid="query-builder">
  <div class="flex items-center gap-2 px-4 py-1.5">
    <button
      class="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
      onclick={() => { expanded = !expanded }}
      data-testid="query-toggle"
    >
      <svg class="h-3 w-3 transition-transform" class:rotate-90={expanded} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 18l6-6-6-6" />
      </svg>
      Filter
    </button>

    {#if world.hasActiveFilter}
      <span class="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent" data-testid="match-count">
        {world.matchCount}/{world.entityCount}
      </span>

      <!-- Inline clause chips (visible even when collapsed) -->
      <div class="flex items-center gap-1 overflow-x-auto">
        {#each world.activeQuery?.clauses ?? [] as clause, i (i)}
          <span
            class="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] {clause.type === 'with' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}"
            data-testid="clause-chip"
          >
            {clause.type === "with" ? "WITH" : "NOT"} {clause.component}
            <button
              class="ml-0.5 hover:text-text-primary"
              onclick={() => removeClause(i)}
              data-testid="remove-clause"
            >&times;</button>
          </span>
        {/each}
      </div>

      <button
        class="ml-auto shrink-0 text-[10px] text-text-muted hover:text-text-secondary"
        onclick={() => world.clearQuery()}
        data-testid="clear-query"
      >clear</button>
    {/if}
  </div>

  {#if expanded}
    <div class="border-t border-bg-tertiary px-4 py-2" data-testid="query-builder-expanded">
      <!-- Clause builder -->
      <div class="flex items-center gap-2">
        <div class="flex items-center gap-1 rounded bg-bg-secondary px-1 py-0.5 text-xs">
          <button
            class="rounded px-1.5 py-0.5"
            class:bg-emerald-500={clauseType === "with"}
            class:text-bg-primary={clauseType === "with"}
            class:text-text-secondary={clauseType !== "with"}
            onclick={() => { clauseType = "with" }}
            data-testid="clause-type-with"
          >WITH</button>
          <button
            class="rounded px-1.5 py-0.5"
            class:bg-red-500={clauseType === "without"}
            class:text-bg-primary={clauseType === "without"}
            class:text-text-secondary={clauseType !== "without"}
            onclick={() => { clauseType = "without" }}
            data-testid="clause-type-without"
          >NOT</button>
        </div>

        <div class="relative flex-1">
          <input
            bind:this={inputEl}
            bind:value={inputValue}
            class="w-full rounded border border-bg-tertiary bg-bg-primary px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            placeholder="Component name..."
            onfocus={() => { showSuggestions = true }}
            onblur={() => { setTimeout(() => { showSuggestions = false }, 150) }}
            onkeydown={handleKeydown}
            data-testid="component-input"
          />
          {#if showSuggestions && suggestions.length > 0}
            <div class="absolute left-0 top-full z-10 mt-1 max-h-40 w-full overflow-y-auto rounded border border-bg-tertiary bg-bg-secondary shadow-lg" data-testid="suggestions">
              {#each suggestions as suggestion (suggestion)}
                <button
                  class="block w-full px-2 py-1 text-left text-xs text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
                  onmousedown={() => addClause(suggestion)}
                  data-testid="suggestion"
                >{suggestion}</button>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <!-- Saved queries + save -->
      <div class="mt-2 flex items-center gap-2">
        {#if world.savedQueries.length > 0}
          <div class="flex flex-wrap items-center gap-1">
            {#each world.savedQueries as saved (saved.name)}
              <button
                class="flex items-center gap-1 rounded border border-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
                onclick={() => world.loadQuery(saved.name)}
                data-testid="saved-query"
              >
                {saved.name}
                <span
                  class="text-text-muted hover:text-error"
                  role="button"
                  tabindex="0"
                  onmousedown={(e) => { e.stopPropagation(); world.deleteSavedQuery(saved.name) }}
                  onkeydown={(e) => { if (e.key === "Enter") world.deleteSavedQuery(saved.name) }}
                >&times;</span>
              </button>
            {/each}
          </div>
        {/if}

        {#if world.hasActiveFilter}
          {#if showSaveInput}
            <div class="flex items-center gap-1">
              <input
                bind:value={saveName}
                class="w-24 rounded border border-bg-tertiary bg-bg-primary px-1.5 py-0.5 text-[10px] text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                placeholder="Query name"
                onkeydown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") { showSaveInput = false } }}
                data-testid="save-name-input"
              />
              <button
                class="text-[10px] text-accent hover:text-accent/80"
                onclick={handleSave}
                data-testid="save-confirm"
              >save</button>
            </div>
          {:else}
            <button
              class="text-[10px] text-text-muted hover:text-text-secondary"
              onclick={() => { showSaveInput = true }}
              data-testid="save-query-btn"
            >save query</button>
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</div>
