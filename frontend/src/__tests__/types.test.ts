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
});
