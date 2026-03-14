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

        const nextHistory = new Map(this.entityHistory);
        nextHistory.set(entityId, [
          ...(this.entityHistory.get(entityId) ?? []),
          ...segmentHistory,
        ]);
        this.entityHistory = nextHistory;

        const nextWindows = new Map(this.entityHistoryWindows);
        nextWindows.set(entityId, { start: existingWindow.start, end: targetEnd });
        this.entityHistoryWindows = nextWindows;
        shouldCatchUp = targetEnd < world.tick;
      } else {
        const snapshots = await this.fetchSnapshots(targetStart, targetEnd);
        const history = computeEntityArchetypeHistory(
          snapshots,
          entityId,
          world.archetypeConfigMap,
        );

        const nextHistory = new Map(this.entityHistory);
        nextHistory.set(entityId, history);
        this.entityHistory = nextHistory;

        const nextWindows = new Map(this.entityHistoryWindows);
        nextWindows.set(entityId, { start: targetStart, end: targetEnd });
        this.entityHistoryWindows = nextWindows;
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
    const ticks = Array.from({ length: end - start + 1 }, (_, index) => start + index);
    const snapshots = await Promise.all(
      ticks.map((tick) => world.getSnapshotAtTick(tick)),
    );

    snapshots.forEach((snapshot, index) => {
      if (snapshot.tick !== ticks[index]) {
        throw new Error(`Snapshot unavailable at tick ${ticks[index]}`);
      }
    });

    return snapshots;
  }
}

export const archetypes = new ArchetypeState();
