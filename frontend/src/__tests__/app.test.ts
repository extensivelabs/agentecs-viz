import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/svelte";
import App from "../App.svelte";
import { world } from "../lib/state/world.svelte";

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  constructor(_url: string) {
    MockWebSocket.instances.push(this);
  }

  send(): void {}

  close(): void {
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close"));
  }

  simulateOpen(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  simulateMessage(data: unknown): void {
    this.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(data) }),
    );
  }
}

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
