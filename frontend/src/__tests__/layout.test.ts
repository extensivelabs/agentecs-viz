import { describe, it, expect } from "vitest";
import { archetypeLayout, componentLayout, computeLayout } from "../lib/layout";
import { layoutSpacing, adaptiveMaxRadius, entityRadius, DETAIL_MAX_RADIUS, DETAIL_MID_RADIUS, DETAIL_MIN_RADIUS, WORLD_SIZE } from "../lib/rendering";
import type { EntitySnapshot } from "../lib/types";

function makeEntity(id: number, archetype: string[], components?: { type_name: string; type_short: string; data: Record<string, unknown> }[]): EntitySnapshot {
  return {
    id,
    archetype,
    components: (components ?? archetype.map((a) => ({ type_name: `mod.${a}`, type_short: a, data: {} }))),
  };
}

describe("archetypeLayout", () => {
  it("returns empty map for empty input", () => {
    expect(archetypeLayout([])).toEqual(new Map());
  });

  it("assigns positions to all entities", () => {
    const entities = [
      makeEntity(1, ["A", "B"]),
      makeEntity(2, ["A", "B"]),
      makeEntity(3, ["C"]),
    ];
    const layout = archetypeLayout(entities);
    expect(layout.size).toBe(3);
    expect(layout.has(1)).toBe(true);
    expect(layout.has(2)).toBe(true);
    expect(layout.has(3)).toBe(true);
  });

  it("produces deterministic output", () => {
    const entities = [
      makeEntity(1, ["A"]),
      makeEntity(2, ["B"]),
    ];
    const a = archetypeLayout(entities);
    const b = archetypeLayout(entities);
    expect(a.get(1)).toEqual(b.get(1));
    expect(a.get(2)).toEqual(b.get(2));
  });

  it("groups same-archetype entities closer together", () => {
    const entities = [
      makeEntity(1, ["A"]),
      makeEntity(2, ["A"]),
      makeEntity(3, ["B"]),
      makeEntity(4, ["B"]),
    ];
    const layout = archetypeLayout(entities);
    const pos1 = layout.get(1)!;
    const pos2 = layout.get(2)!;
    const pos3 = layout.get(3)!;

    // Distance between same-archetype entities should be less than cross-archetype
    const sameGroupDist = Math.hypot(pos1.x - pos2.x, pos1.y - pos2.y);
    const crossGroupDist = Math.hypot(pos1.x - pos3.x, pos1.y - pos3.y);
    expect(sameGroupDist).toBeLessThan(crossGroupDist);
  });

  it("uses Position component when available", () => {
    const entities = [
      makeEntity(1, ["Position", "Health"], [
        { type_name: "mod.Position", type_short: "Position", data: { x: 10, y: 20 } },
        { type_name: "mod.Health", type_short: "Health", data: { hp: 100 } },
      ]),
    ];
    const layout = archetypeLayout(entities);
    const pos = layout.get(1)!;
    // Should be offset from center by x*scale, y*scale
    const center = WORLD_SIZE / 2;
    const scale = WORLD_SIZE / 200;
    expect(pos.x).toBeCloseTo(center + 10 * scale, 0);
    expect(pos.y).toBeCloseTo(center + 20 * scale, 0);
  });

  it("keeps all positions within world bounds", () => {
    const entities = Array.from({ length: 50 }, (_, i) => makeEntity(i, ["Type" + (i % 5)]));
    const layout = archetypeLayout(entities);
    for (const [, pos] of layout) {
      expect(pos.x).toBeGreaterThanOrEqual(0);
      expect(pos.x).toBeLessThanOrEqual(WORLD_SIZE);
      expect(pos.y).toBeGreaterThanOrEqual(0);
      expect(pos.y).toBeLessThanOrEqual(WORLD_SIZE);
    }
  });

  it("separates entities by at least layoutSpacing", () => {
    const entities = Array.from({ length: 10 }, (_, i) => makeEntity(i, ["Agent"]));
    const spacing = layoutSpacing(entities.length);
    const layout = archetypeLayout(entities);
    const positions = [...layout.values()];
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dist = Math.hypot(positions[i].x - positions[j].x, positions[i].y - positions[j].y);
        expect(dist).toBeGreaterThanOrEqual(spacing - 1e-9);
      }
    }
  });
});

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
    // Entities 1 and 2 share components A and B; entity 3 is disjoint
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
  it("delegates to archetypeLayout for archetypes mode", () => {
    const entities = [makeEntity(1, ["A"])];
    const archLayout = archetypeLayout(entities);
    const computed = computeLayout(entities, "archetypes");
    expect(computed.get(1)).toEqual(archLayout.get(1));
  });

  it("delegates to componentLayout for components mode", () => {
    const entities = [makeEntity(1, ["A"])];
    const compLayout = componentLayout(entities);
    const computed = computeLayout(entities, "components");
    expect(computed.get(1)).toEqual(compLayout.get(1));
  });
});
