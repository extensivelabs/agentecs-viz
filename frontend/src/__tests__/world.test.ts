import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorldState } from "../lib/state/world.svelte";
import type {
  MetadataMessage,
  SnapshotMessage,
  ErrorMessage,
  ErrorEventMessage,
  TickUpdateMessage,
} from "../lib/types";
import { MockWebSocket, makeSnapshot, makeConfig, makeErrorEvent } from "./helpers";

describe("WorldState", () => {
  let state: WorldState;

  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    state = new WorldState();
  });

  afterEach(() => {
    state.disconnect();
    vi.restoreAllMocks();
  });

  describe("initial state", () => {
    it("starts disconnected with no data", () => {
      expect(state.connectionState).toBe("disconnected");
      expect(state.snapshot).toBeNull();
      expect(state.tick).toBe(0);
      expect(state.entityCount).toBe(0);
      expect(state.isConnected).toBe(false);
      expect(state.playbackMode).toBe("live");
    });
  });

  describe("connection", () => {
    it("connects and updates state", () => {
      state.connect("ws://test/ws");
      expect(state.connectionState).toBe("connecting");

      MockWebSocket.instances[0].simulateOpen();
      expect(state.connectionState).toBe("connected");
      expect(state.isConnected).toBe(true);
    });

    it("resets state on disconnect", () => {
      state.connect("ws://test/ws");
      MockWebSocket.instances[0].simulateOpen();

      const metaMsg: MetadataMessage = {
        type: "metadata",
        tick: 0,
        config: makeConfig(),
        tick_range: [0, 10],
        supports_history: true,
        is_paused: false,
      };
      MockWebSocket.instances[0].simulateMessage(metaMsg);
      expect(state.config).not.toBeNull();

      state.disconnect();
      expect(state.connectionState).toBe("disconnected");
      expect(state.config).toBeNull();
      expect(state.snapshot).toBeNull();
    });
  });

  describe("handleMessage", () => {
    beforeEach(() => {
      state.connect("ws://test/ws");
      MockWebSocket.instances[0].simulateOpen();
    });

    it("handles metadata message", () => {
      const msg: MetadataMessage = {
        type: "metadata",
        tick: 0,
        config: makeConfig({ world_name: "My World" }),
        tick_range: [0, 100],
        supports_history: true,
        is_paused: true,
      };
      MockWebSocket.instances[0].simulateMessage(msg);

      expect(state.worldName).toBe("My World");
      expect(state.tickRange).toEqual([0, 100]);
      expect(state.supportsHistory).toBe(true);
      expect(state.isPaused).toBe(true);
      expect(state.chatEnabled).toBe(true);
    });

    it("handles snapshot message", () => {
      const snapshot = makeSnapshot({ tick: 5 });
      const msg: SnapshotMessage = { type: "snapshot", tick: 5, snapshot };
      MockWebSocket.instances[0].simulateMessage(msg);

      expect(state.tick).toBe(5);
      expect(state.entityCount).toBe(2);
      expect(state.entities).toHaveLength(2);
    });

    it("handles error message", () => {
      const msg: ErrorMessage = {
        type: "error",
        tick: 0,
        message: "something broke",
      };
      MockWebSocket.instances[0].simulateMessage(msg);

      expect(state.lastError).toBe("something broke");
    });

    it("handles tick_update message", () => {
      // First need a snapshot
      const snapshot = makeSnapshot({ tick: 1 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 1,
        snapshot,
      } satisfies SnapshotMessage);

      // Set tick range
      MockWebSocket.instances[0].simulateMessage({
        type: "metadata",
        tick: 1,
        config: null,
        tick_range: [0, 1],
        supports_history: false,
        is_paused: false,
      } satisfies MetadataMessage);

      const msg: TickUpdateMessage = {
        type: "tick_update",
        tick: 5,
        entity_count: 15,
        is_paused: false,
      };
      MockWebSocket.instances[0].simulateMessage(msg);

      expect(state.tick).toBe(5);
      expect(state.entityCount).toBe(15);
    });
  });

  describe("entity tracking", () => {
    beforeEach(() => {
      state.connect("ws://test/ws");
      MockWebSocket.instances[0].simulateOpen();
    });

    it("detects new entities on first snapshot", () => {
      const snapshot = makeSnapshot();
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 1,
        snapshot,
      } satisfies SnapshotMessage);

      expect(state.newEntityIds.size).toBe(2);
      expect(state.newEntityIds.has(1)).toBe(true);
      expect(state.newEntityIds.has(2)).toBe(true);
    });

    it("creates new Set objects on each update (ensures Svelte reactivity)", () => {
      const snapshot1 = makeSnapshot();
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 1,
        snapshot: snapshot1,
      } satisfies SnapshotMessage);

      const newIdsRef1 = state.newEntityIds;
      const changedIdsRef1 = state.changedEntityIds;

      const snapshot2 = makeSnapshot({ tick: 2 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 2,
        snapshot: snapshot2,
      } satisfies SnapshotMessage);

      expect(state.newEntityIds).not.toBe(newIdsRef1);
      expect(state.changedEntityIds).not.toBe(changedIdsRef1);
    });

    it("detects changed entities", () => {
      const snapshot1 = makeSnapshot();
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 1,
        snapshot: snapshot1,
      } satisfies SnapshotMessage);

      const snapshot2 = makeSnapshot({
        tick: 2,
        entities: [
          {
            id: 1,
            archetype: ["Agent", "Position"],
            components: [
              { type_name: "Agent", type_short: "Agent", data: { name: "a1" } },
              {
                type_name: "Position",
                type_short: "Position",
                data: { x: 10, y: 20 },
              },
            ],
          },
          {
            id: 2,
            archetype: ["Task"],
            components: [
              { type_name: "Task", type_short: "Task", data: { status: "active" } },
            ],
          },
        ],
      });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 2,
        snapshot: snapshot2,
      } satisfies SnapshotMessage);

      expect(state.changedEntityIds.has(1)).toBe(true);
      expect(state.changedEntityIds.has(2)).toBe(false);
      expect(state.newEntityIds.size).toBe(0);
    });
  });

  describe("derived state", () => {
    it("computes playbackMode correctly", () => {
      expect(state.playbackMode).toBe("live");

      state.connect("ws://test/ws");
      MockWebSocket.instances[0].simulateOpen();

      // Paused
      MockWebSocket.instances[0].simulateMessage({
        type: "metadata",
        tick: 0,
        config: null,
        tick_range: [0, 10],
        supports_history: true,
        is_paused: true,
      } satisfies MetadataMessage);

      const snapshot = makeSnapshot({ tick: 10 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 10,
        snapshot,
      } satisfies SnapshotMessage);

      expect(state.playbackMode).toBe("paused");

      // History (tick behind max)
      const histSnapshot = makeSnapshot({ tick: 5 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 5,
        snapshot: histSnapshot,
      } satisfies SnapshotMessage);

      expect(state.playbackMode).toBe("history");
    });

    it("computes selectedEntity", () => {
      state.connect("ws://test/ws");
      MockWebSocket.instances[0].simulateOpen();

      const snapshot = makeSnapshot();
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 1,
        snapshot,
      } satisfies SnapshotMessage);

      state.selectEntity(1);
      expect(state.selectedEntity?.id).toBe(1);

      state.selectEntity(999);
      expect(state.selectedEntity).toBeUndefined();

      state.selectEntity(null);
      expect(state.selectedEntity).toBeUndefined();
    });
  });

  describe("stepBack", () => {
    it("seeks to tick - 1 when history available", () => {
      state.connect("ws://test/ws");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      ws.simulateMessage({
        type: "metadata",
        tick: 0,
        config: null,
        tick_range: [0, 10],
        supports_history: true,
        is_paused: false,
      } satisfies MetadataMessage);

      const snapshot = makeSnapshot({ tick: 5 });
      ws.simulateMessage({
        type: "snapshot",
        tick: 5,
        snapshot,
      } satisfies SnapshotMessage);

      state.stepBack();
      const lastMsg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
      expect(lastMsg).toEqual({ command: "seek", tick: 4 });
    });

    it("no-op at min tick", () => {
      state.connect("ws://test/ws");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      ws.simulateMessage({
        type: "metadata",
        tick: 0,
        config: null,
        tick_range: [0, 10],
        supports_history: true,
        is_paused: false,
      } satisfies MetadataMessage);

      const snapshot = makeSnapshot({ tick: 0 });
      ws.simulateMessage({
        type: "snapshot",
        tick: 0,
        snapshot,
      } satisfies SnapshotMessage);

      const msgCountBefore = ws.sentMessages.length;
      state.stepBack();
      expect(ws.sentMessages.length).toBe(msgCountBefore);
    });

    it("no-op when history not supported", () => {
      state.connect("ws://test/ws");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      ws.simulateMessage({
        type: "metadata",
        tick: 0,
        config: null,
        tick_range: null,
        supports_history: false,
        is_paused: false,
      } satisfies MetadataMessage);

      const snapshot = makeSnapshot({ tick: 5 });
      ws.simulateMessage({
        type: "snapshot",
        tick: 5,
        snapshot,
      } satisfies SnapshotMessage);

      const msgCountBefore = ws.sentMessages.length;
      state.stepBack();
      expect(ws.sentMessages.length).toBe(msgCountBefore);
    });
  });

  describe("commands", () => {
    it("sends commands through WebSocket", () => {
      state.connect("ws://test/ws");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      state.pause();
      expect(JSON.parse(ws.sentMessages[0])).toEqual({ command: "pause" });

      state.resume();
      expect(JSON.parse(ws.sentMessages[1])).toEqual({ command: "resume" });

      state.step();
      expect(JSON.parse(ws.sentMessages[2])).toEqual({ command: "step" });

      state.seek(42);
      expect(JSON.parse(ws.sentMessages[3])).toEqual({
        command: "seek",
        tick: 42,
      });

      state.setSpeed(5);
      expect(JSON.parse(ws.sentMessages[4])).toEqual({
        command: "set_speed",
        ticks_per_second: 5,
      });
    });
  });

  describe("diff tracking", () => {
    beforeEach(() => {
      state.connect("ws://test/ws");
      MockWebSocket.instances[0].simulateOpen();
    });

    it("previousSnapshot is null before first snapshot", () => {
      expect(state.previousSnapshot).toBeNull();
    });

    it("stores previousSnapshot on second snapshot", () => {
      const snap1 = makeSnapshot({ tick: 1 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 1,
        snapshot: snap1,
      } satisfies SnapshotMessage);

      expect(state.previousSnapshot).toBeNull();

      const snap2 = makeSnapshot({ tick: 2 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 2,
        snapshot: snap2,
      } satisfies SnapshotMessage);

      expect(state.previousSnapshot).not.toBeNull();
      expect(state.previousSnapshot!.tick).toBe(1);
    });

    it("computes selectedEntityDiff for changed entity", () => {
      const snap1 = makeSnapshot({ tick: 1 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 1,
        snapshot: snap1,
      } satisfies SnapshotMessage);

      const snap2 = makeSnapshot({
        tick: 2,
        entities: [
          {
            id: 1,
            archetype: ["Agent", "Position"],
            components: [
              { type_name: "Agent", type_short: "Agent", data: { name: "a1" } },
              { type_name: "Position", type_short: "Position", data: { x: 10, y: 20 } },
            ],
          },
          {
            id: 2,
            archetype: ["Task"],
            components: [
              { type_name: "Task", type_short: "Task", data: { status: "active" } },
            ],
          },
        ],
      });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 2,
        snapshot: snap2,
      } satisfies SnapshotMessage);

      state.selectEntity(1);
      expect(state.selectedEntityDiff).not.toBeNull();
      expect(state.selectedEntityDiff!.totalChanges).toBe(2);
    });

    it("entityDiffCounts maps changed IDs to counts", () => {
      const snap1 = makeSnapshot({ tick: 1 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 1,
        snapshot: snap1,
      } satisfies SnapshotMessage);

      const snap2 = makeSnapshot({
        tick: 2,
        entities: [
          {
            id: 1,
            archetype: ["Agent", "Position"],
            components: [
              { type_name: "Agent", type_short: "Agent", data: { name: "a1" } },
              { type_name: "Position", type_short: "Position", data: { x: 5, y: 0 } },
            ],
          },
          {
            id: 2,
            archetype: ["Task"],
            components: [
              { type_name: "Task", type_short: "Task", data: { status: "active" } },
            ],
          },
        ],
      });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 2,
        snapshot: snap2,
      } satisfies SnapshotMessage);

      expect(state.entityDiffCounts.get(1)).toBe(1);
      expect(state.entityDiffCounts.has(2)).toBe(false);
    });

    it("resets previousSnapshot on disconnect", () => {
      const snap1 = makeSnapshot({ tick: 1 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 1,
        snapshot: snap1,
      } satisfies SnapshotMessage);

      const snap2 = makeSnapshot({ tick: 2 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 2,
        snapshot: snap2,
      } satisfies SnapshotMessage);

      expect(state.previousSnapshot).not.toBeNull();
      state.disconnect();
      expect(state.previousSnapshot).toBeNull();
    });

    it("pin/clear cycle stores and clears entity state", () => {
      const snap = makeSnapshot({ tick: 5 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 5,
        snapshot: snap,
      } satisfies SnapshotMessage);

      state.pinCurrentState();
      expect(state.pinnedTick).toBe(5);
      expect(state.pinnedEntityState).not.toBeNull();
      expect(state.pinnedEntityState!.get(1)).toBeDefined();
      expect(state.pinnedTick).toBe(5);

      state.clearPinnedState();
      expect(state.pinnedTick).toBeNull();
      expect(state.pinnedEntityState).toBeNull();
    });
  });

  describe("error tracking", () => {
    beforeEach(() => {
      state.connect("ws://test/ws");
      MockWebSocket.instances[0].simulateOpen();
    });

    it("accumulates error events", () => {
      const snapshot = makeSnapshot({ tick: 3 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 3,
        snapshot,
      } satisfies SnapshotMessage);

      MockWebSocket.instances[0].simulateMessage(makeErrorEvent(1, 1, "err1"));
      MockWebSocket.instances[0].simulateMessage(makeErrorEvent(2, 2, "err2"));
      MockWebSocket.instances[0].simulateMessage(makeErrorEvent(3, 1, "err3"));

      expect(state.errors).toHaveLength(3);
    });

    it("visibleErrors filters by current tick", () => {
      const snapshot = makeSnapshot({ tick: 2 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 2,
        snapshot,
      } satisfies SnapshotMessage);

      MockWebSocket.instances[0].simulateMessage(makeErrorEvent(1, 1));
      MockWebSocket.instances[0].simulateMessage(makeErrorEvent(2, 2));
      MockWebSocket.instances[0].simulateMessage(makeErrorEvent(5, 1));

      expect(state.visibleErrors).toHaveLength(2);
      expect(state.visibleErrorCount).toBe(2);
    });

    it("errorEntityIds contains current tick error entities", () => {
      const snapshot = makeSnapshot({ tick: 3 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 3,
        snapshot,
      } satisfies SnapshotMessage);

      MockWebSocket.instances[0].simulateMessage(makeErrorEvent(3, 1));
      MockWebSocket.instances[0].simulateMessage(makeErrorEvent(2, 2));

      expect(state.errorEntityIds.has(1)).toBe(true);
      expect(state.errorEntityIds.has(2)).toBe(false);
      expect(state.pastErrorEntityIds.has(2)).toBe(true);
    });

    it("clears errors on disconnect", () => {
      MockWebSocket.instances[0].simulateMessage(makeErrorEvent(1, 1));
      expect(state.errors).toHaveLength(1);

      state.disconnect();
      expect(state.errors).toHaveLength(0);
      expect(state.errorPanelOpen).toBe(false);
    });

    it("jumpToError seeks and selects entity", () => {
      const ws = MockWebSocket.instances[0];
      const snapshot = makeSnapshot({ tick: 5 });
      ws.simulateMessage({
        type: "snapshot",
        tick: 5,
        snapshot,
      } satisfies SnapshotMessage);

      const error = makeErrorEvent(3, 42);
      state.jumpToError(error);

      const lastMsg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
      expect(lastMsg).toEqual({ command: "seek", tick: 3 });
      expect(state.selectedEntityId).toBe(42);
    });

    it("toggleErrorPanel toggles state", () => {
      expect(state.errorPanelOpen).toBe(false);
      state.toggleErrorPanel();
      expect(state.errorPanelOpen).toBe(true);
      state.toggleErrorPanel();
      expect(state.errorPanelOpen).toBe(false);
    });
  });
});
