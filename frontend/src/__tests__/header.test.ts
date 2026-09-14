import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import Header from "../lib/Header.svelte";
import { world } from "../lib/state/world.svelte";
import { makeConfig, makeSnapshot } from "./helpers";

describe("Header", () => {
  beforeEach(() => {
    world.disconnect();
    world.connectionState = "connected";
    world.config = makeConfig({ world_name: "Header Test" });
    world.tickRange = [0, 10];
    world.snapshot = makeSnapshot({ tick: 5, entity_count: 2 });
    world.spans = [];
    world.errors = [];
  });

  it("exposes connection status on the indicator dot", () => {
    render(Header);
    expect(screen.getByLabelText("Connection status: connected")).toBeTruthy();
  });

  it("rejects negative tick input", async () => {
    render(Header);
    const seekSpy = vi.spyOn(world, "seek");

    await fireEvent.click(screen.getByRole("button", { name: "5" }));
    const input = screen.getByDisplayValue("5") as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "-2" } });
    await fireEvent.keyDown(input, { key: "Enter" });

    expect(seekSpy).not.toHaveBeenCalled();
  });
});
