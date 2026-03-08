import { describe, expect, it } from "vitest";
import { archetypeKey, filterEntries, type TemporalFilters } from "../lib/state/temporal.svelte";
import type { WorldDiffEntry } from "../lib/diff";

function makeEntry(overrides: Partial<WorldDiffEntry> = {}): WorldDiffEntry {
  return {
    entityId: 1,
    changeType: "modified",
    archetype: ["Agent", "Position"],
    entity: {
      id: 1,
      archetype: ["Agent", "Position"],
      components: [
        {
          type_name: "mod.Agent",
          type_short: "Agent",
          data: { name: "a1" },
        },
      ],
    },
    components: [],
    totalChanges: 2,
    ...overrides,
  };
}

function filters(overrides: Partial<TemporalFilters> = {}): TemporalFilters {
  return {
    archetypes: [],
    components: [],
    changeTypes: [],
    minFieldChanges: 0,
    ...overrides,
  };
}

describe("archetypeKey", () => {
  it("normalizes component order", () => {
    expect(archetypeKey(["Position", "Agent"])).toBe("Agent,Position");
  });
});

describe("filterEntries", () => {
  const entries = [
    makeEntry(),
    makeEntry({
      entityId: 2,
      changeType: "spawned",
      archetype: ["Task"],
      entity: {
        id: 2,
        archetype: ["Task"],
        components: [],
      },
      totalChanges: 1,
    }),
    makeEntry({
      entityId: 3,
      changeType: "destroyed",
      archetype: ["Agent", "Task"],
      entity: {
        id: 3,
        archetype: ["Agent", "Task"],
        components: [],
      },
      totalChanges: 5,
    }),
  ];

  it("filters by change type", () => {
    expect(filterEntries(entries, filters({ changeTypes: ["spawned"] })).map((entry) => entry.entityId)).toEqual([2]);
  });

  it("filters by archetype", () => {
    expect(
      filterEntries(entries, filters({ archetypes: ["Agent,Position"] })).map((entry) => entry.entityId),
    ).toEqual([1]);
  });

  it("filters by component presence", () => {
    expect(filterEntries(entries, filters({ components: ["Task"] })).map((entry) => entry.entityId)).toEqual([2, 3]);
  });

  it("filters by minimum field changes", () => {
    expect(filterEntries(entries, filters({ minFieldChanges: 3 })).map((entry) => entry.entityId)).toEqual([3]);
  });

  it("combines filters", () => {
    expect(
      filterEntries(
        entries,
        filters({
          components: ["Agent"],
          changeTypes: ["destroyed"],
          minFieldChanges: 4,
        }),
      ).map((entry) => entry.entityId),
    ).toEqual([3]);
  });
});
