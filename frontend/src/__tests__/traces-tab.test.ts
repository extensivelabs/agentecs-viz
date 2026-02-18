import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import TracesTab from "../lib/TracesTab.svelte";
import { world } from "../lib/state/world.svelte";
import { MockWebSocket, makeSnapshot, makeSpanEvent } from "./helpers";
import type { SnapshotMessage, SpanEventMessage } from "../lib/types";

describe("TracesTab", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    world.connect("ws://test/ws");
    MockWebSocket.instances[0].simulateOpen();
  });

  afterEach(() => {
    world.disconnect();
    vi.restoreAllMocks();
  });

  function sendSnapshot(tick: number) {
    const snapshot = makeSnapshot({ tick });
    MockWebSocket.instances[0].simulateMessage({
      type: "snapshot",
      tick,
      snapshot,
    } satisfies SnapshotMessage);
  }

  function sendSpan(tick: number, entityId: number, overrides: Partial<SpanEventMessage> = {}) {
    MockWebSocket.instances[0].simulateMessage(makeSpanEvent(tick, entityId, overrides));
  }

  it("shows empty state when no spans", () => {
    sendSnapshot(1);
    render(TracesTab);
    expect(screen.getByTestId("traces-empty")).toBeDefined();
    expect(screen.getByText("No spans recorded")).toBeDefined();
  });

  it("renders span rows", () => {
    sendSnapshot(3);
    sendSpan(1, 1, { name: "llm.gpt-4o", span_id: "s1" });
    sendSpan(2, 2, { name: "tool.search", span_id: "s2" });

    render(TracesTab);
    const rows = screen.getAllByTestId("span-row");
    expect(rows.length).toBe(2);
  });

  it("clicking span selects it", async () => {
    sendSnapshot(3);
    sendSpan(1, 1, { name: "llm.gpt-4o", span_id: "target" });

    render(TracesTab);
    const row = screen.getByTestId("span-row");
    await fireEvent.click(row);

    expect(world.selectedSpanId).toBe("target");
  });

  it("shows entity filter bar when entity selected", () => {
    sendSnapshot(3);
    sendSpan(1, 1, { span_id: "s1" });
    sendSpan(1, 2, { span_id: "s2" });
    world.selectEntity(1);

    render(TracesTab);
    expect(screen.getByTestId("entity-filter-bar")).toBeDefined();
  });

  it("shows span detail empty state when no span selected", () => {
    sendSnapshot(1);
    render(TracesTab);
    expect(screen.getByTestId("span-detail-empty")).toBeDefined();
    expect(screen.getByText("Select a span to view details")).toBeDefined();
  });

  it("shows LLM detail for selected LLM span", () => {
    sendSnapshot(3);
    sendSpan(1, 1, {
      span_id: "llm-span",
      name: "llm.gpt-4o",
      attributes: {
        "agentecs.tick": 1,
        "agentecs.entity_id": 1,
        "gen_ai.request.model": "gpt-4o",
        "gen_ai.usage.prompt_tokens": 100,
        "gen_ai.usage.completion_tokens": 50,
        "gen_ai.request.messages": [{ role: "user", content: "Hello" }],
        "gen_ai.response.messages": [{ role: "assistant", content: "Hi" }],
      },
    });
    world.selectSpan("llm-span");

    render(TracesTab);
    expect(screen.getByTestId("llm-detail")).toBeDefined();
    expect(screen.getByText("gpt-4o")).toBeDefined();
  });
});
