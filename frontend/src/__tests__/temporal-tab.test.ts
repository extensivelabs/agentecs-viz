import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import TemporalTab from "../lib/TemporalTab.svelte";
import { temporal } from "../lib/state/temporal.svelte";
import { world } from "../lib/state/world.svelte";
import type { EntitySnapshot, WorldSnapshot } from "../lib/types";
import { makeConfig } from "./helpers";

function entity(id: number, components: { type_short: string; data: Record<string, unknown> }[]): EntitySnapshot {
  return {
    id,
    archetype: components.map((component) => component.type_short),
    components: components.map((component) => ({
      type_name: `mod.${component.type_short}`,
      type_short: component.type_short,
      data: component.data,
    })),
  };
}

function snapshot(tick: number, entities: EntitySnapshot[]): WorldSnapshot {
  return {
    tick,
    timestamp: tick,
    entity_count: entities.length,
    entities,
    archetypes: [],
    metadata: {},
  };
}

function setHistoryState(maxTick = 5): void {
  world.supportsHistory = true;
  world.tickRange = [0, maxTick];
  world.snapshot = snapshot(maxTick, []);
  world.config = makeConfig({
    archetypes: [
      { key: "Agent,Position", label: "Agent / Position" },
      { key: "Task", label: "Task" },
    ],
  });
}

describe("TemporalTab", () => {
  beforeEach(() => {
    temporal.reset();
    world.lastError = null;
    world.supportsHistory = false;
    world.tickRange = null;
    world.snapshot = null;
    world.config = makeConfig();
  });

  afterEach(() => {
    temporal.reset();
    vi.restoreAllMocks();
  });

  it("renders a history unavailable state", () => {
    render(TemporalTab);
    expect(screen.getByTestId("temporal-no-history").textContent).toContain("History is not available");
  });

  it("defaults T1 and T2 to T-1 and T", async () => {
    setHistoryState(5);
    render(TemporalTab);

    await waitFor(() => {
      expect((screen.getByTestId("temporal-t1") as HTMLInputElement).value).toBe("4");
      expect((screen.getByTestId("temporal-t2") as HTMLInputElement).value).toBe("5");
    });
  });

  it("renders summary counts after comparing two ticks", async () => {
    setHistoryState(5);
    vi.spyOn(world, "getSnapshotAtTick")
      .mockResolvedValueOnce(snapshot(4, [
        entity(1, [{ type_short: "Position", data: { x: 0 } }]),
        entity(2, [{ type_short: "Task", data: { status: "old" } }]),
      ]))
      .mockResolvedValueOnce(snapshot(5, [
        entity(1, [{ type_short: "Position", data: { x: 1 } }]),
        entity(3, [{ type_short: "Agent", data: { name: "new" } }]),
      ]));

    render(TemporalTab);
    await fireEvent.click(screen.getByTestId("temporal-compare"));

    await waitFor(() => {
      const summary = screen.getByTestId("temporal-summary");
      expect(summary.textContent).toContain("1 spawned");
      expect(summary.textContent).toContain("1 destroyed");
      expect(summary.textContent).toContain("1 modified");
    });
  });

  it("applies magnitude filtering", async () => {
    setHistoryState(5);
    vi.spyOn(world, "getSnapshotAtTick")
      .mockResolvedValueOnce(snapshot(4, [entity(1, [{ type_short: "Position", data: { x: 0 } }])]))
      .mockResolvedValueOnce(snapshot(5, [entity(1, [{ type_short: "Position", data: { x: 1 } }])]))
      ;

    render(TemporalTab);
    await fireEvent.click(screen.getByTestId("temporal-compare"));

    await waitFor(() => {
      expect(screen.getAllByTestId("temporal-entity-row")).toHaveLength(1);
    });

    await fireEvent.input(screen.getByTestId("temporal-min-field-changes"), {
      target: { value: "2" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("temporal-no-filtered-results").textContent).toContain("No entities match");
    });
  });

  it("paginates large diffs", async () => {
    setHistoryState(30);
    const before = snapshot(
      29,
      Array.from({ length: 21 }, (_, index) =>
        entity(index + 1, [{ type_short: "Position", data: { x: 0 } }]),
      ),
    );
    const after = snapshot(
      30,
      Array.from({ length: 21 }, (_, index) =>
        entity(index + 1, [{ type_short: "Position", data: { x: 1 } }]),
      ),
    );

    vi.spyOn(world, "getSnapshotAtTick")
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);

    render(TemporalTab);
    await fireEvent.click(screen.getByTestId("temporal-compare"));

    await waitFor(() => {
      expect(screen.getByTestId("temporal-pagination").textContent).toContain("Page 1 of 2");
    });

    await fireEvent.click(screen.getByTestId("temporal-next-page"));

    await waitFor(() => {
      expect(screen.getByTestId("temporal-pagination").textContent).toContain("Page 2 of 2");
    });
  });

  it("expands an entity row to show JsonTree diffs", async () => {
    setHistoryState(5);
    vi.spyOn(world, "getSnapshotAtTick")
      .mockResolvedValueOnce(snapshot(4, [entity(1, [{ type_short: "Position", data: { x: 0 } }])]))
      .mockResolvedValueOnce(snapshot(5, [entity(1, [{ type_short: "Position", data: { x: 1 } }])]))
      ;

    render(TemporalTab);
    await fireEvent.click(screen.getByTestId("temporal-compare"));

    await waitFor(() => {
      expect(screen.getByTestId("temporal-entity-toggle-1")).toBeTruthy();
    });

    await fireEvent.click(screen.getByTestId("temporal-entity-toggle-1"));

    await waitFor(() => {
      expect(screen.getByTestId("json-tree")).toBeTruthy();
    });
  });
});
