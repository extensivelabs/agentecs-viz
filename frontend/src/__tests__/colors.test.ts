import { describe, it, expect } from "vitest";
import {
  hexToNumber,
  numberToHex,
  resolveArchetypeColor,
  resolveArchetypeColorCSS,
} from "../lib/colors";
import { hashString } from "../lib/utils";
import { DEFAULT_COLOR_PALETTE } from "../lib/config";

describe("colors", () => {
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

  describe("resolveArchetypeColorCSS (pure)", () => {
    it("returns config color as CSS hex", () => {
      const configMap = new Map([["A", { color: "#abc123" }]]);
      expect(resolveArchetypeColorCSS(["A"], configMap)).toBe("#abc123");
    });

    it("returns a hex string for palette-resolved colors", () => {
      const configMap = new Map<string, { color?: string }>();
      const css = resolveArchetypeColorCSS(["X", "Y"], configMap, ["#111111", "#222222", "#333333"]);
      expect(css).toMatch(/^#[0-9a-f]{6}$/);
    });
  });
});
