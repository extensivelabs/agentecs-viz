import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArchetypeState } from "../lib/state/archetypes.svelte";
import { world } from "../lib/state/world.svelte";
import { makeEntity, makeSnapshot, setWorldState } from "./helpers";

type DeferredSnapshot = {
  promise: Promise<ReturnType<typeof makeSnapshot>>;
  resolve: (value: ReturnType<typeof makeSnapshot>) => void;
};

function deferredSnapshot(): DeferredSnapshot {
  let resolve!: (value: ReturnType<typeof makeSnapshot>) => void;
  const promise = new Promise<ReturnType<typeof makeSnapshot>>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("ArchetypeState", () => {
  beforeEach(() => {
    world.disconnect();
    vi.restoreAllMocks();
  });

  it("catches up when world.tick advances during an in-flight history load", async () => {
    const currentEntity = makeEntity(1, ["Agent", "Position"]);
    setWorldState([currentEntity], {
      archetypes: [{ key: "Agent,Position", label: "Agent / Position" }],
    });
    world.supportsHistory = true;
    world.tickRange = [1, 2];
    world.snapshot = makeSnapshot({ tick: 2, entity_count: 1, entities: [currentEntity] });
    world.selectEntity(1);

    const state = new ArchetypeState();
    const requests = new Map<number, DeferredSnapshot[]>();
    const queueRequest = (tick: number): DeferredSnapshot => {
      const request = deferredSnapshot();
      requests.set(tick, [...(requests.get(tick) ?? []), request]);
      return request;
    };

    vi.spyOn(world, "getSnapshotAtTick").mockImplementation((tick) => queueRequest(tick).promise);

    const initialLoad = state.ensureEntityHistory(1);

    await vi.waitFor(() => {
      expect(state.loadingEntityId).toBe(1);
      expect(requests.get(1)).toHaveLength(1);
      expect(requests.get(2)).toHaveLength(1);
    });

    world.tickRange = [1, 3];
    world.snapshot = makeSnapshot({ tick: 3, entity_count: 1, entities: [currentEntity] });

    await state.ensureEntityHistory(1);

    requests.get(1)?.[0].resolve(
      makeSnapshot({ tick: 1, entity_count: 1, entities: [makeEntity(1, ["Agent"])] }),
    );
    requests.get(2)?.[0].resolve(
      makeSnapshot({ tick: 2, entity_count: 1, entities: [currentEntity] }),
    );

    await initialLoad;

    await vi.waitFor(() => {
      expect(requests.get(2)).toHaveLength(2);
      expect(requests.get(3)).toHaveLength(1);
    });

    requests.get(2)?.[1].resolve(
      makeSnapshot({ tick: 2, entity_count: 1, entities: [currentEntity] }),
    );
    requests.get(3)?.[0].resolve(
      makeSnapshot({ tick: 3, entity_count: 1, entities: [currentEntity] }),
    );

    await vi.waitFor(() => {
      expect(state.loadingEntityId).toBeNull();
      expect(state.entityHistoryWindows.get(1)).toEqual({ start: 1, end: 3 });
      expect(state.selectedEntityHistory).toEqual([
        {
          tick: 1,
          kind: "spawned",
          archetype: ["Agent"],
          key: "Agent",
          label: "Agent",
        },
        {
          tick: 2,
          kind: "changed",
          archetype: ["Agent", "Position"],
          key: "Agent,Position",
          label: "Agent / Position",
        },
      ]);
    });
  });
});
