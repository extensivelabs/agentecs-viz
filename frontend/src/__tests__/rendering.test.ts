import { describe, it, expect } from "vitest";
import {
  adaptiveMaxRadius,
  clampTooltipPosition,
  entityRadius,
  layoutSpacing,
} from "../lib/rendering";

describe("adaptiveMaxRadius", () => {
  it("returns max radius for small worlds", () => {
    expect(adaptiveMaxRadius(10)).toBe(20);
  });

  it("shrinks radius as entity count increases", () => {
    expect(adaptiveMaxRadius(100)).toBeLessThan(20);
    expect(adaptiveMaxRadius(500)).toBeLessThanOrEqual(12);
    expect(adaptiveMaxRadius(1000)).toBe(6);
  });
});

describe("layoutSpacing", () => {
  it("tracks adaptive radius", () => {
    expect(layoutSpacing(10)).toBe(40);
    expect(layoutSpacing(1000)).toBe(12);
  });
});

describe("entityRadius", () => {
  it("grows with component count up to cap", () => {
    expect(entityRadius(0)).toBe(8);
    expect(entityRadius(2)).toBe(12);
    expect(entityRadius(20)).toBe(20);
  });

  it("respects minimum radius when maxRadius is small", () => {
    expect(entityRadius(0, 1)).toBe(6);
  });
});

describe("clampTooltipPosition", () => {
  it("keeps coordinates when already within bounds", () => {
    const clamped = clampTooltipPosition(100, 80, 400, 300, 120, 50);

    expect(clamped).toEqual({ x: 100, y: 80 });
  });

  it("clamps to minimum padding on top-left overflow", () => {
    const clamped = clampTooltipPosition(-25, -10, 400, 300, 120, 50);

    expect(clamped.x).toBe(4);
    expect(clamped.y).toBe(4);
  });

  it("clamps to maximum bounds on bottom-right overflow", () => {
    const clamped = clampTooltipPosition(390, 290, 400, 300, 120, 50);

    expect(clamped.x).toBe(276);
    expect(clamped.y).toBe(246);
  });

  it("pins to padding when tooltip is larger than container", () => {
    const clamped = clampTooltipPosition(40, 50, 100, 80, 160, 120);

    expect(clamped.x).toBe(4);
    expect(clamped.y).toBe(4);
  });
});
