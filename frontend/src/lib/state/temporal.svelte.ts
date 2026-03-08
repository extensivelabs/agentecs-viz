import {
  diffWorld,
  type EntityChangeType,
  type WorldDiff,
  type WorldDiffEntry,
} from "../diff";
import type { WorldSnapshot } from "../types";
import { world } from "./world.svelte";

export interface TemporalFilters {
  archetypes: string[];
  components: string[];
  changeTypes: EntityChangeType[];
  minFieldChanges: number;
}

const DEFAULT_FILTERS = (): TemporalFilters => ({
  archetypes: [],
  components: [],
  changeTypes: [],
  minFieldChanges: 0,
});

export function archetypeKey(archetype: string[]): string {
  return [...archetype].sort((left, right) => left.localeCompare(right)).join(",");
}

export function filterEntries(
  entries: WorldDiffEntry[],
  filters: TemporalFilters,
): WorldDiffEntry[] {
  return entries.filter((entry) => {
    if (
      filters.changeTypes.length > 0
      && !filters.changeTypes.includes(entry.changeType)
    ) {
      return false;
    }

    if (filters.minFieldChanges > 0 && entry.totalChanges < filters.minFieldChanges) {
      return false;
    }

    if (
      filters.archetypes.length > 0
      && !filters.archetypes.includes(archetypeKey(entry.archetype))
    ) {
      return false;
    }

    if (
      filters.components.length > 0
      && !filters.components.some((component) => entry.archetype.includes(component))
    ) {
      return false;
    }

    return true;
  });
}

export class TemporalState {
  t1: number = $state(0);
  t2: number = $state(0);
  loading: boolean = $state(false);
  error: string | null = $state(null);
  page: number = $state(0);
  pageSize = 20;
  filters: TemporalFilters = $state(DEFAULT_FILTERS());
  expandedEntityIds: Set<number> = $state(new Set());
  private snapshotT1Tick = $state<number | null>(null);
  private snapshotT2Tick = $state<number | null>(null);
  private snapshotT1 = $state.raw<WorldSnapshot | null>(null);
  private snapshotT2 = $state.raw<WorldSnapshot | null>(null);

  hasComparison: boolean = $derived(this.snapshotT1 !== null && this.snapshotT2 !== null);

  worldDiff: WorldDiff | null = $derived.by(() => {
    if (!this.snapshotT1 || !this.snapshotT2) return null;
    return diffWorld(this.snapshotT1, this.snapshotT2);
  });

  filteredEntries: WorldDiffEntry[] = $derived.by(() => {
    if (!this.worldDiff) return [];
    return filterEntries(this.worldDiff.entries, this.filters);
  });

  pagedEntries: WorldDiffEntry[] = $derived.by(() => {
    const start = this.page * this.pageSize;
    return this.filteredEntries.slice(start, start + this.pageSize);
  });

  totalPages: number = $derived(
    Math.max(1, Math.ceil(this.filteredEntries.length / this.pageSize)),
  );

  availableArchetypes: string[] = $derived.by(() => {
    const archetypes = new Set<string>();
    for (const entry of this.worldDiff?.entries ?? []) {
      archetypes.add(archetypeKey(entry.archetype));
    }
    return [...archetypes].sort((left, right) => left.localeCompare(right));
  });

  availableComponents: string[] = $derived.by(() => {
    const components = new Set<string>();
    for (const entry of this.worldDiff?.entries ?? []) {
      for (const component of entry.archetype) {
        components.add(component);
      }
    }
    return [...components].sort((left, right) => left.localeCompare(right));
  });

  initDefaults(): void {
    if (!world.supportsHistory) return;
    this.t2 = world.tick;
    this.t1 = Math.max(world.minTick, world.tick - 1);
  }

  reset(): void {
    this.t1 = 0;
    this.t2 = 0;
    this.loading = false;
    this.error = null;
    this.page = 0;
    this.filters = DEFAULT_FILTERS();
    this.expandedEntityIds = new Set();
    this.snapshotT1Tick = null;
    this.snapshotT2Tick = null;
    this.snapshotT1 = null;
    this.snapshotT2 = null;
  }

  async fetchSnapshots(): Promise<void> {
    if (!world.supportsHistory) return;

    const requestedT1 = this.clampTick(this.t1);
    const requestedT2 = this.clampTick(this.t2);
    this.t1 = requestedT1;
    this.t2 = requestedT2;
    this.loading = true;
    this.error = null;

    try {
      if (requestedT1 === requestedT2) {
        const snapshot = await world.getSnapshotAtTick(requestedT1);
        this.snapshotT1 = snapshot;
        this.snapshotT2 = snapshot;
        this.snapshotT1Tick = requestedT1;
        this.snapshotT2Tick = requestedT2;
      } else {
        const [snapshotT1, snapshotT2] = await Promise.all([
          world.getSnapshotAtTick(requestedT1),
          world.getSnapshotAtTick(requestedT2),
        ]);
        this.snapshotT1 = snapshotT1;
        this.snapshotT2 = snapshotT2;
        this.snapshotT1Tick = requestedT1;
        this.snapshotT2Tick = requestedT2;
      }

      this.page = 0;
      this.expandedEntityIds = new Set();
    } catch (error) {
      this.snapshotT1 = null;
      this.snapshotT2 = null;
      this.snapshotT1Tick = null;
      this.snapshotT2Tick = null;
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
    }
  }

  setArchetypeFilter(value: string): void {
    this.filters = {
      ...this.filters,
      archetypes: value ? [value] : [],
    };
    this.page = 0;
  }

  setComponentFilter(value: string): void {
    this.filters = {
      ...this.filters,
      components: value ? [value] : [],
    };
    this.page = 0;
  }

  setMinFieldChanges(value: number): void {
    this.filters = {
      ...this.filters,
      minFieldChanges: Math.max(0, Math.floor(value)),
    };
    this.page = 0;
  }

  toggleChangeType(changeType: EntityChangeType): void {
    const changeTypes = this.filters.changeTypes.includes(changeType)
      ? this.filters.changeTypes.filter((value) => value !== changeType)
      : [...this.filters.changeTypes, changeType];

    this.filters = {
      ...this.filters,
      changeTypes,
    };
    this.page = 0;
  }

  resetFilters(): void {
    this.filters = DEFAULT_FILTERS();
    this.page = 0;
  }

  toggleEntity(entityId: number): void {
    const nextExpanded = new Set(this.expandedEntityIds);
    if (nextExpanded.has(entityId)) {
      nextExpanded.delete(entityId);
    } else {
      nextExpanded.add(entityId);
    }
    this.expandedEntityIds = nextExpanded;
  }

  isEntityExpanded(entityId: number): boolean {
    return this.expandedEntityIds.has(entityId);
  }

  prevPage(): void {
    this.page = Math.max(0, this.page - 1);
  }

  nextPage(): void {
    this.page = Math.min(this.totalPages - 1, this.page + 1);
  }

  private clampTick(value: number): number {
    return Math.min(world.maxTick, Math.max(world.minTick, value));
  }
}

export const temporal = new TemporalState();
