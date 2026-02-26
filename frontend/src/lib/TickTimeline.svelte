<script lang="ts">
  import { world } from "./state/world.svelte";
  import {
    SPAN_TYPE_COLORS,
    buildSpanTree,
    detectSpanType,
    flattenTree,
    formatDuration,
    getSpanDurationMs,
    type SpanTreeNode,
    type SpanType,
  } from "./traces";
  import type { SpanEventMessage } from "./types";

  interface Props {
    spans: SpanEventMessage[];
  }

  interface TimelineRow {
    node: SpanTreeNode;
    type: SpanType;
    y: number;
    barY: number;
    barHeight: number;
    x: number;
    width: number;
    labelX: number;
    durationMs: number;
    selected: boolean;
  }

  interface TooltipState {
    x: number;
    y: number;
    name: string;
    duration: string;
  }

  interface TimeRange {
    min: number;
    max: number;
    duration: number;
  }

  let { spans }: Props = $props();

  const HEADER_HEIGHT = 28;
  const ROW_HEIGHT = 28;
  const GROUP_GAP = 8;
  const LEFT_LABEL_WIDTH = 176;
  const HORIZONTAL_PADDING = 12;
  const ROOT_BAR_HEIGHT = 20;
  const CHILD_BAR_HEIGHT = 16;
  const MIN_BAR_WIDTH = 2;

  let containerWidth = $state(0);
  let tooltip = $state<TooltipState | null>(null);

  let tree = $derived(buildSpanTree(spans));
  let flatNodes = $derived(flattenTree(tree));
  let svgWidth = $derived(containerWidth > 0 ? containerWidth : 720);
  let barAreaLeft = $derived(LEFT_LABEL_WIDTH + HORIZONTAL_PADDING);
  let barAreaWidth = $derived(
    Math.max(120, svgWidth - barAreaLeft - HORIZONTAL_PADDING),
  );

  let rootIndexBySpanId = $derived.by(() => {
    const map = new Map<string, number>();

    function assignRootIndex(node: SpanTreeNode, rootIndex: number): void {
      map.set(node.span.span_id, rootIndex);
      for (const child of node.children) {
        assignRootIndex(child, rootIndex);
      }
    }

    tree.forEach((root, index) => {
      assignRootIndex(root, index);
    });

    return map;
  });

  let timeRange = $derived.by((): TimeRange | null => {
    if (spans.length === 0) return null;

    let min = Infinity;
    let max = -Infinity;
    for (const span of spans) {
      if (span.start_time < min) min = span.start_time;
      if (span.end_time > max) max = span.end_time;
    }

    const rawDuration = max - min;
    return {
      min,
      max,
      duration: rawDuration > 0 ? rawDuration : 1e-9,
    };
  });

  let rows = $derived.by((): TimelineRow[] => {
    if (!timeRange || flatNodes.length === 0) return [];

    const timelineRows: TimelineRow[] = [];
    let currentY = HEADER_HEIGHT;
    let previousRootIndex = -1;

    for (const node of flatNodes) {
      const rootIndex = rootIndexBySpanId.get(node.span.span_id) ?? 0;
      if (rootIndex !== previousRootIndex && previousRootIndex !== -1) {
        currentY += GROUP_GAP;
      }

      const type = detectSpanType(node.span.attributes);
      const barHeight = node.depth === 0 ? ROOT_BAR_HEIGHT : CHILD_BAR_HEIGHT;
      const durationMs = getSpanDurationMs(node.span);
      const startRatio = (node.span.start_time - timeRange.min) / timeRange.duration;
      const spanRatio = (node.span.end_time - node.span.start_time) / timeRange.duration;
      const x = barAreaLeft + Math.max(0, Math.min(1, startRatio)) * barAreaWidth;
      const maxWidth = barAreaLeft + barAreaWidth - x;
      const width = Math.max(
        MIN_BAR_WIDTH,
        Math.min(spanRatio * barAreaWidth, maxWidth),
      );

      timelineRows.push({
        node,
        type,
        y: currentY,
        barY: currentY + (ROW_HEIGHT - barHeight) / 2,
        barHeight,
        x,
        width,
        labelX: HORIZONTAL_PADDING + node.depth * 16,
        durationMs,
        selected: world.selectedSpanId === node.span.span_id,
      });

      currentY += ROW_HEIGHT;
      previousRootIndex = rootIndex;
    }

    return timelineRows;
  });

  let svgHeight = $derived(
    rows.length === 0
      ? 220
      : rows[rows.length - 1].y + ROW_HEIGHT + HORIZONTAL_PADDING,
  );

  let axisMarkers = $derived.by(() => {
    if (!timeRange || rows.length === 0) return [];

    const markerRatios = [0, 0.25, 0.5, 0.75, 1];
    return markerRatios.map((ratio) => ({
      x: barAreaLeft + ratio * barAreaWidth,
      label: `+${formatDuration(timeRange.duration * ratio * 1000)}`,
    }));
  });

  function truncateLabel(value: string, maxLength = 28): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength - 3)}...`;
  }

  function showTooltip(event: MouseEvent, row: TimelineRow): void {
    const container = (event.currentTarget as SVGElement)?.closest(
      "[data-testid='tick-timeline']",
    );
    if (!(container instanceof HTMLElement)) return;

    const rect = container.getBoundingClientRect();
    tooltip = {
      x: Math.min(event.clientX - rect.left + 12, Math.max(12, svgWidth - 220)),
      y: Math.max(8, event.clientY - rect.top + 12),
      name: row.node.span.name,
      duration: formatDuration(row.durationMs),
    };
  }

  function clearTooltip(): void {
    tooltip = null;
  }

  function handleBarKeydown(event: KeyboardEvent, spanId: string): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      world.selectSpan(spanId);
    }
  }
</script>

<div class="relative w-full" bind:clientWidth={containerWidth} data-testid="tick-timeline">
  {#if rows.length === 0}
    <div
      class="flex h-56 items-center justify-center text-sm text-text-muted"
      data-testid="timeline-empty"
    >
      No spans for this tick
    </div>
  {:else}
    <svg
      class="w-full"
      width={svgWidth}
      height={svgHeight}
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      role="img"
      aria-label="Tick execution timeline"
    >
      <line
        x1={barAreaLeft}
        y1={HEADER_HEIGHT - 4}
        x2={barAreaLeft + barAreaWidth}
        y2={HEADER_HEIGHT - 4}
        stroke="rgba(148, 163, 184, 0.5)"
        stroke-width="1"
      />

      {#each axisMarkers as marker (marker.x)}
        <line
          x1={marker.x}
          y1={HEADER_HEIGHT - 4}
          x2={marker.x}
          y2={svgHeight - HORIZONTAL_PADDING}
          stroke="rgba(148, 163, 184, 0.2)"
          stroke-width="1"
        />
        <text
          x={marker.x}
          y="12"
          font-size="11"
          text-anchor="middle"
          fill="rgb(148 163 184)"
        >
          {marker.label}
        </text>
      {/each}

      {#each rows as row (row.node.span.span_id)}
        <text
          x={row.labelX}
          y={row.y + ROW_HEIGHT / 2 + 4}
          font-size="12"
          fill="rgb(226 232 240)"
        >
          {truncateLabel(row.node.span.name)}
        </text>

        <rect
          x={row.x}
          y={row.barY}
          width={row.width}
          height={row.barHeight}
          rx="3"
          fill={SPAN_TYPE_COLORS[row.type]}
          fill-opacity={row.node.depth === 0 ? 0.92 : 0.78}
          stroke={row.selected ? "#60a5fa" : "transparent"}
          stroke-width={row.selected ? "2" : "0"}
          class="cursor-pointer"
          data-testid="timeline-bar"
          data-span-id={row.node.span.span_id}
          onclick={() => world.selectSpan(row.node.span.span_id)}
          onkeydown={(event) => handleBarKeydown(event, row.node.span.span_id)}
          onmousemove={(event) => showTooltip(event, row)}
          onmouseleave={clearTooltip}
          tabindex="0"
          role="button"
          aria-label={`${row.node.span.name} ${formatDuration(row.durationMs)}`}
        />

        <text
          x={Math.min(row.x + row.width + 6, barAreaLeft + barAreaWidth - 4)}
          y={row.y + ROW_HEIGHT / 2 + 4}
          font-size="11"
          fill="rgb(148 163 184)"
        >
          {formatDuration(row.durationMs)}
        </text>
      {/each}
    </svg>
  {/if}

  {#if tooltip}
    <div
      class="pointer-events-none absolute z-10 rounded border border-bg-tertiary bg-bg-primary/95 px-2 py-1 text-xs text-text-secondary shadow-lg"
      style={`left: ${tooltip.x}px; top: ${tooltip.y}px;`}
      data-testid="timeline-tooltip"
    >
      <div class="font-medium text-text-primary">{tooltip.name}</div>
      <div>{tooltip.duration}</div>
    </div>
  {/if}
</div>
