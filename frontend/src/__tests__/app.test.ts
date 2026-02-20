import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/svelte";
import App from "../App.svelte";
import { world } from "../lib/state/world.svelte";
import { MockWebSocket } from "./helpers";

describe("App", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    world.disconnect();
    vi.restoreAllMocks();
  });

  it("renders and shows connecting state", () => {
    render(App);
    expect(screen.getByText("Connecting...")).toBeTruthy();
  });

  it("shows connected UI with tabs after connection", async () => {
    render(App);

    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    // Send metadata + snapshot to fully connect
    ws.simulateMessage({
      type: "metadata",
      tick: 0,
      config: {
        world_name: "Test",
        archetypes: [],
        component_metrics: [],
        field_hints: { status_fields: [], error_fields: [] },
        chat_enabled: false,
        entity_label_template: null,
        color_palette: null,
      },
      tick_range: [0, 5],
      supports_history: false,
      is_paused: false,
    });

    ws.simulateMessage({
      type: "snapshot",
      tick: 1,
      snapshot: {
        tick: 1,
        timestamp: Date.now() / 1000,
        entity_count: 3,
        entities: [],
        archetypes: [],
        metadata: {},
      },
    });

    // Wait for reactivity
    await vi.waitFor(() => {
      expect(screen.getByText("Test")).toBeTruthy();
    });

    const tablist = screen.getByRole("tablist");
    expect(tablist).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    const tabLabels = tabs.map((t) => t.textContent?.trim().replace(/\s+\d+$/, ""));
    expect(tabLabels).toContain("Entities");
    expect(tabLabels).toContain("Traces");
    expect(tabLabels).toContain("Timeline");
    expect(tabLabels).toContain("Archetypes");
  });

  it("renders TimelineBar in connected state", async () => {
    render(App);

    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    ws.simulateMessage({
      type: "metadata",
      tick: 0,
      config: {
        world_name: "Test",
        archetypes: [],
        component_metrics: [],
        field_hints: { status_fields: [], error_fields: [] },
        chat_enabled: false,
        entity_label_template: null,
        color_palette: null,
      },
      tick_range: [0, 5],
      supports_history: true,
      is_paused: false,
    });

    ws.simulateMessage({
      type: "snapshot",
      tick: 1,
      snapshot: {
        tick: 1,
        timestamp: Date.now() / 1000,
        entity_count: 0,
        entities: [],
        archetypes: [],
        metadata: {},
      },
    });

    await vi.waitFor(() => {
      expect(screen.getByRole("toolbar")).toBeTruthy();
    });
  });

  it("shows token totals and budget warning in header", async () => {
    render(App);

    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    ws.simulateMessage({
      type: "metadata",
      tick: 0,
      config: {
        world_name: "Test",
        archetypes: [],
        component_metrics: [],
        field_hints: { status_fields: [], error_fields: [] },
        chat_enabled: false,
        entity_label_template: null,
        color_palette: null,
      },
      tick_range: [0, 5],
      supports_history: true,
      is_paused: false,
    });

    ws.simulateMessage({
      type: "snapshot",
      tick: 3,
      snapshot: {
        tick: 3,
        timestamp: Date.now() / 1000,
        entity_count: 3,
        entities: [],
        archetypes: [],
        metadata: {},
      },
    });

    ws.simulateMessage({
      type: "span_event",
      span_id: "span1",
      trace_id: "trace1",
      parent_span_id: null,
      name: "llm.gpt-4o",
      start_time: 1,
      end_time: 1.2,
      status: "ok",
      attributes: {
        "agentecs.tick": 1,
        "agentecs.entity_id": 1,
        "gen_ai.request.model": "gpt-4o",
        "gen_ai.usage.input_tokens": 100,
        "gen_ai.usage.output_tokens": 50,
        "llm.cost.total": 2,
      },
    });

    await vi.waitFor(() => {
      const header = screen.getByRole("banner");
      expect(header.textContent).toContain("150 tokens");
      expect(header.textContent).toContain("$2.00 cost");
      expect(screen.getByTestId("cost-budget-warning")).toBeTruthy();
    });
  });

  it("shows error state when connection fails", async () => {
    render(App);

    const ws = MockWebSocket.instances[0];
    ws.onerror?.(new Event("error"));
    ws.close();

    await vi.waitFor(() => {
      expect(screen.getByText("Connection failed")).toBeTruthy();
    });

    expect(screen.getByText("Retry")).toBeTruthy();
  });
});
