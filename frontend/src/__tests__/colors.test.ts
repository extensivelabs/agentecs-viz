import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock world state before importing colors
vi.mock("../lib/state/world.svelte", () => {
  const state = {
    archetypeConfigMap: new Map(),
    config: null as { color_palette?: string[] | null } | null,
  };
  return { world: state };
});

import { hexToNumber, numberToHex, getArchetypeColor, getArchetypeColorCSS, resolveArchetypeColor } from "../lib/colors";
import { hashString } from "../lib/utils";
import { world } from "../lib/state/world.svelte";
import { DEFAULT_COLOR_PALETTE } from "../lib/config";

describe("colors", () => {
  beforeEach(() => {
    (world as { archetypeConfigMap: Map<string, unknown> }).archetypeConfigMap = new Map();
    (world as { config: unknown }).config = null;
  });

  describe("hexToNumber", () => {
    it("converts hex string to number", () => {
      expect(hexToNumber("#ff0000")).toBe(0xff0000);
      expect(hexToNumber("#00ff00")).toBe(0x00ff00);
      expect(hexToNumber("#0000ff")).toBe(0x0000ff);
    });

    it("handles lowercase", () => {
      expect(hexToNumber("#aabbcc")).toBe(0xaabbcc);
    });
  });

  describe("numberToHex", () => {
    it("converts number to hex string", () => {
      expect(numberToHex(0xff0000)).toBe("#ff0000");
      expect(numberToHex(0x00ff00)).toBe("#00ff00");
    });

    it("pads with zeros", () => {
      expect(numberToHex(0x0000ff)).toBe("#0000ff");
      expect(numberToHex(0)).toBe("#000000");
    });
  });

  describe("hexToNumber / numberToHex roundtrip", () => {
    it("roundtrips correctly", () => {
      const colors = ["#ff0000", "#00ff00", "#0000ff", "#123456", "#abcdef"];
      for (const hex of colors) {
        expect(numberToHex(hexToNumber(hex))).toBe(hex);
      }
    });
  });

  describe("hashString", () => {
    it("produces deterministic output", () => {
      expect(hashString("test")).toBe(hashString("test"));
    });

    it("produces different hashes for different strings", () => {
      expect(hashString("foo")).not.toBe(hashString("bar"));
    });
  });

  describe("getArchetypeColor", () => {
    it("returns same color for same archetype", () => {
      const a = getArchetypeColor(["A", "B"]);
      const b = getArchetypeColor(["A", "B"]);
      expect(a).toBe(b);
    });

    it("returns same color regardless of archetype order (sorted key)", () => {
      const a = getArchetypeColor(["B", "A"]);
      const b = getArchetypeColor(["A", "B"]);
      expect(a).toBe(b);
    });

    it("uses config color when available", () => {
      (world as { archetypeConfigMap: Map<string, { key: string; color: string }> }).archetypeConfigMap = new Map([
        ["A,B", { key: "A,B", color: "#ff0000" }],
      ]);
      expect(getArchetypeColor(["A", "B"])).toBe(0xff0000);
    });

    it("uses custom palette when config color not set", () => {
      (world as { config: { color_palette: string[] } }).config = {
        color_palette: ["#111111", "#222222", "#333333"],
      };
      const color = getArchetypeColor(["X", "Y"]);
      const palette = [0x111111, 0x222222, 0x333333];
      expect(palette).toContain(color);
    });

    it("falls back to DEFAULT_COLOR_PALETTE", () => {
      const color = getArchetypeColor(["Foo"]);
      expect(DEFAULT_COLOR_PALETTE).toContain(color);
    });

    it("different archetypes may get different colors", () => {
      // Not guaranteed for all pairs, but likely with enough variety
      const colors = new Set<number>();
      const archetypes = [["A"], ["B"], ["C"], ["D"], ["E"], ["F"], ["G"], ["H"]];
      for (const arch of archetypes) {
        colors.add(getArchetypeColor(arch));
      }
      // At least some should be different
      expect(colors.size).toBeGreaterThan(1);
    });
  });

  describe("getArchetypeColorCSS", () => {
    it("returns hex string", () => {
      const css = getArchetypeColorCSS(["A"]);
      expect(css).toMatch(/^#[0-9a-f]{6}$/);
    });
  });

  describe("resolveArchetypeColor (pure)", () => {
    it("uses config color when present", () => {
      const configMap = new Map([["A,B", { color: "#ff0000" }]]);
      expect(resolveArchetypeColor(["A", "B"], configMap)).toBe(0xff0000);
    });

    it("uses palette when config has no color", () => {
      const configMap = new Map<string, { color?: string }>();
      const palette = ["#111111", "#222222", "#333333"];
      const color = resolveArchetypeColor(["X", "Y"], configMap, palette);
      expect([0x111111, 0x222222, 0x333333]).toContain(color);
    });

    it("falls back to DEFAULT_COLOR_PALETTE with empty config", () => {
      const configMap = new Map<string, { color?: string }>();
      const color = resolveArchetypeColor(["Foo"], configMap);
      expect(DEFAULT_COLOR_PALETTE).toContain(color);
    });

    it("ignores config entry without color field", () => {
      const configMap = new Map([["A", {}]]);
      const color = resolveArchetypeColor(["A"], configMap);
      expect(DEFAULT_COLOR_PALETTE).toContain(color);
    });

    it("produces deterministic results", () => {
      const configMap = new Map<string, { color?: string }>();
      const a = resolveArchetypeColor(["A", "B"], configMap);
      const b = resolveArchetypeColor(["A", "B"], configMap);
      expect(a).toBe(b);
    });
  });
});
