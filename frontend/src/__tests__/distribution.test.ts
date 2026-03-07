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
      { value: "idle", count: 2 },
      { value: "working", count: 1 },
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
    expect(distribution.bins[1].count).toBe(2);
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
      { value: "1", count: 1 },
      { value: "many", count: 1 },
    ]);
  });

  it("uses stable serialization for object categorical values", () => {
    const entities = [
      makeEntity(1, [{ type_short: "Stats", data: { value: { b: 2, a: 1 } } }]),
      makeEntity(2, [{ type_short: "Stats", data: { value: { a: 1, b: 2 } } }]),
      makeEntity(3, [{ type_short: "Stats", data: { value: { a: 3 } } }]),
    ];

    const distribution = computeDistribution(entities, "Stats", "value");
    expect(distribution.type).toBe("categorical");
    expect(distribution.bins).toEqual([
      { value: '{"a":1,"b":2}', count: 2 },
      { value: '{"a":3}', count: 1 },
    ]);
  });

  it("counts non-serializable values as missing", () => {
    const entities = [
      makeEntity(1, [{ type_short: "Stats", data: { value: Number.NaN } }]),
      makeEntity(2, [{ type_short: "Stats", data: { value: Infinity } }]),
      makeEntity(3, [{ type_short: "Stats", data: { value: "ok" } }]),
    ];

    const distribution = computeDistribution(entities, "Stats", "value");
    expect(distribution.totalWithComponent).toBe(3);
    expect(distribution.missingCount).toBe(2);
    expect(distribution.bins).toEqual([{ value: "ok", count: 1 }]);
  });
});
