import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
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

  it("switches between list and timeline views", async () => {
    sendSnapshot(3);
    sendSpan(1, 1, { name: "llm.gpt-4o", span_id: "s1" });
    sendSpan(2, 2, { name: "tool.search", span_id: "s2" });

    render(TracesTab);
    expect(screen.getByRole("radiogroup", { name: "Traces view mode" })).toBeDefined();
    expect(screen.getByRole("radio", { name: "List" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getAllByTestId("span-row").length).toBe(2);

    await fireEvent.click(screen.getByTestId("traces-view-timeline"));
    expect(screen.getByRole("radio", { name: "Timeline" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByTestId("timeline-view")).toBeDefined();
    expect(screen.getByTestId("tick-timeline")).toBeDefined();

    await fireEvent.click(screen.getByTestId("traces-view-list"));
    expect(screen.getAllByTestId("span-row").length).toBe(2);
  });

  it("navigates timeline ticks with arrow controls", async () => {
    sendSnapshot(4);
    sendSpan(1, 1, { name: "span-1", span_id: "s1" });
    sendSpan(2, 1, { name: "span-2", span_id: "s2" });
    sendSpan(3, 1, { name: "span-3", span_id: "s3" });

    render(TracesTab);
    await fireEvent.click(screen.getByTestId("traces-view-timeline"));

    expect(screen.getByTestId("timeline-current-tick").textContent).toContain(
      "Tick 3",
    );

    await fireEvent.click(screen.getByTestId("timeline-tick-older"));
    expect(screen.getByTestId("timeline-current-tick").textContent).toContain(
      "Tick 2",
    );

    await fireEvent.click(screen.getByTestId("timeline-tick-newer"));
    expect(screen.getByTestId("timeline-current-tick").textContent).toContain(
      "Tick 3",
    );
  });

  it("keeps selected timeline tick stable when new ticks arrive", async () => {
    sendSnapshot(4);
    sendSpan(1, 1, { name: "span-1", span_id: "s1" });
    sendSpan(2, 1, { name: "span-2", span_id: "s2" });

    render(TracesTab);
    await fireEvent.click(screen.getByTestId("traces-view-timeline"));

    await fireEvent.click(screen.getByTestId("timeline-tick-older"));
    expect(screen.getByTestId("timeline-current-tick").textContent).toContain(
      "Tick 1",
    );

    sendSpan(3, 1, { name: "span-3", span_id: "s3" });

    await waitFor(() => {
      expect(screen.getByTestId("timeline-current-tick").textContent).toContain(
        "Tick 1",
      );
    });
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

  it("renders non-string message content safely", () => {
    sendSnapshot(3);
    sendSpan(1, 1, {
      span_id: "llm-non-string",
      name: "llm.gpt-4o",
      attributes: {
        "agentecs.tick": 1,
        "agentecs.entity_id": 1,
        "gen_ai.request.model": "gpt-4o",
        "gen_ai.request.messages": [{ role: "user", content: { prompt: "Hello" } }],
        "gen_ai.response.messages": [{ role: "assistant", content: 42 }],
      },
    });
    world.selectSpan("llm-non-string");

    render(TracesTab);
    expect(screen.getByText('{"prompt":"Hello"}')).toBeDefined();
    expect(screen.getByText("42")).toBeDefined();
  });

  it("renders non-object tool input and output safely", () => {
    sendSnapshot(3);
    sendSpan(1, 1, {
      span_id: "tool-primitive",
      name: "tool.search",
      attributes: {
        "agentecs.tick": 1,
        "agentecs.entity_id": 1,
        "tool.name": "web_search",
        "tool.input": "query text",
        "tool.output": 7,
      },
    });
    world.selectSpan("tool-primitive");

    render(TracesTab);
    expect(screen.getByTestId("tool-detail")).toBeDefined();
    expect(screen.getByText("query text")).toBeDefined();
    expect(screen.getAllByText("7").length).toBeGreaterThan(0);
  });
});
