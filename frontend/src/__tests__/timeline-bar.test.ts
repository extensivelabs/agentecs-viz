import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import TimelineBar from "../lib/TimelineBar.svelte";
import { world } from "../lib/state/world.svelte";
import { timeline } from "../lib/state/timeline.svelte";
import { MockWebSocket, makeSnapshot, makeConfig } from "./helpers";
import type { MetadataMessage, SnapshotMessage } from "../lib/types";

function connectWithHistory(tick = 5, maxTick = 10) {
  world.connect("ws://test/ws");
  const ws = MockWebSocket.instances[0];
  ws.simulateOpen();
  ws.simulateMessage({
    type: "metadata",
    tick: 0,
    config: makeConfig(),
    tick_range: [0, maxTick],
    supports_history: true,
    is_paused: false,
  } satisfies MetadataMessage);
  ws.simulateMessage({
    type: "snapshot",
    tick,
    snapshot: makeSnapshot({ tick }),
  } satisfies SnapshotMessage);
}

function connectWithoutHistory(tick = 5) {
  world.connect("ws://test/ws");
  const ws = MockWebSocket.instances[0];
  ws.simulateOpen();
  ws.simulateMessage({
    type: "metadata",
    tick: 0,
    config: makeConfig(),
    tick_range: null,
    supports_history: false,
    is_paused: false,
  } satisfies MetadataMessage);
  ws.simulateMessage({
    type: "snapshot",
    tick,
    snapshot: makeSnapshot({ tick }),
  } satisfies SnapshotMessage);
}

describe("TimelineState speed edge cases", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    timeline.playbackSpeed = 1.0;
  });

  afterEach(() => {
    world.disconnect();
    timeline.playbackSpeed = 1.0;
    vi.restoreAllMocks();
  });

  it("nextSpeed finds closest when playbackSpeed not in list", () => {
    connectWithHistory();
    // Set speed to a value not in availableSpeeds [0.5, 1, 2, 5, 10]
    timeline.playbackSpeed = 3;
    const spy = vi.spyOn(world, "setSpeed");

    timeline.nextSpeed();
    // Closest to 3 is 2 (idx=2), next is 5 (idx=3)
    expect(timeline.playbackSpeed).toBe(5);
    expect(spy).toHaveBeenCalledWith(5);
  });

  it("prevSpeed finds closest when playbackSpeed not in list", () => {
    connectWithHistory();
    timeline.playbackSpeed = 3;
    const spy = vi.spyOn(world, "setSpeed");

    timeline.prevSpeed();
    // Closest to 3 is 2 (idx=2), prev is 1 (idx=1)
    expect(timeline.playbackSpeed).toBe(1);
    expect(spy).toHaveBeenCalledWith(1);
  });

  it("prevSpeed does nothing when closest is first speed", () => {
    connectWithHistory();
    timeline.playbackSpeed = 0.3;
    const spy = vi.spyOn(world, "setSpeed");

    timeline.prevSpeed();
    // Closest to 0.3 is 0.5 (idx=0), no prev available
    expect(spy).not.toHaveBeenCalled();
    expect(timeline.playbackSpeed).toBe(0.3);
  });
});

describe("TimelineBar", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    world.disconnect();
    vi.restoreAllMocks();
  });

  it("renders playback controls", () => {
    connectWithHistory();
    render(TimelineBar);

    expect(screen.getByLabelText("Step back")).toBeTruthy();
    expect(screen.getByLabelText("Pause")).toBeTruthy();
    expect(screen.getByLabelText("Step forward")).toBeTruthy();
  });

  it("shows tick display with current/max tick", () => {
    connectWithHistory(5, 10);
    render(TimelineBar);

    const display = screen.getByTestId("tick-display");
    expect(display.textContent).toContain("5");
    expect(display.textContent).toContain("10");
  });

  it("play/pause toggle calls world.togglePause()", async () => {
    connectWithHistory();
    render(TimelineBar);

    const spy = vi.spyOn(world, "togglePause");
    const btn = screen.getByLabelText("Pause");
    await fireEvent.click(btn);
    expect(spy).toHaveBeenCalled();
  });

  it("step back calls world.stepBack()", async () => {
    connectWithHistory(5, 10);
    render(TimelineBar);

    const spy = vi.spyOn(world, "stepBack");
    const btn = screen.getByLabelText("Step back");
    await fireEvent.click(btn);
    expect(spy).toHaveBeenCalled();
  });

  it("step back is disabled at min tick", () => {
    connectWithHistory(0, 10);
    render(TimelineBar);

    const btn = screen.getByLabelText("Step back") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("step back is disabled when history not supported", () => {
    connectWithoutHistory();
    render(TimelineBar);

    const btn = screen.getByLabelText("Step back") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("LIVE button visible when not at live tick", () => {
    connectWithHistory(5, 10);
    render(TimelineBar);

    expect(screen.getByLabelText("Go to live")).toBeTruthy();
  });

  it("LIVE button hidden when at live tick", () => {
    connectWithHistory(10, 10);
    render(TimelineBar);

    expect(screen.queryByLabelText("Go to live")).toBeNull();
  });

  it("speed button shows current speed", () => {
    connectWithHistory();
    render(TimelineBar);

    const btn = screen.getByTestId("speed-button");
    expect(btn.textContent).toContain("1x");
  });

  it("speed button cycles through all speeds and wraps around", async () => {
    connectWithHistory();
    render(TimelineBar);

    const btn = screen.getByTestId("speed-button");
    const speeds = ["2x", "5x", "10x", "0.5x", "1x"];
    for (const expected of speeds) {
      await fireEvent.click(btn);
      expect(btn.textContent).toContain(expected);
    }
  });

  it("mode indicator shows correct label", () => {
    connectWithHistory(5, 10);
    render(TimelineBar);

    const indicator = screen.getByTestId("mode-indicator");
    expect(indicator.textContent).toContain("HISTORY");
  });

  it("mode indicator shows LIVE when at max tick and not paused", () => {
    connectWithHistory(10, 10);
    render(TimelineBar);

    const indicator = screen.getByTestId("mode-indicator");
    expect(indicator.textContent).toContain("LIVE");
  });

  it("keyboard Space toggles pause", async () => {
    connectWithHistory();
    render(TimelineBar);

    const spy = vi.spyOn(world, "togglePause");
    await fireEvent.keyDown(window, { key: " " });
    expect(spy).toHaveBeenCalled();
  });

  it("keyboard ArrowRight steps forward", async () => {
    connectWithHistory();
    render(TimelineBar);

    const spy = vi.spyOn(world, "step");
    await fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(spy).toHaveBeenCalled();
  });

  it("keyboard ArrowLeft steps back", async () => {
    connectWithHistory(5, 10);
    render(TimelineBar);

    const spy = vi.spyOn(world, "stepBack");
    await fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(spy).toHaveBeenCalled();
  });

  it("keyboard shortcuts ignored when input is focused", async () => {
    connectWithHistory(5, 10);
    render(TimelineBar);

    const input = document.createElement("input");
    document.body.appendChild(input);

    const pauseSpy = vi.spyOn(world, "togglePause");
    const stepSpy = vi.spyOn(world, "step");
    const stepBackSpy = vi.spyOn(world, "stepBack");

    await fireEvent.keyDown(input, { key: " " });
    await fireEvent.keyDown(input, { key: "ArrowRight" });
    await fireEvent.keyDown(input, { key: "ArrowLeft" });

    expect(pauseSpy).not.toHaveBeenCalled();
    expect(stepSpy).not.toHaveBeenCalled();
    expect(stepBackSpy).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  it("scrubber has correct ARIA attributes", () => {
    connectWithHistory(5, 10);
    render(TimelineBar);

    const slider = screen.getByRole("slider");
    expect(slider.getAttribute("aria-valuenow")).toBe("5");
    expect(slider.getAttribute("aria-valuemin")).toBe("0");
    expect(slider.getAttribute("aria-valuemax")).toBe("10");
  });

  it("has toolbar role", () => {
    connectWithHistory();
    render(TimelineBar);

    expect(screen.getByRole("toolbar")).toBeTruthy();
  });
});
