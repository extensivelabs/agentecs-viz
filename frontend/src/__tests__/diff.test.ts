import { describe, it, expect } from "vitest";
import { diffObjects, diffEntity, diffWorld, changedPaths } from "../lib/diff";
import type { EntitySnapshot, WorldSnapshot } from "../lib/types";

describe("diffObjects", () => {
  it("returns empty for identical objects", () => {
    expect(diffObjects({ a: 1, b: "x" }, { a: 1, b: "x" })).toEqual([]);
  });

  it("detects added field", () => {
    const changes = diffObjects({ a: 1 }, { a: 1, b: 2 });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      path: ["b"],
      oldValue: undefined,
      newValue: 2,
      type: "added",
    });
  });

  it("detects removed field", () => {
    const changes = diffObjects({ a: 1, b: 2 }, { a: 1 });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      path: ["b"],
      oldValue: 2,
      newValue: undefined,
      type: "removed",
    });
  });

  it("detects changed scalar", () => {
    const changes = diffObjects({ a: 1 }, { a: 2 });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      path: ["a"],
      oldValue: 1,
      newValue: 2,
      type: "changed",
    });
  });

  it("recurses into nested objects with correct paths", () => {
    const changes = diffObjects(
      { pos: { x: 0, y: 0 } },
      { pos: { x: 10, y: 0 } },
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      path: ["pos", "x"],
      oldValue: 0,
      newValue: 10,
      type: "changed",
    });
  });

  it("detects array element change", () => {
    const changes = diffObjects({ items: [1, 2, 3] }, { items: [1, 99, 3] });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      path: ["items", "1"],
      oldValue: 2,
      newValue: 99,
      type: "changed",
    });
  });

  it("detects array length increase", () => {
    const changes = diffObjects({ items: [1] }, { items: [1, 2] });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      path: ["items", "1"],
      oldValue: undefined,
      newValue: 2,
      type: "added",
    });
  });

  it("detects array length decrease", () => {
    const changes = diffObjects({ items: [1, 2] }, { items: [1] });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      path: ["items", "1"],
      oldValue: 2,
      newValue: undefined,
      type: "removed",
    });
  });

  it("handles null values", () => {
    const changes = diffObjects({ a: null }, { a: 5 });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      path: ["a"],
      oldValue: null,
      newValue: 5,
      type: "changed",
    });
  });

  it("treats type change as changed", () => {
    const changes = diffObjects({ a: "hello" }, { a: 42 });
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe("changed");
    expect(changes[0].oldValue).toBe("hello");
    expect(changes[0].newValue).toBe(42);
  });

  it("uses prefix for path building", () => {
    const changes = diffObjects({ x: 1 }, { x: 2 }, ["root", "sub"]);
    expect(changes[0].path).toEqual(["root", "sub", "x"]);
  });

  it("recurses into nested objects in arrays", () => {
    const changes = diffObjects(
      { items: [{ v: 1 }] },
      { items: [{ v: 2 }] },
    );
    expect(changes).toHaveLength(1);
    expect(changes[0].path).toEqual(["items", "0", "v"]);
  });
});

describe("diffEntity", () => {
  function entity(
    id: number,
    components: { type_short: string; data: Record<string, unknown> }[],
  ): EntitySnapshot {
    return {
      id,
      archetype: components.map((c) => c.type_short),
      components: components.map((c) => ({
        type_name: `mod.${c.type_short}`,
        type_short: c.type_short,
        data: c.data,
      })),
    };
  }

  it("detects added component", () => {
    const old = entity(1, [{ type_short: "A", data: { v: 1 } }]);
    const cur = entity(1, [
      { type_short: "A", data: { v: 1 } },
      { type_short: "B", data: { x: 10 } },
    ]);
    const diff = diffEntity(old, cur);
    expect(diff.components).toHaveLength(1);
    expect(diff.components[0].componentType).toBe("B");
    expect(diff.components[0].status).toBe("added");
    expect(diff.components[0].fields).toHaveLength(1);
  });

  it("recurses into nested fields for added components", () => {
    const old = entity(1, [{ type_short: "A", data: { v: 1 } }]);
    const cur = entity(1, [
      { type_short: "A", data: { v: 1 } },
      { type_short: "B", data: { nested: { x: 10, y: 20 } } },
    ]);
    const diff = diffEntity(old, cur);
    expect(diff.components[0].fields).toEqual([
      { path: ["nested", "x"], oldValue: undefined, newValue: 10, type: "added" },
      { path: ["nested", "y"], oldValue: undefined, newValue: 20, type: "added" },
    ]);
  });

  it("detects removed component", () => {
    const old = entity(1, [
      { type_short: "A", data: { v: 1 } },
      { type_short: "B", data: { x: 10 } },
    ]);
    const cur = entity(1, [{ type_short: "A", data: { v: 1 } }]);
    const diff = diffEntity(old, cur);
    expect(diff.components).toHaveLength(1);
    expect(diff.components[0].componentType).toBe("B");
    expect(diff.components[0].status).toBe("removed");
  });

  it("recurses into nested fields for removed components", () => {
    const old = entity(1, [
      { type_short: "A", data: { v: 1 } },
      { type_short: "B", data: { nested: { x: 10, y: 20 } } },
    ]);
    const cur = entity(1, [{ type_short: "A", data: { v: 1 } }]);
    const diff = diffEntity(old, cur);
    expect(diff.components[0].fields).toEqual([
      { path: ["nested", "x"], oldValue: 10, newValue: undefined, type: "removed" },
      { path: ["nested", "y"], oldValue: 20, newValue: undefined, type: "removed" },
    ]);
  });

  it("detects modified component", () => {
    const old = entity(1, [{ type_short: "Pos", data: { x: 0, y: 0 } }]);
    const cur = entity(1, [{ type_short: "Pos", data: { x: 5, y: 0 } }]);
    const diff = diffEntity(old, cur);
    expect(diff.components).toHaveLength(1);
    expect(diff.components[0].status).toBe("modified");
    expect(diff.components[0].fields).toHaveLength(1);
  });

  it("returns zero changes for unchanged entity", () => {
    const e = entity(1, [{ type_short: "A", data: { v: 1 } }]);
    const diff = diffEntity(e, e);
    expect(diff.totalChanges).toBe(0);
    expect(diff.components).toHaveLength(0);
  });

  it("computes totalChanges across multiple components", () => {
    const old = entity(1, [
      { type_short: "A", data: { v: 1 } },
      { type_short: "B", data: { x: 0, y: 0 } },
    ]);
    const cur = entity(1, [
      { type_short: "A", data: { v: 2 } },
      { type_short: "B", data: { x: 5, y: 10 } },
    ]);
    const diff = diffEntity(old, cur);
    expect(diff.totalChanges).toBe(3);
  });
});

describe("changedPaths", () => {
  it("converts FieldChange paths to dot-separated strings", () => {
    const result = changedPaths([
      { path: ["pos", "x"], oldValue: 0, newValue: 1, type: "changed" },
      { path: ["name"], oldValue: "a", newValue: "b", type: "changed" },
      { path: ["items", "0", "v"], oldValue: 1, newValue: 2, type: "changed" },
    ]);
    expect(result).toEqual(new Set(["pos.x", "name", "items.0.v"]));
  });

  it("returns empty set for empty changes", () => {
    expect(changedPaths([])).toEqual(new Set());
  });
});

describe("diffWorld", () => {
  function entity(
    id: number,
    components: { type_short: string; data: Record<string, unknown> }[],
  ): EntitySnapshot {
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

  it("returns an empty diff for identical snapshots", () => {
    const world = snapshot(1, [entity(1, [{ type_short: "A", data: { value: 1 } }])]);
    const diff = diffWorld(world, world);
    expect(diff.summary).toEqual({
      spawnedCount: 0,
      destroyedCount: 0,
      modifiedCount: 0,
      totalFieldChanges: 0,
    });
    expect(diff.entries).toEqual([]);
  });

  it("detects spawned entities", () => {
    const before = snapshot(1, []);
    const after = snapshot(2, [entity(2, [{ type_short: "Agent", data: { name: "a" } }])]);
    const diff = diffWorld(before, after);
    expect(diff.summary.spawnedCount).toBe(1);
    expect(diff.entries[0].changeType).toBe("spawned");
    expect(diff.entries[0].entityId).toBe(2);
  });

  it("detects destroyed entities", () => {
    const before = snapshot(1, [entity(3, [{ type_short: "Task", data: { status: "done" } }])]);
    const after = snapshot(2, []);
    const diff = diffWorld(before, after);
    expect(diff.summary.destroyedCount).toBe(1);
    expect(diff.entries[0].changeType).toBe("destroyed");
    expect(diff.entries[0].entityId).toBe(3);
  });

  it("detects modified entities", () => {
    const before = snapshot(1, [entity(1, [{ type_short: "Pos", data: { x: 0, y: 0 } }])]);
    const after = snapshot(2, [entity(1, [{ type_short: "Pos", data: { x: 2, y: 0 } }])]);
    const diff = diffWorld(before, after);
    expect(diff.summary.modifiedCount).toBe(1);
    expect(diff.entries[0].changeType).toBe("modified");
    expect(diff.entries[0].totalChanges).toBe(1);
  });

  it("handles mixed spawned destroyed and modified entities", () => {
    const before = snapshot(5, [
      entity(1, [{ type_short: "Pos", data: { x: 0 } }]),
      entity(2, [{ type_short: "Task", data: { status: "old" } }]),
    ]);
    const after = snapshot(8, [
      entity(1, [{ type_short: "Pos", data: { x: 1 } }]),
      entity(3, [{ type_short: "Agent", data: { name: "new" } }]),
    ]);
    const diff = diffWorld(before, after);
    expect(diff.t1).toBe(5);
    expect(diff.t2).toBe(8);
    expect(diff.summary).toEqual({
      spawnedCount: 1,
      destroyedCount: 1,
      modifiedCount: 1,
      totalFieldChanges: 3,
    });
  });

  it("counts nested fields for spawned and destroyed entities", () => {
    const before = snapshot(1, [entity(2, [{ type_short: "Task", data: { meta: { status: "old", owner: "a" } } }])]);
    const after = snapshot(2, [entity(3, [{ type_short: "Agent", data: { profile: { name: "new", state: "idle" } } }])]);
    const diff = diffWorld(before, after);
    expect(diff.summary.totalFieldChanges).toBe(4);
    expect(diff.entries.find((entry) => entry.entityId === 2)?.totalChanges).toBe(2);
    expect(diff.entries.find((entry) => entry.entityId === 3)?.totalChanges).toBe(2);
  });

  it("normalizes reversed tick order", () => {
    const older = snapshot(2, []);
    const newer = snapshot(1, [entity(1, [{ type_short: "A", data: { value: 1 } }])]);
    const diff = diffWorld(older, newer);
    expect(diff.t1).toBe(1);
    expect(diff.t2).toBe(2);
  });
});
