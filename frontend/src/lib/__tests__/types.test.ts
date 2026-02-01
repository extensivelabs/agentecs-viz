import { describe, it, expect } from "vitest";
import {
  isRecord,
  isServerMessage,
  isTaskData,
  isAgentStateData,
  isComponentSnapshot,
  isEntitySnapshot,
  isWorldSnapshot,
} from "../types";

describe("isRecord", () => {
  it("returns true for plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ key: "value" })).toBe(true);
  });

  it("returns false for non-objects", () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord("string")).toBe(false);
    expect(isRecord(123)).toBe(false);
    expect(isRecord([])).toBe(false);
  });
});

describe("isComponentSnapshot", () => {
  it("validates valid component snapshots", () => {
    expect(
      isComponentSnapshot({
        type_name: "Task",
        type_short: "Task",
        data: { id: "1", status: "completed" },
      })
    ).toBe(true);
  });

  it("rejects invalid component snapshots", () => {
    expect(isComponentSnapshot({})).toBe(false);
    expect(isComponentSnapshot({ type_name: "Task" })).toBe(false);
    expect(isComponentSnapshot({ type_name: "Task", type_short: "Task" })).toBe(false);
    expect(isComponentSnapshot({ type_name: "Task", type_short: "Task", data: "not-object" })).toBe(
      false
    );
  });
});

describe("isEntitySnapshot", () => {
  it("validates valid entity snapshots", () => {
    expect(
      isEntitySnapshot({
        id: 1,
        archetype: ["Task", "AgentState"],
        components: [
          { type_name: "Task", type_short: "Task", data: {} },
          { type_name: "AgentState", type_short: "AgentState", data: {} },
        ],
      })
    ).toBe(true);
  });

  it("rejects invalid entity snapshots", () => {
    expect(isEntitySnapshot({})).toBe(false);
    expect(isEntitySnapshot({ id: "string", archetype: [], components: [] })).toBe(false);
    expect(isEntitySnapshot({ id: 1, archetype: "string", components: [] })).toBe(false);
    expect(isEntitySnapshot({ id: 1, archetype: [123], components: [] })).toBe(false);
  });
});

describe("isWorldSnapshot", () => {
  it("validates valid world snapshots", () => {
    expect(
      isWorldSnapshot({
        tick: 0,
        entity_count: 0,
        entities: [],
      })
    ).toBe(true);
  });

  it("rejects invalid world snapshots", () => {
    expect(isWorldSnapshot({})).toBe(false);
    expect(isWorldSnapshot({ tick: "0", entity_count: 0, entities: [] })).toBe(false);
  });
});

describe("isServerMessage", () => {
  it("validates tick events", () => {
    expect(
      isServerMessage({
        type: "tick",
        snapshot: { tick: 1, entity_count: 0, entities: [] },
      })
    ).toBe(true);
  });

  it("validates error events", () => {
    expect(
      isServerMessage({
        type: "error",
        message: "Something went wrong",
      })
    ).toBe(true);
  });

  it("validates history_info events", () => {
    expect(
      isServerMessage({
        type: "history_info",
        supports_replay: true,
        tick_range: [0, 100],
        is_paused: false,
      })
    ).toBe(true);

    expect(
      isServerMessage({
        type: "history_info",
        supports_replay: false,
        tick_range: null,
        is_paused: true,
      })
    ).toBe(true);
  });

  it("validates seek_complete events", () => {
    expect(
      isServerMessage({
        type: "seek_complete",
        tick: 50,
        snapshot: { tick: 50, entity_count: 0, entities: [] },
      })
    ).toBe(true);
  });

  it("rejects invalid messages", () => {
    expect(isServerMessage({})).toBe(false);
    expect(isServerMessage({ type: "unknown" })).toBe(false);
    expect(isServerMessage({ type: "tick" })).toBe(false);
    expect(isServerMessage({ type: "error" })).toBe(false);
    expect(isServerMessage("string")).toBe(false);
  });
});

describe("isTaskData", () => {
  it("validates valid task data", () => {
    expect(
      isTaskData({
        id: "task-1",
        description: "Test task",
        status: "completed",
        result: "Done",
        user_query: null,
        user_response: null,
      })
    ).toBe(true);
  });

  it("validates all status values", () => {
    const statuses = ["unassigned", "in_progress", "waiting_for_input", "completed"] as const;
    for (const status of statuses) {
      expect(
        isTaskData({
          id: "1",
          description: "test",
          status,
          result: null,
          user_query: null,
          user_response: null,
        })
      ).toBe(true);
    }
  });

  it("rejects invalid task data", () => {
    expect(isTaskData({})).toBe(false);
    expect(isTaskData({ id: "1", description: "test", status: "invalid" })).toBe(false);
    expect(isTaskData({ id: 1, description: "test", status: "completed" })).toBe(false);
  });
});

describe("isAgentStateData", () => {
  it("validates valid agent state data", () => {
    expect(
      isAgentStateData({
        system_prompt: "You are a helpful assistant",
        conversation_history: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi!" },
        ],
        iteration_count: 2,
      })
    ).toBe(true);
  });

  it("rejects invalid agent state data", () => {
    expect(isAgentStateData({})).toBe(false);
    expect(
      isAgentStateData({
        system_prompt: "test",
        conversation_history: "not-array",
        iteration_count: 0,
      })
    ).toBe(false);
    expect(
      isAgentStateData({
        system_prompt: "test",
        conversation_history: [{ role: "user" }], // missing content
        iteration_count: 0,
      })
    ).toBe(false);
  });
});
