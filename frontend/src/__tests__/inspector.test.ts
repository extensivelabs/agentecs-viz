import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import InspectorPanel from "../lib/InspectorPanel.svelte";
import { LOOP_DETECTION_THRESHOLD } from "../lib/config";
import { world } from "../lib/state/world.svelte";
import type { WorldSnapshot, VisualizationConfig, MetadataMessage, SnapshotMessage } from "../lib/types";
import { MockWebSocket, makeEntity, makeSnapshot, makeConfig, makeSpanEvent, setWorldState } from "./helpers";

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

  it("shows distribution empty state when no entities are available", () => {
    const { container } = render(InspectorPanel);
    const empty = container.querySelector("[data-testid='inspector-empty']");
    expect(empty).toBeTruthy();
    expect(empty!.textContent).toContain("No entities available");
  });

  it("shows distribution controls when entities exist and nothing is selected", () => {
    setWorldState([
      makeEntity(1, [{ type_short: "Agent", data: { state: "idle" } }]),
      makeEntity(2, [{ type_short: "Agent", data: { state: "working" } }]),
    ]);

    const { container } = render(InspectorPanel);
    expect(container.querySelector("[data-testid='distribution-title']")).toBeTruthy();
    expect(container.querySelector("[data-testid='distribution-component-select']")).toBeTruthy();
    expect(container.querySelector("[data-testid='distribution-field-select']")).toBeTruthy();
  });

  it("applies a value filter when a distribution bar is clicked", async () => {
    setWorldState([
      makeEntity(1, [{ type_short: "Agent", data: { state: "idle" } }]),
      makeEntity(2, [{ type_short: "Agent", data: { state: "working" } }]),
      makeEntity(3, [{ type_short: "Agent", data: { state: "idle" } }]),
    ]);

    const { container } = render(InspectorPanel);
    const bars = container.querySelectorAll("[data-testid='distribution-bar']");
    expect(bars.length).toBeGreaterThan(0);

    await fireEvent.click(bars[0]);

    expect(world.activeQuery).toEqual({
      name: "",
      clauses: [
        {
          type: "value_eq",
          component: "Agent",
          field: "state",
          value: "idle",
        },
      ],
    });
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

  it("shows traces section with token and model totals", () => {
    const entity = makeEntity(1, [{ type_short: "A", data: {} }]);
    setWorldState([entity]);
    world.spans = [
      makeSpanEvent(1, 1, {
        attributes: {
          "agentecs.tick": 1,
          "agentecs.entity_id": 1,
          "gen_ai.request.model": "gpt-4o",
          "gen_ai.usage.input_tokens": 100,
          "gen_ai.usage.output_tokens": 50,
        },
      }),
      makeSpanEvent(1, 2, {
        attributes: {
          "agentecs.tick": 1,
          "agentecs.entity_id": 2,
          "gen_ai.request.model": "gpt-4o-mini",
          "gen_ai.usage.input_tokens": 1,
          "gen_ai.usage.output_tokens": 1,
        },
      }),
    ];
    world.selectEntity(1);

    const { container } = render(InspectorPanel);
    const section = container.querySelector("[data-testid='traces-section']");
    expect(section).toBeTruthy();
    expect(section!.textContent).toContain("span");
    const tokenSummary = container.querySelector("[data-testid='entity-token-summary']");
    expect(tokenSummary).toBeTruthy();
    expect(tokenSummary!.textContent).toContain("150");
    const modelBreakdown = container.querySelector("[data-testid='entity-model-breakdown']");
    expect(modelBreakdown).toBeTruthy();
    expect(modelBreakdown!.textContent).toContain("gpt-4o");
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

  describe("diff display", () => {
    beforeEach(() => {
      world.connect("ws://test/ws");
      MockWebSocket.instances[0].simulateOpen();
    });

    it("shows diff summary when entity changed", () => {
      const snap1 = makeSnapshot({ tick: 1 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 1,
        snapshot: snap1,
      } satisfies SnapshotMessage);

      const snap2 = makeSnapshot({
        tick: 2,
        entities: [
          {
            id: 1,
            archetype: ["Agent", "Position"],
            components: [
              { type_name: "Agent", type_short: "Agent", data: { name: "a1" } },
              { type_name: "Position", type_short: "Position", data: { x: 10, y: 20 } },
            ],
          },
          {
            id: 2,
            archetype: ["Task"],
            components: [
              { type_name: "Task", type_short: "Task", data: { status: "active" } },
            ],
          },
        ],
      });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 2,
        snapshot: snap2,
      } satisfies SnapshotMessage);

      world.selectEntity(1);
      const { container } = render(InspectorPanel);
      const summary = container.querySelector("[data-testid='diff-summary']");
      expect(summary).toBeTruthy();
      expect(summary!.textContent).toContain("2 changes");
      expect(summary!.textContent).toContain("since tick 1");
    });

    it("shows per-component change badge", () => {
      const snap1 = makeSnapshot({ tick: 1 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 1,
        snapshot: snap1,
      } satisfies SnapshotMessage);

      const snap2 = makeSnapshot({
        tick: 2,
        entities: [
          {
            id: 1,
            archetype: ["Agent", "Position"],
            components: [
              { type_name: "Agent", type_short: "Agent", data: { name: "a1" } },
              { type_name: "Position", type_short: "Position", data: { x: 5, y: 0 } },
            ],
          },
          {
            id: 2,
            archetype: ["Task"],
            components: [
              { type_name: "Task", type_short: "Task", data: { status: "active" } },
            ],
          },
        ],
      });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 2,
        snapshot: snap2,
      } satisfies SnapshotMessage);

      world.selectEntity(1);
      const { container } = render(InspectorPanel);
      const badge = container.querySelector("[data-testid='component-diff-badge']");
      expect(badge).toBeTruthy();
      expect(badge!.textContent?.trim()).toBe("1");
    });

    it("no diff summary for unchanged entity", () => {
      const snap1 = makeSnapshot({ tick: 1 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 1,
        snapshot: snap1,
      } satisfies SnapshotMessage);

      const snap2 = makeSnapshot({ tick: 2 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 2,
        snapshot: snap2,
      } satisfies SnapshotMessage);

      world.selectEntity(2);
      const { container } = render(InspectorPanel);
      expect(container.querySelector("[data-testid='diff-summary']")).toBeNull();
    });

    it("shows removed component with DEL badge", () => {
      const snap1 = makeSnapshot({
        tick: 1,
        entities: [
          {
            id: 1,
            archetype: ["Agent", "Position"],
            components: [
              { type_name: "Agent", type_short: "Agent", data: { name: "a1" } },
              { type_name: "Position", type_short: "Position", data: { x: 0, y: 0 } },
            ],
          },
          {
            id: 2,
            archetype: ["Task"],
            components: [
              { type_name: "Task", type_short: "Task", data: { status: "active" } },
            ],
          },
        ],
      });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 1,
        snapshot: snap1,
      } satisfies SnapshotMessage);

      const snap2 = makeSnapshot({
        tick: 2,
        entities: [
          {
            id: 1,
            archetype: ["Agent"],
            components: [
              { type_name: "Agent", type_short: "Agent", data: { name: "a1" } },
            ],
          },
          {
            id: 2,
            archetype: ["Task"],
            components: [
              { type_name: "Task", type_short: "Task", data: { status: "active" } },
            ],
          },
        ],
      });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 2,
        snapshot: snap2,
      } satisfies SnapshotMessage);

      world.selectEntity(1);
      const { container } = render(InspectorPanel);
      const badges = container.querySelectorAll("[data-testid='component-diff-badge']");
      const delBadge = [...badges].find((b) => b.textContent?.trim() === "DEL");
      expect(delBadge).toBeTruthy();
      expect(container.textContent).toContain("Position");
    });

    it("pin button visible when history supported", () => {
      MockWebSocket.instances[0].simulateMessage({
        type: "metadata",
        tick: 0,
        config: makeConfig(),
        tick_range: [0, 10],
        supports_history: true,
        is_paused: false,
      } satisfies MetadataMessage);

      const snap = makeSnapshot({ tick: 1 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 1,
        snapshot: snap,
      } satisfies SnapshotMessage);

      world.selectEntity(1);
      const { container } = render(InspectorPanel);
      const pinBtn = container.querySelector("[data-testid='pin-state-btn']");
      expect(pinBtn).toBeTruthy();
      expect(pinBtn!.textContent).toContain("Pin current state");
    });

    it("shows loop section and allows toggling auto-pause", async () => {
      const sendSnapshot = (tick: number, x: number) => {
        MockWebSocket.instances[0].simulateMessage({
          type: "snapshot",
          tick,
          snapshot: makeSnapshot({
            tick,
            entities: [
              {
                id: 1,
                archetype: ["Agent", "Position"],
                components: [
                  { type_name: "Agent", type_short: "Agent", data: { name: "a1" } },
                  { type_name: "Position", type_short: "Position", data: { x, y: 0 } },
                ],
              },
              {
                id: 2,
                archetype: ["Task"],
                components: [
                  { type_name: "Task", type_short: "Task", data: { status: "active" } },
                ],
              },
            ],
          }),
        } satisfies SnapshotMessage);
      };

      sendSnapshot(1, 0);
      sendSnapshot(2, 1);
      for (let i = 0; i < LOOP_DETECTION_THRESHOLD; i++) {
        sendSnapshot(3 + i, 1);
      }

      world.selectEntity(1);

      const { container } = render(InspectorPanel);
      const loopSection = container.querySelector("[data-testid='loop-status']");
      expect(loopSection).toBeTruthy();
      expect(loopSection!.textContent).toContain("Loop detected");
      expect(loopSection!.textContent).toContain("cycle length 1");

      expect(world.autoPauseOnLoop).toBe(false);
      const toggle = container.querySelector("[data-testid='auto-pause-loop-toggle']");
      expect(toggle).toBeTruthy();
      await fireEvent.click(toggle!);
      expect(world.autoPauseOnLoop).toBe(true);
    });
  });
});
