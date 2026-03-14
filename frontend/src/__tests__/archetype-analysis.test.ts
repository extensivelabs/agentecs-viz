import { describe, expect, it } from "vitest";
import {
  computeEntityArchetypeHistory,
  summarizeArchetypes,
} from "../lib/archetype-analysis";
import { makeEntity, makeSnapshot } from "./helpers";

describe("summarizeArchetypes", () => {
  it("derives counts from entities and resolves labels and colors", () => {
    const summaries = summarizeArchetypes(
      [
        makeEntity(1, ["Agent", "Position"]),
        makeEntity(2, ["Position", "Agent"]),
        makeEntity(3, ["Task"]),
      ],
      new Map([
        ["Agent,Position", { label: "Agent / Position", color: "#123456" }],
      ]),
    );

    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({
      key: "Agent,Position",
      label: "Agent / Position",
      color: "#123456",
      entityCount: 2,
    });
    expect(summaries[0].percentage).toBeCloseTo(66.666, 2);
    expect(summaries[1]).toMatchObject({
      key: "Task",
      entityCount: 1,
      label: "Task",
    });
  });
});

describe("computeEntityArchetypeHistory", () => {
  it("records spawn and archetype changes across snapshots", () => {
    const history = computeEntityArchetypeHistory(
      [
        makeSnapshot({ tick: 1, entity_count: 1, entities: [makeEntity(1, ["Agent"])] }),
        makeSnapshot({ tick: 2, entity_count: 1, entities: [makeEntity(1, ["Agent", "Position"])] }),
        makeSnapshot({ tick: 3, entity_count: 1, entities: [makeEntity(1, ["Agent", "Position"])] }),
      ],
      1,
      new Map([["Agent,Position", { label: "Agent / Position" }]]),
    );

    expect(history).toEqual([
      {
        tick: 1,
        kind: "spawned",
        archetype: ["Agent"],
        key: "Agent",
        label: "Agent",
      },
      {
        tick: 2,
        kind: "changed",
        archetype: ["Agent", "Position"],
        key: "Agent,Position",
        label: "Agent / Position",
      },
    ]);
  });

  it("ignores unchanged snapshots after the initial spawn", () => {
    const history = computeEntityArchetypeHistory(
      [
        makeSnapshot({ tick: 4, entity_count: 1, entities: [makeEntity(2, ["Task"])] }),
        makeSnapshot({ tick: 5, entity_count: 1, entities: [makeEntity(2, ["Task"])] }),
      ],
      2,
      new Map(),
    );

    expect(history).toEqual([
      {
        tick: 4,
        kind: "spawned",
        archetype: ["Task"],
        key: "Task",
        label: "Task",
      },
    ]);
  });

  it("records respawns even when the archetype returns unchanged", () => {
    const history = computeEntityArchetypeHistory(
      [
        makeSnapshot({ tick: 1, entity_count: 1, entities: [makeEntity(3, ["Task"])] }),
        makeSnapshot({ tick: 2, entity_count: 0, entities: [] }),
        makeSnapshot({ tick: 3, entity_count: 1, entities: [makeEntity(3, ["Task"])] }),
      ],
      3,
      new Map(),
    );

    expect(history).toEqual([
      {
        tick: 1,
        kind: "spawned",
        archetype: ["Task"],
        key: "Task",
        label: "Task",
      },
      {
        tick: 3,
        kind: "spawned",
        archetype: ["Task"],
        key: "Task",
        label: "Task",
      },
    ]);
  });
});
