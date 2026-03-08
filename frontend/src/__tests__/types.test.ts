import { describe, expect, it } from "vitest";
import { isServerMessage } from "../lib/types";

describe("isServerMessage", () => {
  it("accepts valid tick_update message", () => {
    expect(
      isServerMessage({
        type: "tick_update",
        tick: 1,
        entity_count: 2,
        is_paused: false,
      }),
    ).toBe(true);
  });

  it("rejects incomplete snapshot payload", () => {
    expect(
      isServerMessage({
        type: "snapshot",
        tick: 1,
      }),
    ).toBe(false);
  });

  it("accepts valid snapshot payload", () => {
    expect(
      isServerMessage({
        type: "snapshot",
        tick: 1,
        snapshot: {
          tick: 1,
          timestamp: 1700000000,
          entity_count: 1,
          entities: [
            {
              id: 1,
              archetype: ["Agent", "Position"],
              components: [
                {
                  type_name: "mock.components.Agent",
                  type_short: "Agent",
                  data: { state: "idle" },
                },
              ],
            },
          ],
          archetypes: [["Agent", "Position"]],
          metadata: { source: "mock" },
        },
      }),
    ).toBe(true);
  });

  it("accepts valid delta payload", () => {
    expect(
      isServerMessage({
        type: "delta",
        tick: 2,
        delta: {
          tick: 2,
          timestamp: 1700000001,
          spawned: [],
          destroyed: [1],
          modified: {
            2: [
              {
                component_type: "Task",
                type_name: "mock.components.Task",
                old_value: null,
                new_value: { status: "in_progress" },
              },
            ],
          },
        },
      }),
    ).toBe(true);
  });

  it("accepts valid snapshot_response payload", () => {
    expect(
      isServerMessage({
        type: "snapshot_response",
        request_id: "req-1",
        tick: 1,
        snapshot: {
          tick: 1,
          timestamp: 1700000000,
          entity_count: 0,
          entities: [],
          archetypes: [],
          metadata: {},
        },
      }),
    ).toBe(true);
  });

  it("rejects malformed metadata payload", () => {
    expect(
      isServerMessage({
        type: "metadata",
        tick: 1,
        config: null,
        tick_range: [0],
        supports_history: true,
        is_paused: false,
      }),
    ).toBe(false);
  });

  it("rejects snapshot payloads with array snapshots", () => {
    expect(
      isServerMessage({
        type: "snapshot",
        tick: 1,
        snapshot: [],
      }),
    ).toBe(false);
  });

  it("rejects malformed delta payload", () => {
    expect(
      isServerMessage({
        type: "delta",
        tick: 1,
        delta: {},
      }),
    ).toBe(false);
  });
});
