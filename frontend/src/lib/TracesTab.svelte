<script lang="ts">
  import { world } from "./state/world.svelte";
  import JsonTree from "./JsonTree.svelte";
  import {
    detectSpanType,
    getModelName,
    getTokenCounts,
    getSpanDurationMs,
    buildSpanTree,
    SPAN_TYPE_COLORS,
    type SpanTreeNode,
    type SpanType,
  } from "./traces";
  import type { SpanEventMessage } from "./types";

  let entityFilter = $derived(world.selectedEntityId !== null);
  let displaySpans = $derived(
    entityFilter ? world.selectedEntitySpans : world.visibleSpans,
  );

  let spansByTick = $derived.by(() => {
    const grouped = new Map<number, SpanEventMessage[]>();
    for (const span of displaySpans) {
      const rawTick = span.attributes["agentecs.tick"];
      if (typeof rawTick !== "number") continue;
      if (!grouped.has(rawTick)) grouped.set(rawTick, []);
      grouped.get(rawTick)!.push(span);
    }
    return [...grouped.entries()].sort((a, b) => b[0] - a[0]);
  });

  let selectedSpan = $derived(world.selectedSpan);
  let selectedSpanType = $derived(
    selectedSpan ? detectSpanType(selectedSpan.attributes) : null,
  );
  let selectedSpanModel = $derived(
    selectedSpan ? getModelName(selectedSpan.attributes) : null,
  );
  let selectedSpanTokens = $derived(
    selectedSpan ? getTokenCounts(selectedSpan.attributes) : null,
  );

  function flattenTree(nodes: SpanTreeNode[]): SpanTreeNode[] {
    const result: SpanTreeNode[] = [];
    function walk(node: SpanTreeNode) {
      result.push(node);
      for (const child of node.children) walk(child);
    }
    for (const n of nodes) walk(n);
    return result;
  }

  function tickTimeRange(spans: SpanEventMessage[]): [number, number] {
    let min = Infinity;
    let max = -Infinity;
    for (const s of spans) {
      if (s.start_time < min) min = s.start_time;
      if (s.end_time > max) max = s.end_time;
    }
    return [min, max];
  }

  function barStyle(
    span: SpanEventMessage,
    range: [number, number],
  ): string {
    const total = range[1] - range[0];
    if (total <= 0) return "left: 0%; width: 100%;";
    const left = ((span.start_time - range[0]) / total) * 100;
    const width = ((span.end_time - span.start_time) / total) * 100;
    return `left: ${left.toFixed(1)}%; width: ${Math.max(width, 0.5).toFixed(1)}%;`;
  }

  function spanTypeLabel(type: SpanType): string {
    return type.toUpperCase();
  }

  function formatDuration(ms: number): string {
    if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  function spanMessages(span: SpanEventMessage): Array<Record<string, string>> {
    const input = span.attributes["gen_ai.request.messages"];
    const output = span.attributes["gen_ai.response.messages"];
    const msgs: Array<Record<string, string>> = [];
    if (Array.isArray(input)) msgs.push(...(input as Array<Record<string, string>>));
    if (Array.isArray(output)) msgs.push(...(output as Array<Record<string, string>>));
    return msgs;
  }

  function statusDotColor(status: string): string {
    if (status === "ok") return "bg-success";
    if (status === "error") return "bg-error";
    return "bg-text-muted";
  }
</script>

<div class="flex h-full" data-testid="traces-tab">
  <div class="min-w-0 flex-1 overflow-y-auto">
    {#if entityFilter}
      <div
        class="flex items-center gap-2 border-b border-bg-tertiary px-4 py-1.5"
        data-testid="entity-filter-bar"
      >
        <span class="text-xs text-text-muted">
          Filtered: Entity #{world.selectedEntityId}
        </span>
        <button
          class="text-xs text-text-secondary hover:text-text-primary"
          onclick={() => world.selectEntity(null)}
        >
          Clear
        </button>
      </div>
    {/if}

    {#if displaySpans.length === 0}
      <div
        class="flex h-full items-center justify-center text-sm text-text-muted"
        data-testid="traces-empty"
      >
        No spans recorded
      </div>
    {:else}
      {#each spansByTick as [tick, tickSpans] (tick)}
        {@const tree = buildSpanTree(tickSpans)}
        {@const flat = flattenTree(tree)}
        {@const range = tickTimeRange(tickSpans)}
        <div class="border-b border-bg-tertiary">
          <div class="px-4 py-1 text-[10px] font-medium text-text-muted">
            Tick {tick}
            <span class="ml-1 text-text-muted/50">
              ({tickSpans.length} {tickSpans.length === 1 ? "span" : "spans"})
            </span>
          </div>
          {#each flat as node (node.span.span_id)}
            {@const type = detectSpanType(node.span.attributes)}
            {@const duration = getSpanDurationMs(node.span)}
            {@const isSelected = node.span.span_id === world.selectedSpanId}
            <button
              class="flex w-full items-center gap-2 px-4 py-1 text-left text-xs hover:bg-bg-tertiary/50 {isSelected ? 'bg-accent/10' : ''}"
              style:padding-left={`${16 + node.depth * 16}px`}
              onclick={() => world.selectSpan(node.span.span_id)}
              data-testid="span-row"
            >
              <span
                class="inline-block shrink-0 rounded px-1 py-0.5 text-[10px] font-medium text-white"
                style:background-color={SPAN_TYPE_COLORS[type]}
              >
                {spanTypeLabel(type)}
              </span>
              <span class="min-w-0 truncate text-text-primary">
                {node.span.name}
              </span>
              <span class="shrink-0 text-text-muted">
                {formatDuration(duration)}
              </span>
              <div class="relative ml-auto h-3 w-24 shrink-0 rounded bg-bg-tertiary">
                <div
                  class="absolute top-0 h-full rounded opacity-70"
                  style="{barStyle(node.span, range)} background-color: {SPAN_TYPE_COLORS[type]};"
                ></div>
              </div>
            </button>
          {/each}
        </div>
      {/each}
    {/if}
  </div>

  <aside
    class="flex h-full w-[360px] shrink-0 flex-col border-l border-bg-tertiary bg-bg-secondary"
    data-testid="span-detail"
  >
    {#if selectedSpan}
      <div class="border-b border-bg-tertiary px-4 py-3">
        <div class="flex items-center gap-2">
          <span
            class="inline-block h-2 w-2 rounded-full {statusDotColor(selectedSpan.status)}"
          ></span>
          <span class="text-sm font-medium text-text-primary">
            {selectedSpan.name}
          </span>
        </div>
        <div class="mt-1 flex items-center gap-2">
          {#if selectedSpanType}
            <span
              class="rounded px-1 py-0.5 text-[10px] font-medium text-white"
              style:background-color={SPAN_TYPE_COLORS[selectedSpanType]}
            >
              {spanTypeLabel(selectedSpanType)}
            </span>
          {/if}
          <span class="text-xs text-text-muted">
            {formatDuration(getSpanDurationMs(selectedSpan))}
          </span>
          <span class="text-xs text-text-muted/50">
            {selectedSpan.status}
          </span>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto">
        {#if selectedSpanType === "llm"}
          <div class="border-b border-bg-tertiary px-4 py-2" data-testid="llm-detail">
            {#if selectedSpanModel}
              <div class="mb-2">
                <span class="rounded-full bg-purple-500/20 px-2 py-0.5 text-xs text-purple-400">
                  {selectedSpanModel}
                </span>
              </div>
            {/if}
            {#if selectedSpanTokens && selectedSpanTokens.total !== null}
              <div class="flex gap-3 text-xs text-text-muted">
                <span>Prompt: <span class="text-text-secondary">{selectedSpanTokens.prompt}</span></span>
                <span>Completion: <span class="text-text-secondary">{selectedSpanTokens.completion}</span></span>
                <span>Total: <span class="text-text-secondary">{selectedSpanTokens.total}</span></span>
              </div>
            {/if}
            {#if selectedSpan.attributes["gen_ai.request.messages"]}
              {@const msgs = spanMessages(selectedSpan)}
              <div class="mt-2">
                <div class="mb-1 text-[10px] font-medium text-text-muted">Messages</div>
                {#each msgs as msg, i (i)}
                  <div
                    class="mb-1 rounded px-2 py-1 text-xs {msg.role === 'user' ? 'bg-accent/10' : msg.role === 'assistant' ? 'bg-purple-500/10' : 'bg-bg-tertiary'}"
                  >
                    <span class="text-[10px] font-medium text-text-muted">{msg.role}</span>
                    <div class="text-text-secondary">{msg.content}</div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}

        {#if selectedSpanType === "tool"}
          <div class="border-b border-bg-tertiary px-4 py-2" data-testid="tool-detail">
            {#if selectedSpan.attributes["tool.name"]}
              <div class="mb-2">
                <span class="rounded-full bg-cyan-500/20 px-2 py-0.5 text-xs text-cyan-400">
                  {selectedSpan.attributes["tool.name"]}
                </span>
              </div>
            {/if}
            {#if selectedSpan.attributes["tool.input"]}
              <div class="mb-1 text-[10px] font-medium text-text-muted">Input</div>
              <div class="mb-2">
                <JsonTree data={selectedSpan.attributes["tool.input"] as Record<string, unknown>} />
              </div>
            {/if}
            {#if selectedSpan.attributes["tool.output"]}
              <div class="mb-1 text-[10px] font-medium text-text-muted">Output</div>
              <div>
                <JsonTree data={selectedSpan.attributes["tool.output"] as Record<string, unknown>} />
              </div>
            {/if}
          </div>
        {/if}

        {#if selectedSpanType === "system"}
          <div class="border-b border-bg-tertiary px-4 py-2" data-testid="system-detail">
            {#if selectedSpan.attributes["agentecs.system"]}
              <span class="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-400">
                {selectedSpan.attributes["agentecs.system"]}
              </span>
            {/if}
          </div>
        {/if}

        <div class="px-4 py-2">
          <div class="mb-1 text-[10px] font-medium text-text-muted">Attributes</div>
          <JsonTree data={selectedSpan.attributes as Record<string, unknown>} />
        </div>
      </div>
    {:else}
      <div
        class="flex flex-1 items-center justify-center text-xs text-text-muted"
        data-testid="span-detail-empty"
      >
        Select a span to view details
      </div>
    {/if}
  </aside>
</div>
