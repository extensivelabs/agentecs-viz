import {
  computeEntityArchetypeHistory,
  summarizeArchetypes,
  type ArchetypeSummary,
  type EntityArchetypeHistoryEntry,
} from "../archetype-analysis";
import type { VisualizationConfig, WorldSnapshot } from "../types";
import { world } from "./world.svelte";

type HistoryWindow = {
  start: number;
  end: number;
};

const MAX_CACHED_ENTITY_HISTORIES = 16;
const MAX_HISTORY_SNAPSHOTS = 240;
const SNAPSHOT_FETCH_BATCH_SIZE = 24;

export class ArchetypeState {
  entityHistory = $state.raw(new Map<number, EntityArchetypeHistoryEntry[]>());
  entityHistoryWindows = $state.raw(new Map<number, HistoryWindow>());
  loadingEntityId: number | null = $state(null);
  errorEntityId: number | null = $state(null);
  error: string | null = $state(null);
  private cachedConfig: VisualizationConfig | null = $state.raw(null);
  private pendingEntityId: number | null = null;

  populationRows: ArchetypeSummary[] = $derived.by(() =>
    summarizeArchetypes(world.entities, world.archetypeConfigMap, world.config?.color_palette),
  );

  selectedEntityHistory: EntityArchetypeHistoryEntry[] = $derived.by(() => {
    if (world.selectedEntityId === null || this.cachedConfig !== world.config) return [];
    const entries = this.entityHistory.get(world.selectedEntityId) ?? [];
    return entries.filter((entry) => entry.tick <= world.tick);
  });

  selectedEntityHistoryError: string | null = $derived.by(() => {
    if (world.selectedEntityId === null || this.errorEntityId !== world.selectedEntityId) {
      return null;
    }
    return this.error;
  });

  async ensureEntityHistory(entityId: number): Promise<void> {
    if (!world.supportsHistory || world.config === null) return;

    this.resetCacheIfWorldChanged();
    this.touchEntity(entityId);

    const targetStart = world.minTick;
    const targetEnd = world.tick;
    const existingWindow = this.entityHistoryWindows.get(entityId);

    if (
      existingWindow
      && existingWindow.start <= targetStart
      && existingWindow.end >= targetEnd
    ) {
      if (this.errorEntityId === entityId) {
        this.errorEntityId = null;
        this.error = null;
      }
      return;
    }

    if (this.loadingEntityId === entityId) {
      this.pendingEntityId = entityId;
      return;
    }

    this.loadingEntityId = entityId;
    this.pendingEntityId = null;
    this.errorEntityId = null;
    this.error = null;

    let shouldCatchUp = false;

    try {
      if (
        existingWindow
        && existingWindow.start <= targetStart
        && targetEnd > existingWindow.end
      ) {
        const segmentSnapshots = await this.fetchSnapshots(existingWindow.end, targetEnd);
        const segmentHistory = computeEntityArchetypeHistory(
          segmentSnapshots,
          entityId,
          world.archetypeConfigMap,
        ).filter((entry) => entry.tick > existingWindow.end);
        this.storeEntityHistory(
          entityId,
          [...(this.entityHistory.get(entityId) ?? []), ...segmentHistory],
          { start: existingWindow.start, end: targetEnd },
        );
        shouldCatchUp = targetEnd < world.tick;
      } else {
        const snapshots = await this.fetchSnapshots(targetStart, targetEnd);
        const history = computeEntityArchetypeHistory(
          snapshots,
          entityId,
          world.archetypeConfigMap,
        );
        this.storeEntityHistory(entityId, history, { start: targetStart, end: targetEnd });
        shouldCatchUp = targetEnd < world.tick;
      }
    } catch (error) {
      this.errorEntityId = entityId;
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (this.loadingEntityId === entityId) {
        this.loadingEntityId = null;
      }

      if (
        shouldCatchUp
        && this.pendingEntityId === entityId
        && world.selectedEntityId === entityId
      ) {
        this.pendingEntityId = null;
        queueMicrotask(() => {
          void this.ensureEntityHistory(entityId);
        });
      }
    }
  }

  private resetCacheIfWorldChanged(): void {
    if (this.cachedConfig === world.config) return;

    this.cachedConfig = world.config;
    this.entityHistory = new Map();
    this.entityHistoryWindows = new Map();
    this.loadingEntityId = null;
    this.errorEntityId = null;
    this.error = null;
    this.pendingEntityId = null;
  }

  private async fetchSnapshots(start: number, end: number): Promise<WorldSnapshot[]> {
    const tickCount = end - start + 1;
    if (tickCount > MAX_HISTORY_SNAPSHOTS) {
      throw new Error(
        `Archetype history is limited to ${MAX_HISTORY_SNAPSHOTS} ticks; narrow the timeline window to inspect this entity.`,
      );
    }

    const snapshots: WorldSnapshot[] = [];

    for (let batchStart = start; batchStart <= end; batchStart += SNAPSHOT_FETCH_BATCH_SIZE) {
      const batchEnd = Math.min(end, batchStart + SNAPSHOT_FETCH_BATCH_SIZE - 1);
      const ticks = Array.from(
        { length: batchEnd - batchStart + 1 },
        (_, index) => batchStart + index,
      );
      const batchSnapshots = await Promise.all(
        ticks.map((tick) => world.getSnapshotAtTick(tick)),
      );

      batchSnapshots.forEach((snapshot, index) => {
        if (snapshot.tick !== ticks[index]) {
          throw new Error(`Snapshot unavailable at tick ${ticks[index]}`);
        }
      });

      snapshots.push(...batchSnapshots);
    }

    return snapshots;
  }

  private touchEntity(entityId: number): void {
    if (!this.entityHistory.has(entityId) && !this.entityHistoryWindows.has(entityId)) return;

    const nextHistory = new Map(this.entityHistory);
    const nextWindows = new Map(this.entityHistoryWindows);
    const history = nextHistory.get(entityId);
    const window = nextWindows.get(entityId);

    if (history) {
      nextHistory.delete(entityId);
      nextHistory.set(entityId, history);
    }

    if (window) {
      nextWindows.delete(entityId);
      nextWindows.set(entityId, window);
    }

    this.entityHistory = nextHistory;
    this.entityHistoryWindows = nextWindows;
  }

  private storeEntityHistory(
    entityId: number,
    history: EntityArchetypeHistoryEntry[],
    window: HistoryWindow,
  ): void {
    const nextHistory = new Map(this.entityHistory);
    const nextWindows = new Map(this.entityHistoryWindows);

    nextHistory.delete(entityId);
    nextWindows.delete(entityId);
    nextHistory.set(entityId, history);
    nextWindows.set(entityId, window);

    while (nextHistory.size > MAX_CACHED_ENTITY_HISTORIES) {
      const oldestEntityId = nextHistory.keys().next().value;
      if (oldestEntityId === undefined) break;
      nextHistory.delete(oldestEntityId);
      nextWindows.delete(oldestEntityId);
      if (this.errorEntityId === oldestEntityId) {
        this.errorEntityId = null;
        this.error = null;
      }
    }

    this.entityHistory = nextHistory;
    this.entityHistoryWindows = nextWindows;
  }
}

export const archetypes = new ArchetypeState();
