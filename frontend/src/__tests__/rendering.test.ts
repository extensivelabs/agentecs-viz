import { describe, it, expect } from "vitest";
import { clampTooltipPosition } from "../lib/rendering";

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
