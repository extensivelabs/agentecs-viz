import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import InspectorPanel from "../lib/InspectorPanel.svelte";
import { world } from "../lib/state/world.svelte";
import { MockWebSocket, makeEntity, setWorldState } from "./helpers";

describe("InspectorPanel", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    world.selectEntity(null);
    world.disconnect();
    vi.restoreAllMocks();
  });

  it("shows empty state when no entity selected", () => {
    const { container } = render(InspectorPanel);
    const empty = container.querySelector("[data-testid='inspector-empty']");
    expect(empty).toBeTruthy();
    expect(empty!.textContent).toContain("Select an entity to inspect");
  });

  it("shows entity header with ID and archetype", () => {
    const entity = makeEntity(42, [
      { type_short: "Position", data: { x: 0, y: 0 } },
      { type_short: "Health", data: { hp: 100 } },
    ]);
    setWorldState([entity]);
    world.selectEntity(42);

    const { container } = render(InspectorPanel);
    expect(container.textContent).toContain("Entity #42");
    expect(container.textContent).toContain("Health, Position");
  });

  it("shows component count in metadata", () => {
    const entity = makeEntity(1, [
      { type_short: "A", data: { v: 1 } },
      { type_short: "B", data: { v: 2 } },
      { type_short: "C", data: { v: 3 } },
    ]);
    setWorldState([entity]);
    world.selectEntity(1);

    const { container } = render(InspectorPanel);
    expect(container.textContent).toContain("3 components");
  });

  it("renders a section for each component sorted by type_short", () => {
    const entity = makeEntity(1, [
      { type_short: "Zeta", data: { z: 1 } },
      { type_short: "Alpha", data: { a: 2 } },
    ]);
    setWorldState([entity]);
    world.selectEntity(1);

    const { container } = render(InspectorPanel);
    const sections = container.querySelectorAll("[data-testid='component-section']");
    expect(sections.length).toBe(2);

    const labels = [...sections].map((s) => s.querySelector("[data-testid='component-toggle']")!.textContent);
    // Alpha should come first
    expect(labels[0]).toContain("Alpha");
    expect(labels[1]).toContain("Zeta");
  });

  it("collapses component section on toggle click", async () => {
    const entity = makeEntity(1, [
      { type_short: "Pos", data: { x: 10, y: 20 } },
    ]);
    setWorldState([entity]);
    world.selectEntity(1);

    const { container } = render(InspectorPanel);

    expect(container.textContent).toContain("x:");
    expect(container.textContent).toContain("10");

    const toggle = container.querySelector("[data-testid='component-toggle']");
    expect(toggle).toBeTruthy();
    await fireEvent.click(toggle!);

    expect(container.textContent).not.toContain("x:");
  });

  it("shows systems placeholder", () => {
    const entity = makeEntity(1, [{ type_short: "A", data: {} }]);
    setWorldState([entity]);
    world.selectEntity(1);

    const { container } = render(InspectorPanel);
    const placeholder = container.querySelector("[data-testid='systems-placeholder']");
    expect(placeholder).toBeTruthy();
    expect(placeholder!.textContent).toContain("Systems (Phase 2)");
  });

  it("shows close button that deselects entity", async () => {
    const entity = makeEntity(1, [{ type_short: "A", data: {} }]);
    setWorldState([entity]);
    world.selectEntity(1);

    const { container } = render(InspectorPanel);
    const closeBtn = container.querySelector("[data-testid='inspector-close']");
    expect(closeBtn).toBeTruthy();

    await fireEvent.click(closeBtn!);
    expect(world.selectedEntityId).toBeNull();
  });

  it("updates when selected entity changes", async () => {
    const e1 = makeEntity(1, [{ type_short: "Foo", data: { val: "hello" } }]);
    const e2 = makeEntity(2, [{ type_short: "Bar", data: { val: "world" } }]);
    setWorldState([e1, e2]);
    world.selectEntity(1);

    const { container } = render(InspectorPanel);
    expect(container.textContent).toContain("Entity #1");
    expect(container.textContent).toContain("Foo");

    world.selectEntity(2);
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Entity #2");
    });
    expect(container.textContent).toContain("Bar");
  });
});
