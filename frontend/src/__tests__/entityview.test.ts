import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/svelte";
import EntityView from "../lib/EntityView.svelte";
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
  }
}

describe("EntityView", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("ResizeObserver", class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    });
  });

  afterEach(() => {
    world.disconnect();
    vi.restoreAllMocks();
  });

  it("renders the container div", () => {
    const { container } = render(EntityView);
    const el = container.querySelector("[data-testid='entity-view']");
    expect(el).toBeTruthy();
  });

  it("renders view level toggle buttons", () => {
    const { container } = render(EntityView);
    const buttons = container.querySelectorAll("button");
    const labels = [...buttons].map((b) => b.textContent?.trim());
    expect(labels).toContain("detail");
    expect(labels).toContain("auto");
    expect(labels).toContain("overview");
  });

  it("renders focus mode selector", () => {
    const { container } = render(EntityView);
    const select = container.querySelector("select");
    expect(select).toBeTruthy();
  });

  it("renders zoom control buttons", () => {
    const { container } = render(EntityView);
    const buttons = container.querySelectorAll("button");
    const labels = [...buttons].map((b) => b.getAttribute("aria-label"));
    expect(labels).toContain("Zoom in");
    expect(labels).toContain("Zoom out");
    expect(labels).toContain("Reset view");
  });
});
