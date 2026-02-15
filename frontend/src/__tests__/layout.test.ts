import { describe, it, expect } from "vitest";
import { componentLayout, computeLayout } from "../lib/layout";
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
  it("produces same output as componentLayout", () => {
    const entities = [
      makeEntity(1, ["A", "B"]),
      makeEntity(2, ["C"]),
    ];
    const compLayout = componentLayout(entities);
    const computed = computeLayout(entities);
    expect(computed.get(1)).toEqual(compLayout.get(1));
    expect(computed.get(2)).toEqual(compLayout.get(2));
  });
});
