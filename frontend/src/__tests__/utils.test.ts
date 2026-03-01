import { describe, it, expect } from "vitest";
import {
  entityHash,
  formatCostUsd,
  formatTokens,
  getArchetypeDisplay,
  getArchetypeKey,
  hashString,
  severityClasses,
  severityLabel,
} from "../lib/utils";
import type { EntitySnapshot } from "../lib/types";

describe("utils", () => {
  it("hashString is deterministic", () => {
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).not.toBe(hashString("abcd"));
  });

  it("getArchetypeKey and getArchetypeDisplay sort values", () => {
    expect(getArchetypeKey(["Task", "Agent"])).toBe("Agent,Task");
    expect(getArchetypeDisplay(["Task", "Agent"])).toBe("Agent, Task");
  });

  it("entityHash is stable across component and key ordering", () => {
    const entityA: EntitySnapshot = {
      id: 1,
      archetype: ["Agent", "Position"],
      components: [
        {
          type_name: "Position",
          type_short: "Position",
          data: { y: 2, x: 1 },
        },
        {
          type_name: "Agent",
          type_short: "Agent",
          data: { state: "idle", name: "a1" },
        },
      ],
    };

    const entityB: EntitySnapshot = {
      id: 1,
      archetype: ["Position", "Agent"],
      components: [
        {
          type_name: "Agent",
          type_short: "Agent",
          data: { name: "a1", state: "idle" },
        },
        {
          type_name: "Position",
          type_short: "Position",
          data: { x: 1, y: 2 },
        },
      ],
    };

    expect(entityHash(entityA)).toBe(entityHash(entityB));
  });

  it("severity helpers return expected labels/classes", () => {
    expect(severityLabel("critical")).toBe("CRIT");
    expect(severityLabel("warning")).toBe("WARN");
    expect(severityLabel("info")).toBe("INFO");
    expect(severityLabel("custom")).toBe("CUSTOM");

    expect(severityClasses("critical")).toContain("text-error");
    expect(severityClasses("warning")).toContain("text-warning");
    expect(severityClasses("info")).toContain("text-accent");
    expect(severityClasses("custom")).toContain("text-text-muted");
  });

  it("formats token counts and USD costs", () => {
    expect(formatTokens(12345)).toBe("12,345");
    expect(formatCostUsd(2)).toBe("$2.00");
    expect(formatCostUsd(0.1234)).toBe("$0.1234");
  });
});
