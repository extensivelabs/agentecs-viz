import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorldState } from "../lib/state/world.svelte";
import type {
  DeltaMessage,
  MetadataMessage,
  SnapshotMessage,
  ErrorMessage,
  ErrorEventMessage,
  SpanEventMessage,
  TickUpdateMessage,
} from "../lib/types";
import { MockWebSocket, makeSnapshot, makeConfig, makeErrorEvent, makeSpanEvent } from "./helpers";

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

    it("clears stale state when connect() is called", () => {
      state.connect("ws://test/ws");
      MockWebSocket.instances[0].simulateOpen();

      // Populate state from first session
      MockWebSocket.instances[0].simulateMessage({
        type: "metadata",
        tick: 0,
        config: makeConfig(),
        tick_range: [0, 500],
        supports_history: true,
        is_paused: false,
      } satisfies MetadataMessage);
      const snap = makeSnapshot({ tick: 500 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 500,
        snapshot: snap,
      } satisfies SnapshotMessage);
      MockWebSocket.instances[0].simulateMessage(makeErrorEvent(500, 1));
      MockWebSocket.instances[0].simulateMessage(makeSpanEvent(500, 1));

      expect(state.tick).toBe(500);
      expect(state.errors.length).toBe(1);
      expect(state.spans.length).toBe(1);
      expect(state.tickRange).toEqual([0, 500]);

      // Reconnect — state should be cleared immediately
      state.connect("ws://test/ws");
      expect(state.snapshot).toBeNull();
      expect(state.tick).toBe(0);
      expect(state.config).toBeNull();
      expect(state.tickRange).toBeNull();
      expect(state.errors).toEqual([]);
      expect(state.spans).toEqual([]);
      expect(state.supportsHistory).toBe(false);
    });

    it("clears lastError and isPaused on reconnect", () => {
      state.connect("ws://test/ws");
      MockWebSocket.instances[0].simulateOpen();

      // Set error and paused state
      MockWebSocket.instances[0].simulateMessage({
        type: "error",
        tick: 0,
        message: "old error",
      } satisfies ErrorMessage);
      MockWebSocket.instances[0].simulateMessage({
        type: "metadata",
        tick: 0,
        config: null,
        tick_range: null,
        supports_history: false,
        is_paused: true,
      } satisfies MetadataMessage);

      expect(state.lastError).toBe("old error");
      expect(state.isPaused).toBe(true);

      // Reconnect — lastError and isPaused should be cleared
      state.connect("ws://test/ws");
      expect(state.lastError).toBeNull();
      expect(state.isPaused).toBe(false);
    });

    it("stale client callbacks do not clobber new connection state", () => {
      state.connect("ws://test/ws");
      const oldWs = MockWebSocket.instances[0];
      oldWs.simulateOpen();

      MockWebSocket.instances[0].simulateMessage({
        type: "metadata",
        tick: 0,
        config: makeConfig(),
        tick_range: [0, 10],
        supports_history: true,
        is_paused: false,
      } satisfies MetadataMessage);

      // Reconnect — creates a new client
      state.connect("ws://test/ws");
      const newWs = MockWebSocket.instances[1];
      newWs.simulateOpen();

      // New connection sets up state
      newWs.simulateMessage({
        type: "metadata",
        tick: 0,
        config: makeConfig({ world_name: "New World" }),
        tick_range: [0, 20],
        supports_history: true,
        is_paused: false,
      } satisfies MetadataMessage);

      expect(state.worldName).toBe("New World");
      expect(state.connectionState).toBe("connected");

      // Old WebSocket fires close — should NOT clobber new state
      oldWs.simulateClose();

      expect(state.connectionState).toBe("connected");
      expect(state.worldName).toBe("New World");
      expect(state.config).not.toBeNull();
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

    it("logs warning on delta message", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const msg: DeltaMessage = {
        type: "delta",
        tick: 1,
        delta: {
          tick: 1,
          timestamp: 1,
          spawned: [],
          destroyed: [],
          modified: {},
        },
      };
      MockWebSocket.instances[0].simulateMessage(msg);
      expect(warnSpy).toHaveBeenCalledWith(
        "[world] delta message received but not yet implemented",
      );
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
      // seek auto-pauses when not already paused (REQ-041)
      expect(JSON.parse(ws.sentMessages[3])).toEqual({ command: "pause" });
      expect(JSON.parse(ws.sentMessages[4])).toEqual({
        command: "seek",
        tick: 42,
      });

      state.setSpeed(5);
      expect(JSON.parse(ws.sentMessages[5])).toEqual({
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

  describe("span tracking", () => {
    beforeEach(() => {
      state.connect("ws://test/ws");
      MockWebSocket.instances[0].simulateOpen();
    });

    it("accumulates span events", () => {
      const snapshot = makeSnapshot({ tick: 3 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 3,
        snapshot,
      } satisfies SnapshotMessage);

      MockWebSocket.instances[0].simulateMessage(makeSpanEvent(1, 1));
      MockWebSocket.instances[0].simulateMessage(makeSpanEvent(2, 2));
      MockWebSocket.instances[0].simulateMessage(makeSpanEvent(3, 1));

      expect(state.spans).toHaveLength(3);
    });

    it("caps spans at 2000", () => {
      const snapshot = makeSnapshot({ tick: 3000 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 3000,
        snapshot,
      } satisfies SnapshotMessage);

      // Pre-fill with 1999 spans via direct assignment
      const bulk: SpanEventMessage[] = [];
      for (let i = 0; i < 1999; i++) {
        bulk.push(makeSpanEvent(i, 1, { span_id: `s${i}` }));
      }
      state.spans = bulk;

      // Send 2 more to trigger cap logic
      MockWebSocket.instances[0].simulateMessage(makeSpanEvent(1999, 1, { span_id: "s1999" }));
      MockWebSocket.instances[0].simulateMessage(makeSpanEvent(2000, 1, { span_id: "s2000" }));

      expect(state.spans).toHaveLength(2000);
      expect(state.spans[0].span_id).toBe("s1");
    });

    it("visibleSpans filters by current tick", () => {
      const snapshot = makeSnapshot({ tick: 2 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 2,
        snapshot,
      } satisfies SnapshotMessage);

      MockWebSocket.instances[0].simulateMessage(makeSpanEvent(1, 1));
      MockWebSocket.instances[0].simulateMessage(makeSpanEvent(2, 2));
      MockWebSocket.instances[0].simulateMessage(makeSpanEvent(5, 1));

      expect(state.visibleSpans).toHaveLength(2);
      expect(state.spanCount).toBe(2);
    });

    it("selectedEntitySpans filters by entity", () => {
      const snapshot = makeSnapshot({ tick: 5 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 5,
        snapshot,
      } satisfies SnapshotMessage);

      MockWebSocket.instances[0].simulateMessage(makeSpanEvent(1, 1));
      MockWebSocket.instances[0].simulateMessage(makeSpanEvent(2, 2));
      MockWebSocket.instances[0].simulateMessage(makeSpanEvent(3, 1));

      state.selectEntity(1);
      expect(state.selectedEntitySpans).toHaveLength(2);
    });

    it("computes total token and cost usage from visible spans", () => {
      const snapshot = makeSnapshot({ tick: 3 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 3,
        snapshot,
      } satisfies SnapshotMessage);

      MockWebSocket.instances[0].simulateMessage(
        makeSpanEvent(1, 1, {
          attributes: {
            "agentecs.tick": 1,
            "agentecs.entity_id": 1,
            "gen_ai.request.model": "gpt-4o",
            "gen_ai.usage.input_tokens": 100,
            "gen_ai.usage.output_tokens": 50,
          },
        }),
      );
      MockWebSocket.instances[0].simulateMessage(
        makeSpanEvent(2, 2, {
          attributes: {
            "agentecs.tick": 2,
            "agentecs.entity_id": 2,
            "llm.cost.total": 0.1,
            "gen_ai.request.model": "gpt-4o-mini",
            "gen_ai.usage.input_tokens": 25,
            "gen_ai.usage.output_tokens": 10,
          },
        }),
      );

      expect(state.totalTokenUsage.total).toBe(185);
      expect(state.totalTokenUsage.prompt).toBe(125);
      expect(state.totalTokenUsage.completion).toBe(60);
      expect(state.totalTokenUsage.costUsd).toBeGreaterThanOrEqual(0.1);
    });

    it("computes selected entity token totals and model breakdown", () => {
      const snapshot = makeSnapshot({ tick: 5 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 5,
        snapshot,
      } satisfies SnapshotMessage);

      MockWebSocket.instances[0].simulateMessage(
        makeSpanEvent(1, 1, {
          attributes: {
            "agentecs.tick": 1,
            "agentecs.entity_id": 1,
            "gen_ai.request.model": "gpt-4o",
            "gen_ai.usage.input_tokens": 40,
            "gen_ai.usage.output_tokens": 10,
          },
        }),
      );
      MockWebSocket.instances[0].simulateMessage(
        makeSpanEvent(2, 1, {
          attributes: {
            "agentecs.tick": 2,
            "agentecs.entity_id": 1,
            "gen_ai.request.model": "gpt-4o",
            "gen_ai.usage.input_tokens": 10,
            "gen_ai.usage.output_tokens": 5,
          },
        }),
      );
      MockWebSocket.instances[0].simulateMessage(
        makeSpanEvent(2, 2, {
          attributes: {
            "agentecs.tick": 2,
            "agentecs.entity_id": 2,
            "gen_ai.request.model": "gpt-4o-mini",
            "gen_ai.usage.input_tokens": 500,
            "gen_ai.usage.output_tokens": 50,
          },
        }),
      );

      state.selectEntity(1);

      expect(state.selectedEntityTokenUsage.total).toBe(65);
      expect(state.selectedEntityModelTokenUsage).toHaveLength(1);
      expect(state.selectedEntityModelTokenUsage[0].model).toBe("gpt-4o");
      expect(state.selectedEntityModelTokenUsage[0].total).toBe(65);
    });

    it("flags budget warning when total cost exceeds threshold", () => {
      const snapshot = makeSnapshot({ tick: 1 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 1,
        snapshot,
      } satisfies SnapshotMessage);

      expect(state.tokenCostBudgetExceeded).toBe(false);

      MockWebSocket.instances[0].simulateMessage(
        makeSpanEvent(1, 1, {
          attributes: {
            "agentecs.tick": 1,
            "agentecs.entity_id": 1,
            "llm.cost.total": 2,
          },
        }),
      );

      expect(state.totalTokenUsage.costUsd).toBe(2);
      expect(state.tokenCostBudgetExceeded).toBe(true);
    });

    it("selectSpan sets selectedSpanId and selectedSpan", () => {
      const snapshot = makeSnapshot({ tick: 5 });
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 5,
        snapshot,
      } satisfies SnapshotMessage);

      const span = makeSpanEvent(1, 1, { span_id: "target" });
      MockWebSocket.instances[0].simulateMessage(span);

      state.selectSpan("target");
      expect(state.selectedSpanId).toBe("target");
      expect(state.selectedSpan?.span_id).toBe("target");

      state.selectSpan(null);
      expect(state.selectedSpan).toBeUndefined();
    });

    it("clears spans on disconnect", () => {
      MockWebSocket.instances[0].simulateMessage(makeSpanEvent(1, 1));
      expect(state.spans).toHaveLength(1);

      state.disconnect();
      expect(state.spans).toHaveLength(0);
      expect(state.selectedSpanId).toBeNull();
    });
  });

  describe("replay", () => {
    let ws: InstanceType<typeof MockWebSocket>;

    beforeEach(() => {
      vi.useFakeTimers();
      state.connect("ws://test/ws");
      ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      // Set up history-capable session at tick 5 of 10
      ws.simulateMessage({
        type: "metadata",
        tick: 0,
        config: null,
        tick_range: [0, 10],
        supports_history: true,
        is_paused: true,
      } satisfies MetadataMessage);

      ws.simulateMessage({
        type: "snapshot",
        tick: 5,
        snapshot: makeSnapshot({ tick: 5 }),
      } satisfies SnapshotMessage);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("togglePause starts replay when paused in history mode", () => {
      expect(state.playbackMode).toBe("history");
      expect(state.isReplayPlaying).toBe(false);

      state.togglePause();

      expect(state.isReplayPlaying).toBe(true);
      expect(state.playbackMode).toBe("replay");
    });

    it("togglePause stops replay when replaying", () => {
      state.togglePause(); // start replay
      expect(state.isReplayPlaying).toBe(true);

      state.togglePause(); // stop replay
      expect(state.isReplayPlaying).toBe(false);
    });

    it("replay advances tick via seek on each interval", () => {
      state.togglePause(); // start replay at 1 tick/sec

      const msgsBefore = ws.sentMessages.length;
      vi.advanceTimersByTime(1000);

      const seekMsg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
      expect(seekMsg).toEqual({ command: "seek", tick: 6 });
      expect(ws.sentMessages.length).toBeGreaterThan(msgsBefore);
    });

    it("replay stops when reaching maxTick", () => {
      // Position at tick 9 (one before max)
      ws.simulateMessage({
        type: "snapshot",
        tick: 9,
        snapshot: makeSnapshot({ tick: 9 }),
      } satisfies SnapshotMessage);

      state.togglePause(); // start replay
      expect(state.isReplayPlaying).toBe(true);

      vi.advanceTimersByTime(1000); // advance to tick 10
      // Simulate server responding with tick 10 snapshot
      ws.simulateMessage({
        type: "snapshot",
        tick: 10,
        snapshot: makeSnapshot({ tick: 10 }),
      } satisfies SnapshotMessage);

      vi.advanceTimersByTime(1000); // next interval - should stop
      expect(state.isReplayPlaying).toBe(false);
    });

    it("step seeks forward in history mode instead of client.step()", () => {
      // We're at tick 5, not at live (tick 10)
      const msgsBefore = ws.sentMessages.length;
      state.step();

      const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
      expect(msg).toEqual({ command: "seek", tick: 6 });
      // Should only send seek, not step
      expect(ws.sentMessages.length).toBe(msgsBefore + 1);
    });

    it("step sends client.step() when at live tick", () => {
      ws.simulateMessage({
        type: "snapshot",
        tick: 10,
        snapshot: makeSnapshot({ tick: 10 }),
      } satisfies SnapshotMessage);

      state.step();

      const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
      expect(msg).toEqual({ command: "step" });
    });

    it("step at maxTick transitions to live step", () => {
      // When tick reaches maxTick, isAtLive becomes true,
      // so step() falls through to client.step()
      ws.simulateMessage({
        type: "snapshot",
        tick: 10,
        snapshot: makeSnapshot({ tick: 10 }),
      } satisfies SnapshotMessage);

      expect(state.isAtLive).toBe(true);
      state.step();

      const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
      expect(msg).toEqual({ command: "step" });
    });

    it("stepBack auto-pauses when not paused", () => {
      // Make state not paused
      ws.simulateMessage({
        type: "metadata",
        tick: 0,
        config: null,
        tick_range: [0, 10],
        supports_history: true,
        is_paused: false,
      } satisfies MetadataMessage);

      state.stepBack();

      // Should have sent pause then seek
      const msgs = ws.sentMessages.map((m) => JSON.parse(m));
      const pauseMsg = msgs.find((m) => m.command === "pause");
      const seekMsg = msgs.find((m) => m.command === "seek" && m.tick === 4);
      expect(pauseMsg).toBeDefined();
      expect(seekMsg).toBeDefined();
    });

    it("goToLive stops replay and resumes", () => {
      state.togglePause(); // start replay
      expect(state.isReplayPlaying).toBe(true);

      state.goToLive();

      expect(state.isReplayPlaying).toBe(false);
      // Should seek to max tick and resume
      const msgs = ws.sentMessages.map((m) => JSON.parse(m));
      expect(msgs).toContainEqual({ command: "seek", tick: 10 });
      expect(msgs).toContainEqual({ command: "resume" });
    });

    it("setSpeed restarts replay at new speed when replaying", () => {
      state.togglePause(); // start replay at speed 1

      // Advance to verify original speed works
      vi.advanceTimersByTime(1000);
      const seekCount1 = ws.sentMessages.filter((m) =>
        JSON.parse(m).command === "seek",
      ).length;

      // Change speed to 5
      state.setSpeed(5);
      expect(state.isReplayPlaying).toBe(true);

      // At speed 5, interval is 200ms - advance 1000ms = 5 seeks
      vi.advanceTimersByTime(1000);
      const seekCount2 = ws.sentMessages.filter((m) =>
        JSON.parse(m).command === "seek",
      ).length;

      // Should have more seeks after speed increase
      expect(seekCount2 - seekCount1).toBeGreaterThanOrEqual(4);
    });

    it("setSpeed stores speed for replay without restarting when not replaying", () => {
      const msgsBefore = ws.sentMessages.length;
      state.setSpeed(5);

      // Should send set_speed command
      const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
      expect(msg).toEqual({ command: "set_speed", ticks_per_second: 5 });
      expect(state.isReplayPlaying).toBe(false);
    });

    it("disconnect stops replay", () => {
      state.togglePause(); // start replay
      expect(state.isReplayPlaying).toBe(true);

      state.disconnect();
      expect(state.isReplayPlaying).toBe(false);
    });
  });

  describe("entity query filtering", () => {
    beforeEach(() => {
      state.connect();
      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      ws.simulateOpen();
      ws.simulateMessage({
        type: "metadata",
        tick: 1,
        config: null,
        tick_range: [1, 10],
        supports_history: true,
        is_paused: false,
      } satisfies MetadataMessage);
      ws.simulateMessage({
        type: "snapshot",
        tick: 1,
        snapshot: makeSnapshot({
          entities: [
            { id: 1, archetype: ["Agent", "Position"], components: [
              { type_name: "mod.Agent", type_short: "Agent", data: {} },
              { type_name: "mod.Position", type_short: "Position", data: {} },
            ] },
            { id: 2, archetype: ["Task"], components: [
              { type_name: "mod.Task", type_short: "Task", data: {} },
            ] },
            { id: 3, archetype: ["Agent", "Task"], components: [
              { type_name: "mod.Agent", type_short: "Agent", data: {} },
              { type_name: "mod.Task", type_short: "Task", data: {} },
            ] },
          ],
          entity_count: 3,
        }),
      } satisfies SnapshotMessage);
    });

    it("availableComponents lists sorted unique component types", () => {
      expect(state.availableComponents).toEqual(["Agent", "Position", "Task"]);
    });

    it("hasActiveFilter is false with no query", () => {
      expect(state.hasActiveFilter).toBe(false);
      expect(state.matchingEntityIds.size).toBe(0);
    });

    it("setQuery activates filter and computes matching IDs", () => {
      state.setQuery({ name: "", clauses: [{ type: "with", component: "Agent" }] });
      expect(state.hasActiveFilter).toBe(true);
      expect(state.matchingEntityIds).toEqual(new Set([1, 3]));
      expect(state.matchCount).toBe(2);
    });

    it("clearQuery removes filter", () => {
      state.setQuery({ name: "", clauses: [{ type: "with", component: "Agent" }] });
      state.clearQuery();
      expect(state.hasActiveFilter).toBe(false);
    });

    it("saveQuery stores named query", () => {
      state.saveQuery({ name: "agents", clauses: [{ type: "with", component: "Agent" }] });
      expect(state.savedQueries).toHaveLength(1);
      expect(state.savedQueries[0].name).toBe("agents");
    });

    it("saveQuery replaces existing query with same name", () => {
      state.saveQuery({ name: "q", clauses: [{ type: "with", component: "Agent" }] });
      state.saveQuery({ name: "q", clauses: [{ type: "with", component: "Task" }] });
      expect(state.savedQueries).toHaveLength(1);
      expect(state.savedQueries[0].clauses[0].component).toBe("Task");
    });

    it("loadQuery sets active query from saved", () => {
      state.saveQuery({ name: "agents", clauses: [{ type: "with", component: "Agent" }] });
      state.loadQuery("agents");
      expect(state.hasActiveFilter).toBe(true);
      expect(state.matchingEntityIds).toEqual(new Set([1, 3]));
    });

    it("deleteSavedQuery removes query by name", () => {
      state.saveQuery({ name: "a", clauses: [{ type: "with", component: "Agent" }] });
      state.saveQuery({ name: "b", clauses: [{ type: "with", component: "Task" }] });
      state.deleteSavedQuery("a");
      expect(state.savedQueries).toHaveLength(1);
      expect(state.savedQueries[0].name).toBe("b");
    });

    it("saveQuery rejects empty name or empty clauses", () => {
      state.saveQuery({ name: "", clauses: [{ type: "with", component: "Agent" }] });
      expect(state.savedQueries).toHaveLength(0);
      state.saveQuery({ name: "q", clauses: [] });
      expect(state.savedQueries).toHaveLength(0);
    });

    it("reconnect clears activeQuery but preserves savedQueries", () => {
      state.setQuery({ name: "", clauses: [{ type: "with", component: "Agent" }] });
      state.saveQuery({ name: "kept", clauses: [{ type: "with", component: "Task" }] });
      expect(state.hasActiveFilter).toBe(true);
      expect(state.savedQueries).toHaveLength(1);

      state.disconnect();
      expect(state.activeQuery).toBeNull();
      expect(state.savedQueries).toHaveLength(1);
      expect(state.savedQueries[0].name).toBe("kept");
    });
  });

  describe("REQ-039: tickRange bootstrap", () => {
    beforeEach(() => {
      state.connect("ws://test/ws");
      MockWebSocket.instances[0].simulateOpen();
    });

    it("bootstraps tickRange from snapshot when metadata has null tick_range", () => {
      MockWebSocket.instances[0].simulateMessage({
        type: "metadata",
        tick: 0,
        config: makeConfig(),
        tick_range: null,
        supports_history: true,
        is_paused: false,
      } satisfies MetadataMessage);
      expect(state.tickRange).toBeNull();

      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 5,
        snapshot: makeSnapshot({ tick: 5 }),
      } satisfies SnapshotMessage);
      expect(state.tickRange).toEqual([5, 5]);
      expect(state.maxTick).toBe(5);
    });

    it("does not overwrite existing tickRange on snapshot", () => {
      MockWebSocket.instances[0].simulateMessage({
        type: "metadata",
        tick: 0,
        config: makeConfig(),
        tick_range: [0, 10],
        supports_history: true,
        is_paused: false,
      } satisfies MetadataMessage);
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 5,
        snapshot: makeSnapshot({ tick: 5 }),
      } satisfies SnapshotMessage);
      expect(state.tickRange).toEqual([0, 10]);
    });

    it("bootstraps tickRange from tick_update when null", () => {
      MockWebSocket.instances[0].simulateMessage({
        type: "metadata",
        tick: 0,
        config: makeConfig(),
        tick_range: null,
        supports_history: true,
        is_paused: false,
      } satisfies MetadataMessage);
      MockWebSocket.instances[0].simulateMessage({
        type: "snapshot",
        tick: 0,
        snapshot: makeSnapshot({ tick: 0 }),
      } satisfies SnapshotMessage);
      // snapshot bootstraps to [0, 0], then tick_update ratchets up
      MockWebSocket.instances[0].simulateMessage({
        type: "tick_update",
        tick: 3,
        entity_count: 1,
        is_paused: false,
      } satisfies TickUpdateMessage);
      expect(state.tickRange).toEqual([0, 3]);
      expect(state.maxTick).toBe(3);
    });

    it("preserves existing tickRange from metadata", () => {
      MockWebSocket.instances[0].simulateMessage({
        type: "metadata",
        tick: 0,
        config: makeConfig(),
        tick_range: [0, 100],
        supports_history: true,
        is_paused: false,
      } satisfies MetadataMessage);
      expect(state.tickRange).toEqual([0, 100]);
    });
  });

  describe("REQ-041: seek auto-pause", () => {
    beforeEach(() => {
      state.connect("ws://test/ws");
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();
      ws.simulateMessage({
        type: "metadata",
        tick: 0,
        config: makeConfig(),
        tick_range: [0, 10],
        supports_history: true,
        is_paused: false,
      } satisfies MetadataMessage);
      ws.simulateMessage({
        type: "snapshot",
        tick: 5,
        snapshot: makeSnapshot({ tick: 5 }),
      } satisfies SnapshotMessage);
    });

    it("sends pause before seek when not already paused", () => {
      const ws = MockWebSocket.instances[0];
      const before = ws.sentMessages.length;
      state.seek(3);
      const sent = ws.sentMessages.slice(before).map((m) => JSON.parse(m));
      expect(sent[0]).toEqual({ command: "pause" });
      expect(sent[1]).toEqual({ command: "seek", tick: 3 });
    });

    it("does not send pause when already paused", () => {
      state.isPaused = true;
      const ws = MockWebSocket.instances[0];
      const before = ws.sentMessages.length;
      state.seek(3);
      const sent = ws.sentMessages.slice(before).map((m) => JSON.parse(m));
      expect(sent).toEqual([{ command: "seek", tick: 3 }]);
    });
  });
});
