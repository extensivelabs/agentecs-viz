import { describe, it, expect } from "vitest";
import { componentLayout, computeLayout, pipelineLayout, getEntityStatusValue } from "../lib/layout";
import type { LayoutMode } from "../lib/layout";
import { layoutSpacing, adaptiveMaxRadius, entityRadius, DETAIL_MAX_RADIUS, DETAIL_MID_RADIUS, DETAIL_MIN_RADIUS, WORLD_SIZE } from "../lib/rendering";
import { makeEntity } from "./helpers";

describe("componentLayout", () => {
  it("returns empty map for empty input", () => {
    expect(componentLayout([])).toEqual(new Map());
  });

  it("assigns positions to all entities", () => {
    const entities = [
      makeEntity(1, ["A", "B"]),
      makeEntity(2, ["A", "C"]),
    ];
    const layout = componentLayout(entities);
    expect(layout.size).toBe(2);
  });

  it("separates same-group entities by at least layoutSpacing", () => {
    const entities = Array.from({ length: 10 }, (_, i) => makeEntity(i, ["Agent"]));
    const spacing = layoutSpacing(entities.length);
    const layout = componentLayout(entities);
    const positions = [...layout.values()];
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dist = Math.hypot(positions[i].x - positions[j].x, positions[i].y - positions[j].y);
        expect(dist).toBeGreaterThanOrEqual(spacing - 1e-9);
      }
    }
  });

  it("clusters archetypes sharing components closer together", () => {
    const entities = [
      makeEntity(1, ["A", "B", "C"]),
      makeEntity(2, ["A", "B", "D"]),
      makeEntity(3, ["E", "F"]),
    ];
    const layout = componentLayout(entities);
    const pos1 = layout.get(1)!;
    const pos2 = layout.get(2)!;
    const pos3 = layout.get(3)!;

    const sharedDist = Math.hypot(pos1.x - pos2.x, pos1.y - pos2.y);
    const disjointDist = Math.hypot(pos1.x - pos3.x, pos1.y - pos3.y);
    expect(sharedDist).toBeLessThan(disjointDist);
  });

  it("uses Position component override", () => {
    const entities = [
      makeEntity(1, ["Position", "Health"], [
        { type_short: "Position", data: { x: 10, y: 20 } },
        { type_short: "Health", data: { hp: 100 } },
      ]),
    ];
    const layout = componentLayout(entities);
    const pos = layout.get(1)!;
    const center = WORLD_SIZE / 2;
    const scale = WORLD_SIZE / 200;
    expect(pos.x).toBeCloseTo(center + 10 * scale, 0);
    expect(pos.y).toBeCloseTo(center + 20 * scale, 0);
  });

  it("spaces unpositioned entities based on their count, not total count", () => {
    // 20 positioned + 5 unpositioned: spacing should match layoutSpacing(5)
    const positioned = Array.from({ length: 20 }, (_, i) =>
      makeEntity(i, ["Position", "Health"], [
        { type_short: "Position", data: { x: i * 5, y: 0 } },
        { type_short: "Health", data: { hp: 100 } },
      ]),
    );
    const unpositioned = Array.from({ length: 5 }, (_, i) =>
      makeEntity(100 + i, ["Agent"]),
    );
    const layout = componentLayout([...positioned, ...unpositioned]);
    expect(layout.size).toBe(25);

    const spacing = layoutSpacing(5);
    const unpositionedPositions = unpositioned.map((e) => layout.get(e.id)!);
    for (let i = 0; i < unpositionedPositions.length; i++) {
      for (let j = i + 1; j < unpositionedPositions.length; j++) {
        const dist = Math.hypot(
          unpositionedPositions[i].x - unpositionedPositions[j].x,
          unpositionedPositions[i].y - unpositionedPositions[j].y,
        );
        expect(dist).toBeGreaterThanOrEqual(spacing - 1e-9);
      }
    }
  });
});

describe("adaptiveMaxRadius", () => {
  it("returns DETAIL_MAX_RADIUS for small counts", () => {
    expect(adaptiveMaxRadius(1)).toBe(DETAIL_MAX_RADIUS);
    expect(adaptiveMaxRadius(30)).toBe(DETAIL_MAX_RADIUS);
  });

  it("scales down for medium counts", () => {
    const r = adaptiveMaxRadius(65);
    expect(r).toBeLessThan(DETAIL_MAX_RADIUS);
    expect(r).toBeGreaterThan(DETAIL_MID_RADIUS);
  });

  it("returns DETAIL_MIN_RADIUS for large counts", () => {
    expect(adaptiveMaxRadius(500)).toBe(DETAIL_MIN_RADIUS);
    expect(adaptiveMaxRadius(1000)).toBe(DETAIL_MIN_RADIUS);
  });
});

describe("entityRadius with maxRadius", () => {
  it("respects custom maxRadius", () => {
    const r = entityRadius(10, DETAIL_MID_RADIUS);
    expect(r).toBeLessThanOrEqual(DETAIL_MID_RADIUS);
  });
});

describe("computeLayout", () => {
  it("spatial mode produces same positions as componentLayout", () => {
    const entities = [
      makeEntity(1, ["A", "B"]),
      makeEntity(2, ["C"]),
    ];
    const compLayout = componentLayout(entities);
    const result = computeLayout(entities);
    expect(result.positions.get(1)).toEqual(compLayout.get(1));
    expect(result.positions.get(2)).toEqual(compLayout.get(2));
    expect(result.columns).toEqual([]);
  });

  it("pipeline mode returns columns and positions", () => {
    const entities = [
      makeEntity(1, [{ type_short: "Task", data: { status: "active" } }]),
      makeEntity(2, [{ type_short: "Task", data: { status: "done" } }]),
    ];
    const result = computeLayout(entities, "pipeline", ["status"]);
    expect(result.positions.size).toBe(2);
    expect(result.columns.length).toBe(2);
  });
});

describe("getEntityStatusValue", () => {
  it("returns first matching status field value", () => {
    const entity = makeEntity(1, [{ type_short: "Task", data: { status: "active", phase: "init" } }]);
    expect(getEntityStatusValue(entity, ["status", "phase"])).toBe("active");
  });

  it("falls back to later fields in priority order", () => {
    const entity = makeEntity(1, [{ type_short: "Agent", data: { state: "idle" } }]);
    expect(getEntityStatusValue(entity, ["status", "state"])).toBe("idle");
  });

  it("returns null when no status field found", () => {
    const entity = makeEntity(1, [{ type_short: "Position", data: { x: 1, y: 2 } }]);
    expect(getEntityStatusValue(entity, ["status", "state"])).toBeNull();
  });

  it("searches across multiple components", () => {
    const entity = makeEntity(1, [
      { type_short: "Position", data: { x: 0, y: 0 } },
      { type_short: "Agent", data: { state: "working" } },
    ]);
    expect(getEntityStatusValue(entity, ["state"])).toBe("working");
  });
});

describe("pipelineLayout", () => {
  it("returns empty result for no entities", () => {
    const result = pipelineLayout([], ["status"]);
    expect(result.positions.size).toBe(0);
    expect(result.columns).toEqual([]);
  });

  it("groups entities into columns by status value", () => {
    const entities = [
      makeEntity(1, [{ type_short: "Task", data: { status: "pending" } }]),
      makeEntity(2, [{ type_short: "Task", data: { status: "active" } }]),
      makeEntity(3, [{ type_short: "Task", data: { status: "pending" } }]),
    ];
    const result = pipelineLayout(entities, ["status"]);
    expect(result.positions.size).toBe(3);
    expect(result.columns.length).toBe(2);

    const pendingCol = result.columns.find(c => c.name === "pending")!;
    const activeCol = result.columns.find(c => c.name === "active")!;
    expect(pendingCol.count).toBe(2);
    expect(activeCol.count).toBe(1);
  });

  it("entities in same column share similar x position", () => {
    const entities = [
      makeEntity(1, [{ type_short: "T", data: { status: "a" } }]),
      makeEntity(2, [{ type_short: "T", data: { status: "a" } }]),
      makeEntity(3, [{ type_short: "T", data: { status: "b" } }]),
    ];
    const result = pipelineLayout(entities, ["status"]);
    const col = result.columns.find(c => c.name === "a")!;
    const p1 = result.positions.get(1)!;
    const p2 = result.positions.get(2)!;
    // Both should be within the column bounds
    const colLeft = col.x - col.width / 2;
    const colRight = col.x + col.width / 2;
    expect(p1.x).toBeGreaterThanOrEqual(colLeft);
    expect(p1.x).toBeLessThanOrEqual(colRight);
    expect(p2.x).toBeGreaterThanOrEqual(colLeft);
    expect(p2.x).toBeLessThanOrEqual(colRight);
  });

  it("entities without status field go to (unknown) column", () => {
    const entities = [
      makeEntity(1, [{ type_short: "Position", data: { x: 0, y: 0 } }]),
      makeEntity(2, [{ type_short: "Task", data: { status: "active" } }]),
    ];
    const result = pipelineLayout(entities, ["status"]);
    const unknownCol = result.columns.find(c => c.name === "(unknown)");
    expect(unknownCol).toBeTruthy();
    expect(unknownCol!.count).toBe(1);
  });

  it("positions all entities within world bounds", () => {
    const entities = Array.from({ length: 30 }, (_, i) =>
      makeEntity(i, [{ type_short: "Task", data: { status: i % 3 === 0 ? "a" : i % 3 === 1 ? "b" : "c" } }]),
    );
    const result = pipelineLayout(entities, ["status"]);
    for (const pos of result.positions.values()) {
      expect(pos.x).toBeGreaterThanOrEqual(0);
      expect(pos.x).toBeLessThanOrEqual(WORLD_SIZE);
      expect(pos.y).toBeGreaterThanOrEqual(0);
      expect(pos.y).toBeLessThanOrEqual(WORLD_SIZE);
    }
  });

  it("columns sorted by count descending, unknown last", () => {
    const entities = [
      makeEntity(1, [{ type_short: "T", data: { status: "rare" } }]),
      makeEntity(2, [{ type_short: "T", data: { status: "common" } }]),
      makeEntity(3, [{ type_short: "T", data: { status: "common" } }]),
      makeEntity(4, [{ type_short: "T", data: { status: "common" } }]),
      makeEntity(5, [{ type_short: "X", data: { x: 1 } }]),
    ];
    const result = pipelineLayout(entities, ["status"]);
    expect(result.columns[0].name).toBe("common");
    expect(result.columns[result.columns.length - 1].name).toBe("(unknown)");
  });
});
