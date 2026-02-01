import { describe, it, expect } from "vitest";
import { getArchetypeKey, getArchetypeDisplay, entityHash } from "../utils";
import type { EntitySnapshot } from "../websocket";

describe("getArchetypeKey", () => {
  it("sorts and joins archetype names with comma", () => {
    expect(getArchetypeKey(["B", "A", "C"])).toBe("A,B,C");
    expect(getArchetypeKey(["Task", "AgentState"])).toBe("AgentState,Task");
  });

  it("handles single component", () => {
    expect(getArchetypeKey(["Task"])).toBe("Task");
  });

  it("handles empty archetype", () => {
    expect(getArchetypeKey([])).toBe("");
  });

  it("does not mutate original array", () => {
    const original = ["B", "A", "C"];
    getArchetypeKey(original);
    expect(original).toEqual(["B", "A", "C"]);
  });
});

describe("getArchetypeDisplay", () => {
  it("sorts and joins with comma-space for display", () => {
    expect(getArchetypeDisplay(["B", "A", "C"])).toBe("A, B, C");
  });

  it("handles single component", () => {
    expect(getArchetypeDisplay(["Task"])).toBe("Task");
  });
});

describe("entityHash", () => {
  it("generates consistent hash for same entity", () => {
    const entity: EntitySnapshot = {
      id: 1,
      archetype: ["Task", "AgentState"],
      components: [
        { type_name: "Task", type_short: "Task", data: { id: "1", status: "completed" } },
        { type_name: "AgentState", type_short: "AgentState", data: { count: 0 } },
      ],
    };

    const hash1 = entityHash(entity);
    const hash2 = entityHash(entity);
    expect(hash1).toBe(hash2);
  });

  it("detects archetype changes", () => {
    const entity1: EntitySnapshot = {
      id: 1,
      archetype: ["Task"],
      components: [{ type_name: "Task", type_short: "Task", data: {} }],
    };

    const entity2: EntitySnapshot = {
      id: 1,
      archetype: ["Task", "AgentState"],
      components: [{ type_name: "Task", type_short: "Task", data: {} }],
    };

    expect(entityHash(entity1)).not.toBe(entityHash(entity2));
  });

  it("detects component data key count changes", () => {
    const entity1: EntitySnapshot = {
      id: 1,
      archetype: ["Task"],
      components: [{ type_name: "Task", type_short: "Task", data: { a: 1 } }],
    };

    const entity2: EntitySnapshot = {
      id: 1,
      archetype: ["Task"],
      components: [{ type_name: "Task", type_short: "Task", data: { a: 1, b: 2 } }],
    };

    expect(entityHash(entity1)).not.toBe(entityHash(entity2));
  });

  it("generates predictable format", () => {
    const entity: EntitySnapshot = {
      id: 1,
      archetype: ["Task"],
      components: [{ type_name: "Task", type_short: "Task", data: { a: 1, b: 2 } }],
    };

    expect(entityHash(entity)).toBe("Task::Task:2");
  });
});
