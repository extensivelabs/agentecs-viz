<script lang="ts">
  import {
    computeDistribution,
    getFieldsForComponent,
    type CategoricalBin,
    type NumericBin,
  } from "./distribution";
  import {
    getAvailableComponents,
    type QueryClause,
  } from "./query";
  import { world } from "./state/world.svelte";

  interface CategoricalRow {
    key: string;
    label: string;
    count: number;
    kind: "categorical";
    bin: CategoricalBin;
  }

  interface NumericRow {
    key: string;
    label: string;
    count: number;
    kind: "numeric";
    bin: NumericBin;
    isLast: boolean;
  }

  type ChartRow = CategoricalRow | NumericRow;
  type ValueClauseType = "value_eq" | "value_range";
  type ValueClause = QueryClause & { type: ValueClauseType };

  const SVG_WIDTH = 360;
  const LABEL_X = 4;
  const LABEL_WIDTH = 132;
  const BAR_X = LABEL_X + LABEL_WIDTH + 8;
  const BAR_WIDTH = 156;
  const COUNT_X = BAR_X + BAR_WIDTH + 8;
  const ROW_HEIGHT = 24;
  const BAR_HEIGHT = 14;
  const TOP_PADDING = 8;
  const BOTTOM_PADDING = 8;

  let selectedComponent = $state("");
  let selectedField = $state("");

  let availableComponents = $derived(getAvailableComponents(world.entities));
  let availableFields = $derived(
    selectedComponent
      ? getFieldsForComponent(world.entities, selectedComponent)
      : [],
  );

  $effect(() => {
    if (availableComponents.length === 0) {
      selectedComponent = "";
      return;
    }

    if (!availableComponents.includes(selectedComponent)) {
      selectedComponent = availableComponents[0];
    }
  });

  $effect(() => {
    if (availableFields.length === 0) {
      selectedField = "";
      return;
    }

    if (!availableFields.includes(selectedField)) {
      selectedField = availableFields[0];
    }
  });

  let distribution = $derived.by(() => {
    if (!selectedComponent || !selectedField) return null;
    return computeDistribution(world.entities, selectedComponent, selectedField);
  });

  let chartRows = $derived.by((): ChartRow[] => {
    if (!distribution) return [];

    if (distribution.type === "categorical") {
      return distribution.bins.map((bin) => ({
        key: `cat:${bin.value}`,
        label: truncateLabel(bin.value),
        count: bin.count,
        kind: "categorical",
        bin,
      }));
    }

    return distribution.bins.map((bin, index) => ({
      key: `num:${index}`,
      label: truncateLabel(bin.label),
      count: bin.count,
      kind: "numeric",
      bin,
      isLast: index === distribution.bins.length - 1,
    }));
  });

  let maxCount = $derived.by(() => {
    if (chartRows.length === 0) return 0;
    return chartRows.reduce(
      (currentMax, row) => Math.max(currentMax, row.count),
      0,
    );
  });

  let svgHeight = $derived(
    TOP_PADDING + BOTTOM_PADDING + chartRows.length * ROW_HEIGHT,
  );

  let activeValueClause = $derived.by(() => {
    if (!selectedComponent || !selectedField) return null;

    const clauses = world.activeQuery?.clauses ?? [];
    for (let index = clauses.length - 1; index >= 0; index -= 1) {
      const clause = clauses[index];
      if (!isValueClause(clause)) continue;
      if (
        clause.component === selectedComponent
        && clause.field === selectedField
      ) {
        return clause;
      }
    }

    return null;
  });

  function isValueClause(clause: QueryClause): clause is ValueClause {
    return clause.type === "value_eq" || clause.type === "value_range";
  }

  function clausesEqual(left: QueryClause, right: QueryClause): boolean {
    if (!isValueClause(left) || !isValueClause(right)) return false;
    if (left.type !== right.type) return false;
    if (left.component !== right.component) return false;
    if (left.field !== right.field) return false;

    if (left.type === "value_eq" && right.type === "value_eq") {
      return left.value === right.value;
    }

    if (left.type === "value_range" && right.type === "value_range") {
      return left.min === right.min && left.max === right.max;
    }

    return false;
  }

  function truncateLabel(label: string): string {
    const MAX_LABEL_LENGTH = 18;
    if (label.length <= MAX_LABEL_LENGTH) return label;
    return `${label.slice(0, MAX_LABEL_LENGTH - 3)}...`;
  }

  function barWidth(count: number): number {
    if (count <= 0 || maxCount <= 0) return 0;
    return Math.max(1, (count / maxCount) * BAR_WIDTH);
  }

  function rowY(index: number): number {
    return TOP_PADDING + index * ROW_HEIGHT;
  }

  function isRowActive(row: ChartRow): boolean {
    if (!activeValueClause) return false;

    if (row.kind === "categorical") {
      return activeValueClause.type === "value_eq"
        && activeValueClause.value === row.bin.value;
    }

    if (activeValueClause.type !== "value_range") return false;
    const rowMax = row.isLast ? Infinity : row.bin.max;
    return activeValueClause.min === row.bin.min && activeValueClause.max === rowMax;
  }

  function applyValueClause(nextClause: QueryClause): void {
    const existingClauses = world.activeQuery?.clauses ?? [];
    const retainedClauses = existingClauses.filter((clause) => {
      if (!isValueClause(clause)) return true;
      return !(
        clause.component === selectedComponent
        && clause.field === selectedField
      );
    });

    const isToggleOff = existingClauses.some((clause) => clausesEqual(clause, nextClause));
    if (isToggleOff) {
      if (retainedClauses.length === 0) {
        world.clearQuery();
        return;
      }

      world.setQuery({
        name: world.activeQuery?.name ?? "",
        clauses: retainedClauses,
      });
      return;
    }

    world.setQuery({
      name: world.activeQuery?.name ?? "",
      clauses: [...retainedClauses, nextClause],
    });
  }

  function onRowClick(row: ChartRow): void {
    if (!selectedComponent || !selectedField) return;

    if (row.kind === "categorical") {
      applyValueClause({
        type: "value_eq",
        component: selectedComponent,
        field: selectedField,
        value: row.bin.value,
      });
      return;
    }

    applyValueClause({
      type: "value_range",
      component: selectedComponent,
      field: selectedField,
      min: row.bin.min,
      max: row.isLast ? Infinity : row.bin.max,
    });
  }

  function onRowKeydown(event: KeyboardEvent, row: ChartRow): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onRowClick(row);
  }
</script>

<div class="flex h-full flex-1 flex-col p-3">
  {#if availableComponents.length === 0}
    <div
      class="flex flex-1 items-center justify-center text-sm text-text-muted"
      data-testid="inspector-empty"
    >
      No entities available
    </div>
  {:else}
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-medium text-text-primary" data-testid="distribution-title">
        Value Distribution
      </h3>
      {#if distribution}
        <span class="text-xs text-text-muted" data-testid="distribution-count">
          {distribution.totalWithComponent - distribution.missingCount}/{distribution.totalWithComponent}
        </span>
      {/if}
    </div>

    <div class="mt-3 grid grid-cols-1 gap-2">
      <label class="text-xs text-text-muted" for="distribution-component-select">
        Component
      </label>
      <select
        id="distribution-component-select"
        bind:value={selectedComponent}
        class="rounded border border-bg-tertiary bg-bg-primary px-2 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none"
        data-testid="distribution-component-select"
      >
        {#each availableComponents as component (component)}
          <option value={component}>{component}</option>
        {/each}
      </select>

      <label class="text-xs text-text-muted" for="distribution-field-select">
        Field
      </label>
      <select
        id="distribution-field-select"
        bind:value={selectedField}
        class="rounded border border-bg-tertiary bg-bg-primary px-2 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none"
        data-testid="distribution-field-select"
        disabled={availableFields.length === 0}
      >
        {#if availableFields.length === 0}
          <option value="">No fields</option>
        {:else}
          {#each availableFields as field (field)}
            <option value={field}>{field}</option>
          {/each}
        {/if}
      </select>
    </div>

    <div
      class="mt-3 min-h-0 flex-1 overflow-y-auto rounded border border-bg-tertiary bg-bg-primary/40 p-2"
      data-testid="distribution-chart"
    >
      {#if chartRows.length === 0}
        <div class="flex h-24 items-center justify-center text-sm text-text-muted" data-testid="distribution-empty">
          No values for this field
        </div>
      {:else}
        <svg
          class="w-full"
          width={SVG_WIDTH}
          height={svgHeight}
          viewBox={`0 0 ${SVG_WIDTH} ${svgHeight}`}
          role="img"
          aria-label="Component value distribution"
        >
          {#each chartRows as row, index (row.key)}
            <text
              x={LABEL_X}
              y={rowY(index) + ROW_HEIGHT / 2 + 4}
              font-size="11"
              fill="rgb(148 163 184)"
              pointer-events="none"
            >
              {row.label}
            </text>

            <rect
              x={BAR_X}
              y={rowY(index) + (ROW_HEIGHT - BAR_HEIGHT) / 2}
              width={barWidth(row.count)}
              height={BAR_HEIGHT}
              rx="3"
              fill={isRowActive(row) ? "rgb(96 165 250)" : "rgb(59 130 246 / 0.65)"}
              pointer-events="none"
            />

            <text
              x={COUNT_X}
              y={rowY(index) + ROW_HEIGHT / 2 + 4}
              font-size="11"
              fill="rgb(226 232 240)"
              pointer-events="none"
            >
              {row.count}
            </text>

            <rect
              x={0}
              y={rowY(index)}
              width={SVG_WIDTH}
              height={ROW_HEIGHT}
              fill="transparent"
              class="cursor-pointer"
              data-testid="distribution-bar"
              tabindex="0"
              role="button"
              aria-label={`Filter by ${row.label}`}
              onclick={() => onRowClick(row)}
              onkeydown={(event) => onRowKeydown(event, row)}
            />
          {/each}
        </svg>
      {/if}
    </div>

    {#if distribution && distribution.missingCount > 0}
      <div class="mt-2 text-xs text-text-muted" data-testid="distribution-missing">
        {distribution.missingCount} entities missing this field
      </div>
    {/if}
  {/if}
</div>
