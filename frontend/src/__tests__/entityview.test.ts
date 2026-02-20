import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/svelte";
import EntityView from "../lib/EntityView.svelte";
import { world } from "../lib/state/world.svelte";
import { MockWebSocket } from "./helpers";

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

  it("renders zoom control buttons", () => {
    const { container } = render(EntityView);
    const buttons = container.querySelectorAll("button");
    const labels = [...buttons].map((b) => b.getAttribute("aria-label"));
    expect(labels).toContain("Zoom in");
    expect(labels).toContain("Zoom out");
    expect(labels).toContain("Reset view");
  });

  it("renders layout mode toggle with spatial and pipeline buttons", () => {
    const { container } = render(EntityView);
    const toggle = container.querySelector("[data-testid='layout-mode-toggle']");
    expect(toggle).toBeTruthy();
    const spatial = container.querySelector("[data-testid='layout-spatial']");
    const pipeline = container.querySelector("[data-testid='layout-pipeline']");
    expect(spatial).toBeTruthy();
    expect(pipeline).toBeTruthy();
    expect(spatial!.textContent?.trim()).toBe("spatial");
    expect(pipeline!.textContent?.trim()).toBe("pipeline");
  });
});
