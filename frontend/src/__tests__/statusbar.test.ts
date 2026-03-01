import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import StatusBar from "../lib/StatusBar.svelte";
import { world } from "../lib/state/world.svelte";
import { makeSnapshot } from "./helpers";

describe("StatusBar", () => {
  beforeEach(() => {
    world.disconnect();
  });

  it("shows connection and playback mode when connected", () => {
    world.connectionState = "connected";
    world.supportsHistory = true;
    world.tickRange = [0, 10];
    world.snapshot = makeSnapshot({ tick: 5, timestamp: 1700000000 });

    render(StatusBar);

    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("HISTORY")).toBeTruthy();
  });

  it("shows disconnected state without playback mode", () => {
    world.connectionState = "disconnected";
    world.snapshot = null;

    render(StatusBar);

    expect(screen.getByText("disconnected")).toBeTruthy();
    expect(screen.queryByText("LIVE")).toBeNull();
  });
});
