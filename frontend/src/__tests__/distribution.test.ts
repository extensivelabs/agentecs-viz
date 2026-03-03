import { describe, it, expect } from "vitest";
import {
  computeDistribution,
  detectFieldType,
  getFieldsForComponent,
} from "../lib/distribution";
import { makeEntity } from "./helpers";

describe("getFieldsForComponent", () => {
  it("returns sorted unique fields for a component", () => {
    const entities = [
      makeEntity(1, [{ type_short: "Agent", data: { state: "idle", score: 1 } }]),
      makeEntity(2, [{ type_short: "Agent", data: { score: 2, mode: "run" } }]),
      makeEntity(3, [{ type_short: "Task", data: { status: "pending" } }]),
    ];

    expect(getFieldsForComponent(entities, "Agent")).toEqual([
      "mode",
      "score",
      "state",
    ]);
  });

  it("returns empty array when component is missing", () => {
    const entities = [
      makeEntity(1, [{ type_short: "Task", data: { status: "pending" } }]),
    ];

    expect(getFieldsForComponent(entities, "Agent")).toEqual([]);
  });
});

describe("detectFieldType", () => {
  it("detects numeric fields", () => {
    const entities = [
      makeEntity(1, [{ type_short: "Stats", data: { value: 1 } }]),
      makeEntity(2, [{ type_short: "Stats", data: { value: 2.5 } }]),
    ];

    expect(detectFieldType(entities, "Stats", "value")).toBe("numeric");
  });

  it("detects categorical fields for strings and booleans", () => {
    const entities = [
      makeEntity(1, [{ type_short: "Agent", data: { state: "idle" } }]),
      makeEntity(2, [{ type_short: "Agent", data: { state: true } }]),
    ];

    expect(detectFieldType(entities, "Agent", "state")).toBe("categorical");
  });

  it("defaults to categorical when all values are missing", () => {
    const entities = [
      makeEntity(1, [{ type_short: "Agent", data: { state: null } }]),
      makeEntity(2, [{ type_short: "Agent", data: {} }]),
    ];

    expect(detectFieldType(entities, "Agent", "state")).toBe("categorical");
  });
});

describe("computeDistribution", () => {
  it("computes categorical bins sorted by count descending", () => {
    const entities = [
      makeEntity(1, [{ type_short: "Agent", data: { state: "idle" } }]),
      makeEntity(2, [{ type_short: "Agent", data: { state: "working" } }]),
      makeEntity(3, [{ type_short: "Agent", data: { state: "idle" } }]),
      makeEntity(4, [{ type_short: "Agent", data: {} }]),
    ];

    const distribution = computeDistribution(entities, "Agent", "state");
    expect(distribution.type).toBe("categorical");
    expect(distribution.totalWithComponent).toBe(4);
    expect(distribution.missingCount).toBe(1);
    expect(distribution.bins).toEqual([
      { value: "idle", count: 2, entityIds: [1, 3] },
      { value: "working", count: 1, entityIds: [2] },
    ]);
  });

  it("computes numeric histogram bins and includes upper bound in last bin", () => {
    const entities = [
      makeEntity(1, [{ type_short: "Stats", data: { value: 0 } }]),
      makeEntity(2, [{ type_short: "Stats", data: { value: 5 } }]),
      makeEntity(3, [{ type_short: "Stats", data: { value: 10 } }]),
      makeEntity(4, [{ type_short: "Stats", data: { value: null } }]),
    ];

    const distribution = computeDistribution(entities, "Stats", "value", 2);
    expect(distribution.type).toBe("numeric");
    if (distribution.type !== "numeric") {
      throw new Error("expected numeric distribution");
    }

    expect(distribution.min).toBe(0);
    expect(distribution.max).toBe(10);
    expect(distribution.totalWithComponent).toBe(4);
    expect(distribution.missingCount).toBe(1);
    expect(distribution.bins).toHaveLength(2);
    expect(distribution.bins[0].count).toBe(1);
    expect(distribution.bins[0].entityIds).toEqual([1]);
    expect(distribution.bins[1].count).toBe(2);
    expect(distribution.bins[1].entityIds).toEqual([2, 3]);
  });

  it("returns a single bin when all numeric values are identical", () => {
    const entities = [
      makeEntity(1, [{ type_short: "Stats", data: { value: 7 } }]),
      makeEntity(2, [{ type_short: "Stats", data: { value: 7 } }]),
    ];

    const distribution = computeDistribution(entities, "Stats", "value");
    expect(distribution.type).toBe("numeric");
    if (distribution.type !== "numeric") {
      throw new Error("expected numeric distribution");
    }

    expect(distribution.bins).toHaveLength(1);
    expect(distribution.bins[0].count).toBe(2);
    expect(distribution.bins[0].label).toBe("7");
  });

  it("falls back to categorical distribution for mixed field types", () => {
    const entities = [
      makeEntity(1, [{ type_short: "Stats", data: { value: 1 } }]),
      makeEntity(2, [{ type_short: "Stats", data: { value: "many" } }]),
    ];

    const distribution = computeDistribution(entities, "Stats", "value");
    expect(distribution.type).toBe("categorical");
    expect(distribution.bins).toEqual([
      { value: "1", count: 1, entityIds: [1] },
      { value: "many", count: 1, entityIds: [2] },
    ]);
  });
});
