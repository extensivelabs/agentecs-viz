<script lang="ts">
  import { world } from "./state/world.svelte";
  import {
    filterSuggestions,
    getAvailableComponents,
    type ClauseType,
    type QueryClause,
  } from "./query";

  let expanded = $state(false);
  let clauseType: ClauseType = $state("with");
  let inputValue = $state("");
  let showSuggestions = $state(false);
  let saveName = $state("");
  let showSaveInput = $state(false);
  let inputEl: HTMLInputElement | undefined = $state();

  const usedComponents = $derived(
    new Set(
      (world.activeQuery?.clauses ?? [])
        .filter(
          (clause) =>
            (clause.type === "with" || clause.type === "without")
            && clause.type === clauseType,
        )
        .map((clause) => clause.component),
    ),
  );

  const availableComponents = $derived(getAvailableComponents(world.entities));

  const suggestions = $derived(
    inputValue.length > 0
      ? filterSuggestions(availableComponents, inputValue, usedComponents)
      : [],
  );

  function addClause(component: string): void {
    const existing = world.activeQuery?.clauses ?? [];
    if (
      existing.some(
        (c) =>
          (c.type === "with" || c.type === "without")
          && c.type === clauseType
          && c.component === component,
      )
    ) {
      return;
    }

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

  function chipColor(clause: QueryClause): string {
    if (clause.type === "with") return "bg-emerald-500/20 text-emerald-400";
    if (clause.type === "without") return "bg-red-500/20 text-red-400";
    return "bg-blue-500/20 text-blue-400";
  }

  function formatClauseNumber(value: number): string {
    if (!Number.isFinite(value)) return String(value);
    if (Number.isInteger(value)) return String(value);

    const rounded = value.toFixed(2);
    return rounded.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  }

  function chipLabel(clause: QueryClause): string {
    if (clause.type === "with") return `WITH ${clause.component}`;
    if (clause.type === "without") return `NOT ${clause.component}`;

    const field = clause.field ?? "?";

    if (clause.type === "value_eq") {
      return `${clause.component}.${field} = ${clause.value ?? "?"}`;
    }

    const min = clause.min;
    const max = clause.max;
    const minLabel = min === undefined ? "..." : formatClauseNumber(min);
    const maxLabel = max === undefined || max === Infinity
      ? "..."
      : formatClauseNumber(max);
    const closingBracket = clause.inclusiveMax ? "]" : ")";
    return `${clause.component}.${field} in [${minLabel}, ${maxLabel}${closingBracket}`;
  }

  function clauseKey(clause: QueryClause): string {
    const maxPart = clause.max === undefined
      ? ""
      : Number.isFinite(clause.max)
      ? String(clause.max)
      : "Infinity";
    return [
      clause.type,
      clause.component,
      clause.field ?? "",
      clause.value ?? "",
      clause.min === undefined ? "" : String(clause.min),
      maxPart,
      clause.inclusiveMax ? "1" : "0",
    ].join("|");
  }
</script>

<div class="border-b border-bg-tertiary" data-testid="query-builder">
  <div class="flex items-center gap-2 px-4 py-2">
    <button
      class="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
      onclick={() => { expanded = !expanded }}
      data-testid="query-toggle"
    >
      <svg class="h-3.5 w-3.5 transition-transform" class:rotate-90={expanded} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 18l6-6-6-6" />
      </svg>
      Filter
    </button>

    {#if world.hasActiveFilter}
      <span class="rounded bg-accent/20 px-2 py-0.5 text-xs font-medium text-accent" data-testid="match-count">
        {world.matchCount}/{world.entityCount}
      </span>

      <div class="flex items-center gap-1 overflow-x-auto">
        {#each world.activeQuery?.clauses ?? [] as clause, i (clauseKey(clause))}
          <span
            class="flex items-center gap-1 rounded px-2 py-0.5 text-xs {chipColor(clause)}"
            data-testid="clause-chip"
          >
            {chipLabel(clause)}
            <button
              type="button"
              class="ml-0.5 hover:text-text-primary"
              onclick={() => removeClause(i)}
              data-testid="remove-clause"
              aria-label={"Remove " + clause.component + " clause"}
            >&times;</button>
          </span>
        {/each}
      </div>

      <button
        class="ml-auto shrink-0 text-xs text-text-muted hover:text-text-secondary"
        onclick={() => world.clearQuery()}
        data-testid="clear-query"
      >clear</button>
    {/if}
  </div>

  {#if expanded}
    <div class="border-t border-bg-tertiary px-4 py-2" data-testid="query-builder-expanded">
      <div class="flex items-center gap-2">
        <div class="flex items-center gap-1 rounded bg-bg-secondary px-1.5 py-0.5 text-sm">
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
            class="w-full rounded border border-bg-tertiary bg-bg-primary px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            placeholder="Component name..."
            onfocus={() => { showSuggestions = true }}
            onblur={() => { showSuggestions = false }}
            onkeydown={handleKeydown}
            data-testid="component-input"
          />
          {#if showSuggestions && suggestions.length > 0}
            <div class="absolute left-0 top-full z-10 mt-1 max-h-40 w-full overflow-y-auto rounded border border-bg-tertiary bg-bg-secondary shadow-lg" data-testid="suggestions">
              {#each suggestions as suggestion (suggestion)}
                <button
                  class="block w-full px-2.5 py-1.5 text-left text-sm text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
                  onmousedown={(e) => { e.preventDefault(); addClause(suggestion) }}
                  data-testid="suggestion"
                >{suggestion}</button>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <div class="mt-2 flex items-center gap-2">
        {#if world.savedQueries.length > 0}
          <div class="flex flex-wrap items-center gap-1">
            {#each world.savedQueries as saved (saved.name)}
              <div class="flex items-center gap-1">
                <button
                  type="button"
                  class="rounded border border-bg-tertiary px-2 py-0.5 text-xs text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
                  onclick={() => world.loadQuery(saved.name)}
                  data-testid="saved-query"
                >{saved.name}</button>
                <button
                  type="button"
                  class="text-xs leading-none text-text-muted hover:text-error"
                  aria-label={"Delete saved query " + saved.name}
                  onclick={() => world.deleteSavedQuery(saved.name)}
                  data-testid="delete-saved-query"
                >&times;</button>
              </div>
            {/each}
          </div>
        {/if}

        {#if world.hasActiveFilter}
          {#if showSaveInput}
            <div class="flex items-center gap-1">
              <input
                bind:value={saveName}
                class="w-28 rounded border border-bg-tertiary bg-bg-primary px-2 py-0.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                placeholder="Query name"
                onkeydown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") { showSaveInput = false } }}
                data-testid="save-name-input"
              />
              <button
                class="text-xs text-accent hover:text-accent/80"
                onclick={handleSave}
                data-testid="save-confirm"
              >save</button>
            </div>
          {:else}
            <button
              class="text-xs text-text-muted hover:text-text-secondary"
              onclick={() => { showSaveInput = true }}
              data-testid="save-query-btn"
            >save query</button>
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</div>
