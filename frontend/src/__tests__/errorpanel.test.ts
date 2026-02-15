import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/svelte";
import ErrorPanel from "../lib/ErrorPanel.svelte";
import { world } from "../lib/state/world.svelte";
import { MockWebSocket, makeSnapshot, makeErrorEvent } from "./helpers";
import type { SnapshotMessage } from "../lib/types";

describe("ErrorPanel", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    world.connect("ws://test/ws");
    MockWebSocket.instances[0].simulateOpen();
  });

  afterEach(() => {
    world.disconnect();
    vi.restoreAllMocks();
  });

  it("does not render when errorPanelOpen is false", () => {
    render(ErrorPanel);
    expect(screen.queryByTestId("error-panel")).toBeNull();
  });

  it("renders when errorPanelOpen is true", async () => {
    const snapshot = makeSnapshot({ tick: 3 });
    MockWebSocket.instances[0].simulateMessage({
      type: "snapshot",
      tick: 3,
      snapshot,
    } satisfies SnapshotMessage);

    MockWebSocket.instances[0].simulateMessage(makeErrorEvent(1, 1, "test error"));

    world.toggleErrorPanel();

    render(ErrorPanel);

    await vi.waitFor(() => {
      expect(screen.getByTestId("error-panel")).toBeTruthy();
    });
  });

  it("shows empty state when no errors", async () => {
    world.toggleErrorPanel();
    render(ErrorPanel);

    await vi.waitFor(() => {
      expect(screen.getByTestId("error-panel-empty")).toBeTruthy();
      expect(screen.getByText("No errors detected")).toBeTruthy();
    });
  });

  it("shows error rows with severity badges", async () => {
    const snapshot = makeSnapshot({ tick: 5 });
    MockWebSocket.instances[0].simulateMessage({
      type: "snapshot",
      tick: 5,
      snapshot,
    } satisfies SnapshotMessage);

    MockWebSocket.instances[0].simulateMessage(makeErrorEvent(1, 1, "critical failure", "critical"));
    MockWebSocket.instances[0].simulateMessage(makeErrorEvent(3, 2, "warning msg", "warning"));
    MockWebSocket.instances[0].simulateMessage(makeErrorEvent(5, 1, "info msg", "info"));

    world.toggleErrorPanel();
    render(ErrorPanel);

    await vi.waitFor(() => {
      const rows = screen.getAllByTestId("error-row");
      expect(rows).toHaveLength(3);
      expect(screen.getByText("CRIT")).toBeTruthy();
      expect(screen.getByText("WARN")).toBeTruthy();
      expect(screen.getByText("INFO")).toBeTruthy();
    });
  });
});
