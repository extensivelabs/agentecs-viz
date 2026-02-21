import { describe, it, expect } from "vitest";
import {
  matchesQuery,
  getAvailableComponents,
  filterSuggestions,
  queryMatchCount,
  matchingEntityIds,
  type QueryDef,
} from "../lib/query";
import { makeEntity } from "./helpers";

const agentPos = makeEntity(1, ["Agent", "Position"]);
const task = makeEntity(2, ["Task"]);
const agentTask = makeEntity(3, ["Agent", "Task"]);
const position = makeEntity(4, ["Position"]);

const entities = [agentPos, task, agentTask, position];

describe("matchesQuery", () => {
  it("empty query matches everything", () => {
    const q: QueryDef = { name: "", clauses: [] };
    expect(matchesQuery(agentPos, q)).toBe(true);
    expect(matchesQuery(task, q)).toBe(true);
  });

  it("WITH clause matches entities that have the component", () => {
    const q: QueryDef = { name: "", clauses: [{ type: "with", component: "Agent" }] };
    expect(matchesQuery(agentPos, q)).toBe(true);
    expect(matchesQuery(agentTask, q)).toBe(true);
    expect(matchesQuery(task, q)).toBe(false);
    expect(matchesQuery(position, q)).toBe(false);
  });

  it("WITHOUT clause excludes entities with the component", () => {
    const q: QueryDef = { name: "", clauses: [{ type: "without", component: "Task" }] };
    expect(matchesQuery(agentPos, q)).toBe(true);
    expect(matchesQuery(position, q)).toBe(true);
    expect(matchesQuery(task, q)).toBe(false);
    expect(matchesQuery(agentTask, q)).toBe(false);
  });

  it("multiple WITH clauses require all components", () => {
    const q: QueryDef = {
      name: "",
      clauses: [
        { type: "with", component: "Agent" },
        { type: "with", component: "Position" },
      ],
    };
    expect(matchesQuery(agentPos, q)).toBe(true);
    expect(matchesQuery(agentTask, q)).toBe(false);
    expect(matchesQuery(task, q)).toBe(false);
  });

  it("WITH + WITHOUT combined", () => {
    const q: QueryDef = {
      name: "",
      clauses: [
        { type: "with", component: "Agent" },
        { type: "without", component: "Task" },
      ],
    };
    expect(matchesQuery(agentPos, q)).toBe(true);
    expect(matchesQuery(agentTask, q)).toBe(false);
    expect(matchesQuery(task, q)).toBe(false);
  });
});

describe("getAvailableComponents", () => {
  it("extracts sorted unique component types", () => {
    expect(getAvailableComponents(entities)).toEqual(["Agent", "Position", "Task"]);
  });

  it("returns empty array for no entities", () => {
    expect(getAvailableComponents([])).toEqual([]);
  });
});

describe("filterSuggestions", () => {
  const available = ["Agent", "AgentState", "Position", "Task"];

  it("filters by substring match (case-insensitive)", () => {
    expect(filterSuggestions(available, "ag", new Set())).toEqual(["Agent", "AgentState"]);
  });

  it("excludes already-used components", () => {
    expect(filterSuggestions(available, "ag", new Set(["Agent"]))).toEqual(["AgentState"]);
  });

  it("returns empty for no match", () => {
    expect(filterSuggestions(available, "xyz", new Set())).toEqual([]);
  });
});

describe("queryMatchCount", () => {
  it("counts matching entities", () => {
    const q: QueryDef = { name: "", clauses: [{ type: "with", component: "Agent" }] };
    expect(queryMatchCount(entities, q)).toBe(2);
  });

  it("returns total count for empty query", () => {
    expect(queryMatchCount(entities, { name: "", clauses: [] })).toBe(4);
  });
});

describe("matchingEntityIds", () => {
  it("returns set of matching entity IDs", () => {
    const q: QueryDef = { name: "", clauses: [{ type: "with", component: "Position" }] };
    const ids = matchingEntityIds(entities, q);
    expect(ids).toEqual(new Set([1, 4]));
  });
});
