import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import Header from "../lib/Header.svelte";
import { world } from "../lib/state/world.svelte";
import { makeConfig, makeSnapshot } from "./helpers";

function identityResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      name: "AgentECS Visualizer",
      version: "0.4.1",
      source_type: "MockWorldSource",
      tick: 5,
      ...overrides,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function stubFetch(respond: () => Promise<Response>): void {
  vi.stubGlobal("fetch", respond);
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function openAbout(): Promise<void> {
  await fireEvent.click(screen.getByRole("button", { name: "About" }));
}

describe("AboutModal", () => {
  beforeEach(() => {
    world.disconnect();
    world.connectionState = "connected";
    world.config = makeConfig({ world_name: "About Test" });
    world.tickRange = [0, 10];
    world.snapshot = makeSnapshot({ tick: 5, entity_count: 2 });
    world.spans = [];
    world.errors = [];
    stubFetch(async () => identityResponse());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the about modal from the header", async () => {
    render(Header);

    await openAbout();

    expect(
      screen.getByRole("dialog", { name: "About AgentECS Visualizer" }),
    ).toBeTruthy();
  });

  it("closes the about modal when the close button is clicked", async () => {
    render(Header);

    await openAbout();
    await fireEvent.click(
      screen.getByRole("button", { name: "Close about modal" }),
    );

    expect(
      screen.queryByRole("dialog", { name: "About AgentECS Visualizer" }),
    ).toBeNull();
  });

  it("shows backend identity from the metadata endpoint", async () => {
    render(Header);

    await openAbout();

    await vi.waitFor(() => {
      expect(screen.getByText("AgentECS Visualizer")).toBeTruthy();
      expect(screen.getByText("0.4.1")).toBeTruthy();
      expect(screen.getByText("MockWorldSource")).toBeTruthy();
    });
  });

  it("shows live world state alongside the identity", async () => {
    render(Header);

    await openAbout();

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("connected");
    expect(dialog.textContent).toContain("Tick");
    expect(dialog.textContent).toContain("Entities");
  });

  it("reports the backend as unavailable but keeps live state", async () => {
    stubFetch(async () => {
      throw new TypeError("failed to fetch");
    });
    render(Header);

    await openAbout();

    await vi.waitFor(() => {
      expect(screen.getByText(/Backend unavailable: network/)).toBeTruthy();
    });
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("connected");
    expect(dialog.textContent).toContain("2");
  });

  it("names the status when the endpoint is missing", async () => {
    stubFetch(async () => new Response("", { status: 404 }));
    render(Header);

    await openAbout();

    await vi.waitFor(() => {
      expect(screen.getByText(/Backend unavailable: http 404/)).toBeTruthy();
    });
  });

  it("never renders a field from a malformed payload", async () => {
    stubFetch(async () => identityResponse({ version: 7 }));
    render(Header);

    await openAbout();

    await vi.waitFor(() => {
      expect(screen.getByText(/Backend unavailable: bad payload/)).toBeTruthy();
    });
    expect(screen.getByRole("dialog").textContent).not.toContain("undefined");
  });

  it("cannot let an earlier open's response reach a later one", async () => {
    let releaseFirst: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    let call = 0;
    stubFetch(async () => {
      call += 1;
      if (call === 1) {
        await first;
        return identityResponse({ version: "stale-0.0.1" });
      }
      return identityResponse({ version: "fresh-0.4.1" });
    });

    render(Header);
    await openAbout();
    await fireEvent.click(
      screen.getByRole("button", { name: "Close about modal" }),
    );
    await openAbout();

    await vi.waitFor(() => {
      expect(screen.getByText("fresh-0.4.1")).toBeTruthy();
    });

    releaseFirst?.();
    await flush();

    expect(screen.getByText("fresh-0.4.1")).toBeTruthy();
    expect(screen.queryByText("stale-0.0.1")).toBeNull();
  });
});
