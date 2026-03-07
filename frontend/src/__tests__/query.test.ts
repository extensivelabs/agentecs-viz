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

const entityWithValues = makeEntity(10, [
  { type_short: "Agent", data: { state: "idle", score: 1 } },
]);
const entityWithOtherValue = makeEntity(11, [
  { type_short: "Agent", data: { state: "working", score: 5 } },
]);
const entityAtUpperBound = makeEntity(12, [
  { type_short: "Agent", data: { state: "idle", score: 10 } },
]);
const entityWithNonNumeric = makeEntity(13, [
  { type_short: "Agent", data: { state: "idle", score: "high" } },
]);
const entityWithoutAgent = makeEntity(14, [{ type_short: "Task", data: { status: "pending" } }]);
const entityWithNaN = makeEntity(15, [
  { type_short: "Agent", data: { state: "unknown", score: Number.NaN } },
]);

const entitiesWithValues = [
  entityWithValues,
  entityWithOtherValue,
  entityAtUpperBound,
  entityWithNonNumeric,
  entityWithoutAgent,
  entityWithNaN,
];

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

  it("value_eq matches entities with matching field value", () => {
    const q: QueryDef = {
      name: "",
      clauses: [
        {
          type: "value_eq",
          component: "Agent",
          field: "state",
          value: "idle",
        },
      ],
    };

    expect(matchesQuery(entityWithValues, q)).toBe(true);
    expect(matchesQuery(entityWithOtherValue, q)).toBe(false);
    expect(matchesQuery(entityWithoutAgent, q)).toBe(false);
  });

  it("value_range matches numbers in [min, max)", () => {
    const q: QueryDef = {
      name: "",
      clauses: [
        {
          type: "value_range",
          component: "Agent",
          field: "score",
          min: 1,
          max: 10,
        },
      ],
    };

    expect(matchesQuery(entityWithValues, q)).toBe(true);
    expect(matchesQuery(entityWithOtherValue, q)).toBe(true);
    expect(matchesQuery(entityAtUpperBound, q)).toBe(false);
    expect(matchesQuery(entityWithNonNumeric, q)).toBe(false);
    expect(matchesQuery(entityWithNaN, q)).toBe(false);
  });

  it("value_range supports inclusive upper bound when requested", () => {
    const q: QueryDef = {
      name: "",
      clauses: [
        {
          type: "value_range",
          component: "Agent",
          field: "score",
          min: 1,
          max: 10,
          inclusiveMax: true,
        },
      ],
    };

    expect(matchesQuery(entityAtUpperBound, q)).toBe(true);
  });

  it("WITH + value_eq clauses work together", () => {
    const q: QueryDef = {
      name: "",
      clauses: [
        { type: "with", component: "Agent" },
        {
          type: "value_eq",
          component: "Agent",
          field: "state",
          value: "working",
        },
      ],
    };

    expect(matchesQuery(entityWithValues, q)).toBe(false);
    expect(matchesQuery(entityWithOtherValue, q)).toBe(true);
    expect(matchesQuery(entityWithoutAgent, q)).toBe(false);
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

  it("counts entities for value clauses", () => {
    const q: QueryDef = {
      name: "",
      clauses: [
        {
          type: "value_eq",
          component: "Agent",
          field: "state",
          value: "idle",
        },
      ],
    };

    expect(queryMatchCount(entitiesWithValues, q)).toBe(3);
  });
});

describe("matchingEntityIds", () => {
  it("returns set of matching entity IDs", () => {
    const q: QueryDef = { name: "", clauses: [{ type: "with", component: "Position" }] };
    const ids = matchingEntityIds(entities, q);
    expect(ids).toEqual(new Set([1, 4]));
  });

  it("returns IDs for value_range clauses", () => {
    const q: QueryDef = {
      name: "",
      clauses: [
        {
          type: "value_range",
          component: "Agent",
          field: "score",
          min: 1,
          max: 6,
        },
      ],
    };

    const ids = matchingEntityIds(entitiesWithValues, q);
    expect(ids).toEqual(new Set([10, 11]));
  });
});
