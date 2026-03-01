import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import TickTimeline from "../lib/TickTimeline.svelte";
import { world } from "../lib/state/world.svelte";
import { makeSpanEvent } from "./helpers";
import type { SpanEventMessage } from "../lib/types";

function makeTimelineSpan(
  span_id: string,
  start_time: number,
  end_time: number,
  overrides: Partial<SpanEventMessage> = {},
): SpanEventMessage {
  return makeSpanEvent(10, 1, {
    span_id,
    name: span_id,
    start_time,
    end_time,
    attributes: {
      "agentecs.tick": 10,
      "agentecs.entity_id": 1,
      "agentecs.system": "PlannerSystem",
    },
    ...overrides,
  });
}

describe("TickTimeline", () => {
  afterEach(() => {
    world.selectSpan(null);
  });

  it("shows empty state when no spans are provided", () => {
    render(TickTimeline, { spans: [] });

    expect(screen.getByTestId("timeline-empty")).toBeDefined();
    expect(screen.getByText("No spans for this tick")).toBeDefined();
  });

  it("renders a bar for each span", () => {
    const spans = [
      makeTimelineSpan("root", 10, 10.5),
      makeTimelineSpan("child", 10.1, 10.2, { parent_span_id: "root" }),
    ];

    render(TickTimeline, { spans });

    expect(screen.getAllByTestId("timeline-bar").length).toBe(2);
  });

  it("positions bars proportionally to start and end times", () => {
    const spans = [
      makeTimelineSpan("early", 10, 10.5),
      makeTimelineSpan("late", 10.25, 10.5),
    ];

    render(TickTimeline, { spans });

    const earlyBar = document.querySelector(
      "[data-span-id='early']",
    ) as SVGRectElement;
    const lateBar = document.querySelector(
      "[data-span-id='late']",
    ) as SVGRectElement;

    const earlyX = Number(earlyBar.getAttribute("x"));
    const earlyWidth = Number(earlyBar.getAttribute("width"));
    const lateX = Number(lateBar.getAttribute("x"));
    const lateWidth = Number(lateBar.getAttribute("width"));

    expect(lateX).toBeGreaterThan(earlyX);
    expect(lateWidth).toBeLessThan(earlyWidth);
  });

  it("keeps right-edge bars within timeline bounds", () => {
    const spans = [
      makeTimelineSpan("base", 10, 10.5),
      makeTimelineSpan("edge", 10.5, 10.5),
    ];

    render(TickTimeline, { spans });

    const edgeBar = document.querySelector(
      "[data-span-id='edge']",
    ) as SVGRectElement;
    const axisLine = document.querySelector("svg line") as SVGLineElement;

    const x = Number(edgeBar.getAttribute("x"));
    const width = Number(edgeBar.getAttribute("width"));
    const rightBound = Number(axisLine.getAttribute("x2"));

    expect(x + width).toBeLessThanOrEqual(rightBound + 1e-9);
  });

  it("selects a span when its bar is clicked", async () => {
    const spans = [makeTimelineSpan("selected", 10, 10.5)];

    render(TickTimeline, { spans });

    const selectedBar = document.querySelector(
      "[data-span-id='selected']",
    ) as SVGRectElement;
    await fireEvent.click(selectedBar);

    expect(world.selectedSpanId).toBe("selected");
  });
});
