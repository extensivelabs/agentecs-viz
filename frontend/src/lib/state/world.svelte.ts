import {
  LOOP_DETECTION_THRESHOLD,
  TOKEN_COST_BUDGET_USD,
  WS_URL,
  type PlaybackMode,
} from "../config";
import { diffEntity, type EntityDiff } from "../diff";
import {
  getAvailableComponents as queryAvailableComponents,
  matchingEntityIds,
  type QueryDef,
} from "../query";
import { aggregateSpanUsage, type ModelUsageTotals, type SpanUsageTotals } from "../traces";
import type {
  ArchetypeConfig,
  ComponentSnapshot,
  ConnectionState,
  EntitySnapshot,
  ErrorEventMessage,
  ServerMessage,
  SpanEventMessage,
  TickDelta,
  VisualizationConfig,
  WorldSnapshot,
} from "../types";
import { entityHash, getArchetypeKey } from "../utils";
import { WebSocketClient } from "../websocket";

type AggregatedSpanUsage = {
  totals: SpanUsageTotals;
  byModel: ModelUsageTotals[];
};

type SpanUsageFrame = {
  tick: number;
  usage: AggregatedSpanUsage;
};

const EMPTY_SPAN_USAGE: AggregatedSpanUsage = {
  totals: {
    prompt: 0,
    completion: 0,
    total: 0,
    costUsd: 0,
  },
  byModel: [],
};

export class WorldState {
  connectionState: ConnectionState = $state("disconnected");
  snapshot: WorldSnapshot | null = $state.raw(null);
  lastError: string | null = $state(null);
  isPaused: boolean = $state(false);
  isReplayPlaying: boolean = $state(false);
  supportsHistory: boolean = $state(false);
  tickRange: [number, number] | null = $state(null);
  config: VisualizationConfig | null = $state.raw(null);
  selectedEntityId: number | null = $state(null);

  newEntityIds: Set<number> = $state(new Set());
  changedEntityIds: Set<number> = $state(new Set());
  loopEntityIds: Set<number> = $state(new Set());
  autoPauseOnLoop: boolean = $state(false);

  errors: ErrorEventMessage[] = $state.raw([]);
  errorPanelOpen: boolean = $state(false);

  spans: SpanEventMessage[] = $state.raw([]);
  selectedSpanId: string | null = $state(null);

  activeQuery: QueryDef | null = $state(null);
  savedQueries: QueryDef[] = $state([]);

  previousSnapshot: WorldSnapshot | null = $state.raw(null);
  pinnedEntityState: Map<number, EntitySnapshot> | null = $state.raw(null);
  pinnedTick: number | null = $state(null);

  private client: WebSocketClient | null = null;
  private entityHashes = new Map<number, string>();
  private unchangedTickCounts = new Map<number, number>();
  private everChangedEntityIds = new Set<number>();
  private replayTimer: ReturnType<typeof setInterval> | null = null;
  private currentSpeed: number = 1;
  private spanUsageCacheSpans: SpanEventMessage[] = [];
  private spanUsageCacheByTick = new Map<number, AggregatedSpanUsage>();
  private spanUsageCacheTimeline: SpanUsageFrame[] = [];

  tick: number = $derived(this.snapshot?.tick ?? 0);
  entityCount: number = $derived(this.snapshot?.entity_count ?? 0);
  entities: EntitySnapshot[] = $derived(this.snapshot?.entities ?? []);
  archetypes: string[][] = $derived(this.snapshot?.archetypes ?? []);
  isConnected: boolean = $derived(this.connectionState === "connected");

  selectedEntity: EntitySnapshot | undefined = $derived(
    this.selectedEntityId !== null
      ? this.entities.find((e) => e.id === this.selectedEntityId)
      : undefined,
  );

  playbackMode: PlaybackMode = $derived.by(() => {
    if (this.isReplayPlaying) return "replay";
    if (
      this.tickRange &&
      this.snapshot &&
      this.snapshot.tick < this.tickRange[1]
    )
      return "history";
    if (this.isPaused) return "paused";
    return "live";
  });

  canScrub: boolean = $derived(this.supportsHistory);
  minTick: number = $derived(this.tickRange?.[0] ?? 0);
  maxTick: number = $derived(this.tickRange?.[1] ?? 0);

  isAtLive: boolean = $derived(
    !this.tickRange || this.tick >= this.tickRange[1],
  );

  worldName: string = $derived(this.config?.world_name ?? "AgentECS");
  chatEnabled: boolean = $derived(this.config?.chat_enabled ?? false);

  archetypeConfigMap: Map<string, ArchetypeConfig> = $derived.by(() => {
    const map = new Map<string, ArchetypeConfig>();
    for (const cfg of this.config?.archetypes ?? []) {
      map.set(cfg.key, cfg);
    }
    return map;
  });

  visibleErrors: ErrorEventMessage[] = $derived(
    this.errors.filter((e) => e.tick <= this.tick),
  );

  currentTickErrors: ErrorEventMessage[] = $derived(
    this.visibleErrors.filter((e) => e.tick === this.tick),
  );

  errorEntityIds: Set<number> = $derived(
    new Set(this.currentTickErrors.map((e) => e.entity_id)),
  );

  pastErrorEntityIds: Set<number> = $derived.by(() => {
    const past = new Set<number>();
    const current = this.errorEntityIds;
    for (const e of this.visibleErrors) {
      if (!current.has(e.entity_id)) {
        past.add(e.entity_id);
      }
    }
    return past;
  });

  visibleErrorCount: number = $derived(this.visibleErrors.length);

  visibleSpans: SpanEventMessage[] = $derived(
    this.spans.filter((s) => {
      const tick = s.attributes["agentecs.tick"];
      return typeof tick === "number" && tick <= this.tick;
    }),
  );

  selectedEntitySpans: SpanEventMessage[] = $derived(
    this.selectedEntityId !== null
      ? this.visibleSpans.filter(
          (s) => s.attributes["agentecs.entity_id"] === this.selectedEntityId,
        )
      : [],
  );

  selectedSpan: SpanEventMessage | undefined = $derived(
    this.selectedSpanId !== null
      ? this.visibleSpans.find((s) => s.span_id === this.selectedSpanId)
      : undefined,
  );

  spanCount: number = $derived(this.visibleSpans.length);

  private spanUsageTimeline: SpanUsageFrame[] = $derived.by(() =>
    this.getOrBuildSpanUsageTimeline(this.spans),
  );

  spanUsage: AggregatedSpanUsage = $derived.by(() =>
    this.getSpanUsageAtTick(this.tick),
  );

  totalTokenUsage: SpanUsageTotals = $derived(this.spanUsage.totals);
  modelTokenUsage: ModelUsageTotals[] = $derived(this.spanUsage.byModel);

  selectedEntitySpanUsage: {
    totals: SpanUsageTotals;
    byModel: ModelUsageTotals[];
  } = $derived(aggregateSpanUsage(this.selectedEntitySpans));

  selectedEntityTokenUsage: SpanUsageTotals = $derived(
    this.selectedEntitySpanUsage.totals,
  );
  selectedEntityModelTokenUsage: ModelUsageTotals[] = $derived(
    this.selectedEntitySpanUsage.byModel,
  );

  tokenCostBudgetUsd: number = TOKEN_COST_BUDGET_USD;
  tokenCostBudgetExceeded: boolean = $derived(
    this.totalTokenUsage.costUsd >= this.tokenCostBudgetUsd,
  );

  entityDiffs: Map<number, EntityDiff> = $derived.by(() => {
    const diffs = new Map<number, EntityDiff>();
    if (!this.previousSnapshot) return diffs;

    const prevMap = new Map(
      this.previousSnapshot.entities.map((e) => [e.id, e]),
    );
    const curMap = new Map(this.entities.map((e) => [e.id, e]));

    for (const id of this.changedEntityIds) {
      const prev = prevMap.get(id);
      const cur = curMap.get(id);
      if (!prev || !cur) continue;
      const diff = diffEntity(prev, cur);
      if (diff.totalChanges > 0) {
        diffs.set(id, diff);
      }
    }

    return diffs;
  });

  matchingEntityIds: Set<number> = $derived(
    this.activeQuery && this.activeQuery.clauses.length > 0
      ? matchingEntityIds(this.entities, this.activeQuery)
      : new Set<number>(),
  );

  hasActiveFilter: boolean = $derived(
    this.activeQuery !== null && this.activeQuery.clauses.length > 0,
  );

  matchCount: number = $derived(this.matchingEntityIds.size);

  selectedEntityDiff: EntityDiff | null = $derived(
    this.selectedEntityId !== null
      ? this.entityDiffs.get(this.selectedEntityId) ?? null
      : null,
  );

  selectedEntityLoopInfo: {
    cycleLength: number;
    unchangedTicks: number;
    unchangedSinceTick: number;
    frozenFields: string[];
  } | null = $derived.by(() => {
    if (this.selectedEntityId === null || !this.loopEntityIds.has(this.selectedEntityId)) {
      return null;
    }

    const entity = this.selectedEntity;
    if (!entity) return null;

    const unchangedTicks = this.unchangedTickCounts.get(entity.id) ?? 0;
    const frozenFields = entity.components.flatMap((component) =>
      Object.keys(component.data).map((fieldName) => `${component.type_short}.${fieldName}`),
    );

    return {
      cycleLength: 1,
      unchangedTicks,
      unchangedSinceTick: Math.max(0, this.tick - unchangedTicks),
      frozenFields,
    };
  });

  entityDiffCounts: Map<number, number> = $derived.by(() => {
    const counts = new Map<number, number>();
    for (const [id, diff] of this.entityDiffs) {
      counts.set(id, diff.totalChanges);
    }
    return counts;
  });

  selectedEntityPinnedDiff: EntityDiff | null = $derived.by(() => {
    if (
      !this.selectedEntity ||
      !this.pinnedEntityState ||
      this.selectedEntityId === null
    )
      return null;
    const pinned = this.pinnedEntityState.get(this.selectedEntityId);
    if (!pinned) return null;
    const diff = diffEntity(pinned, this.selectedEntity);
    return diff.totalChanges > 0 ? diff : null;
  });

  private mergeSpanUsage(
    base: AggregatedSpanUsage,
    delta: AggregatedSpanUsage,
  ): AggregatedSpanUsage {
    const totals: SpanUsageTotals = {
      prompt: base.totals.prompt + delta.totals.prompt,
      completion: base.totals.completion + delta.totals.completion,
      total: base.totals.total + delta.totals.total,
      costUsd: base.totals.costUsd + delta.totals.costUsd,
    };

    const byModel = new Map<string, ModelUsageTotals>();
    const addModelUsage = (usage: ModelUsageTotals): void => {
      const current = byModel.get(usage.model) ?? {
        model: usage.model,
        prompt: 0,
        completion: 0,
        total: 0,
        costUsd: 0,
      };
      current.prompt += usage.prompt;
      current.completion += usage.completion;
      current.total += usage.total;
      current.costUsd += usage.costUsd;
      byModel.set(usage.model, current);
    };

    for (const usage of base.byModel) {
      addModelUsage(usage);
    }
    for (const usage of delta.byModel) {
      addModelUsage(usage);
    }

    return {
      totals,
      byModel: [...byModel.values()].sort((a, b) => b.costUsd - a.costUsd),
    };
  }

  private rebuildSpanUsageTimelineFromTickUsage(): void {
    const timeline: SpanUsageFrame[] = [];
    let cumulative: AggregatedSpanUsage = EMPTY_SPAN_USAGE;

    const ticks = [...this.spanUsageCacheByTick.keys()].sort((a, b) => a - b);
    for (const tick of ticks) {
      const tickUsage = this.spanUsageCacheByTick.get(tick) ?? EMPTY_SPAN_USAGE;
      cumulative = this.mergeSpanUsage(cumulative, tickUsage);
      timeline.push({ tick, usage: cumulative });
    }

    this.spanUsageCacheTimeline = timeline;
  }

  private rebuildSpanUsageCache(spans: SpanEventMessage[]): void {
    const byTick = new Map<number, AggregatedSpanUsage>();
    for (const span of spans) {
      const tick = span.attributes["agentecs.tick"];
      if (typeof tick !== "number") continue;

      const spanUsage = aggregateSpanUsage([span]);
      const existing = byTick.get(tick) ?? EMPTY_SPAN_USAGE;
      byTick.set(tick, this.mergeSpanUsage(existing, spanUsage));
    }

    this.spanUsageCacheByTick = byTick;
    this.rebuildSpanUsageTimelineFromTickUsage();
  }

  private appendSpanUsage(span: SpanEventMessage): void {
    const tick = span.attributes["agentecs.tick"];
    if (typeof tick !== "number") return;

    const spanUsage = aggregateSpanUsage([span]);
    const existingTickUsage = this.spanUsageCacheByTick.get(tick) ?? EMPTY_SPAN_USAGE;
    const mergedTickUsage = this.mergeSpanUsage(existingTickUsage, spanUsage);
    this.spanUsageCacheByTick.set(tick, mergedTickUsage);

    const timeline = this.spanUsageCacheTimeline;
    if (timeline.length === 0) {
      this.spanUsageCacheTimeline = [{ tick, usage: mergedTickUsage }];
      return;
    }

    const lastIndex = timeline.length - 1;
    const lastFrame = timeline[lastIndex];

    if (tick > lastFrame.tick) {
      this.spanUsageCacheTimeline = [
        ...timeline,
        { tick, usage: this.mergeSpanUsage(lastFrame.usage, mergedTickUsage) },
      ];
      return;
    }

    if (tick === lastFrame.tick) {
      const nextTimeline = [...timeline];
      nextTimeline[lastIndex] = {
        tick,
        usage: this.mergeSpanUsage(lastFrame.usage, spanUsage),
      };
      this.spanUsageCacheTimeline = nextTimeline;
      return;
    }

    this.rebuildSpanUsageTimelineFromTickUsage();
  }

  private getOrBuildSpanUsageTimeline(spans: SpanEventMessage[]): SpanUsageFrame[] {
    if (spans.length === 0) {
      this.spanUsageCacheSpans = [];
      this.spanUsageCacheByTick = new Map<number, AggregatedSpanUsage>();
      this.spanUsageCacheTimeline = [];
      return this.spanUsageCacheTimeline;
    }

    const previousSpans = this.spanUsageCacheSpans;
    const isAppendOnly = (
      spans.length === previousSpans.length + 1
      && (
        previousSpans.length === 0
        || spans[previousSpans.length - 1] === previousSpans[previousSpans.length - 1]
      )
    );

    if (isAppendOnly) {
      this.appendSpanUsage(spans[spans.length - 1]);
      this.spanUsageCacheSpans = spans;
      return this.spanUsageCacheTimeline;
    }

    if (spans !== previousSpans) {
      this.rebuildSpanUsageCache(spans);
      this.spanUsageCacheSpans = spans;
    }

    return this.spanUsageCacheTimeline;
  }

  connect(url?: string): void {
    if (this.client) this.disconnect();
    this.resetState();

    const client = new WebSocketClient(url ?? WS_URL, {
      onMessage: (msg) => {
        if (this.client !== client) return;
        this.handleMessage(msg);
      },
      onStateChange: (state) => {
        if (this.client !== client) return;
        this.connectionState = state;
        if (state === "disconnected" || state === "error") {
          this.resetState();
        }
      },
      onError: (err) => {
        if (this.client !== client) return;
        this.lastError =
          err instanceof Event ? "Connection error" : String(err);
      },
    });
    this.client = client;
    client.connect();
  }

  private resetState(): void {
    this.snapshot = null;
    this.previousSnapshot = null;
    this.pinnedEntityState = null;
    this.pinnedTick = null;
    this.config = null;
    this.tickRange = null;
    this.supportsHistory = false;
    this.isPaused = false;
    this.lastError = null;
    this.entityHashes.clear();
    this.unchangedTickCounts.clear();
    this.everChangedEntityIds.clear();
    this.newEntityIds = new Set();
    this.changedEntityIds = new Set();
    this.loopEntityIds = new Set();
    this.selectedEntityId = null;
    this.errors = [];
    this.errorPanelOpen = false;
    this.spans = [];
    this.spanUsageCacheSpans = [];
    this.spanUsageCacheByTick = new Map<number, AggregatedSpanUsage>();
    this.spanUsageCacheTimeline = [];
    this.selectedSpanId = null;
  }

  disconnect(): void {
    this.stopReplay();
    const client = this.client;
    this.client = null;
    this.connectionState = "disconnected";
    this.resetState();
    client?.disconnect();
  }

  pause(): void {
    this.client?.pause();
  }

  resume(): void {
    this.client?.resume();
  }

  togglePause(): void {
    if (this.isReplayPlaying) {
      this.stopReplay();
      return;
    }
    if (!this.isAtLive && this.isPaused && this.supportsHistory) {
      this.startReplay();
      return;
    }
    if (this.isPaused) {
      this.resume();
    } else {
      this.pause();
    }
  }

  step(): void {
    if (!this.isAtLive && this.supportsHistory) {
      if (this.tick >= this.maxTick) return;
      this.seek(this.tick + 1);
      return;
    }
    this.client?.step();
  }

  stepBack(): void {
    if (!this.canScrub || this.tick <= this.minTick) return;
    this.seek(this.tick - 1);
  }

  goToLive(): void {
    this.stopReplay();
    if (this.tickRange) {
      this.seek(this.tickRange[1]);
    }
    this.resume();
  }

  seek(tick: number): void {
    if (!this.isPaused && !this.isReplayPlaying) {
      this.isPaused = true;
      this.client?.pause();
    }
    this.client?.seek(tick);
  }

  setSpeed(ticksPerSecond: number): void {
    this.currentSpeed = ticksPerSecond;
    this.client?.setSpeed(ticksPerSecond);
    if (this.isReplayPlaying) {
      this.startReplay();
    }
  }

  selectEntity(id: number | null): void {
    this.selectedEntityId = id;
  }

  play(speed?: number): void {
    if (!this.supportsHistory || !this.tickRange) return;
    this.startReplay(speed);
  }

  toggleErrorPanel(): void {
    this.errorPanelOpen = !this.errorPanelOpen;
  }

  selectSpan(id: string | null): void {
    this.selectedSpanId = id;
  }

  jumpToError(error: ErrorEventMessage): void {
    this.seek(error.tick);
    this.selectEntity(error.entity_id);
  }

  toggleAutoPauseOnLoop(): void {
    this.autoPauseOnLoop = !this.autoPauseOnLoop;
  }

  pinCurrentState(): void {
    if (!this.snapshot) return;
    this.pinnedEntityState = new Map(
      this.snapshot.entities.map((e) => [e.id, e]),
    );
    this.pinnedTick = this.snapshot.tick;
  }

  clearPinnedState(): void {
    this.pinnedEntityState = null;
    this.pinnedTick = null;
  }

  setQuery(query: QueryDef | null): void {
    this.activeQuery = query;
  }

  getAvailableComponents(): string[] {
    return queryAvailableComponents(this.entities);
  }

  clearQuery(): void {
    this.activeQuery = null;
  }

  applyArchetypeFilter(archetype: string[]): void {
    const archetypeKey = getArchetypeKey(archetype);
    const existing = this.activeQuery?.clauses ?? [];
    const clauses = [
      ...existing.filter((clause) => clause.type !== "archetype_eq"),
      { type: "archetype_eq", component: archetypeKey } as const,
    ];

    this.setQuery({
      name: this.activeQuery?.name ?? "",
      clauses,
    });
  }

  getSnapshotAtTick(tick: number): Promise<WorldSnapshot> {
    if (!this.client) {
      return Promise.reject(new Error("Not connected"));
    }

    return this.client.getSnapshot(tick);
  }

  saveQuery(query: QueryDef): void {
    const name = query.name.trim();
    if (!name || query.clauses.length === 0) return;
    const normalized = { ...query, name };
    const existing = this.savedQueries.findIndex((q) => q.name === name);
    if (existing >= 0) {
      this.savedQueries = [
        ...this.savedQueries.slice(0, existing),
        normalized,
        ...this.savedQueries.slice(existing + 1),
      ];
    } else {
      this.savedQueries = [...this.savedQueries, normalized];
    }
  }

  deleteSavedQuery(name: string): void {
    const trimmed = name.trim();
    this.savedQueries = this.savedQueries.filter((q) => q.name !== trimmed);
  }

  loadQuery(name: string): void {
    const trimmed = name.trim();
    const query = this.savedQueries.find((q) => q.name === trimmed);
    if (query) {
      this.activeQuery = { ...query, clauses: [...query.clauses] };
    }
  }

  private cloneData(data: Record<string, unknown>): Record<string, unknown> {
    if (typeof structuredClone === "function") {
      return structuredClone(data) as Record<string, unknown>;
    }
    return JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  }

  private cloneComponent(component: ComponentSnapshot): ComponentSnapshot {
    return {
      type_name: component.type_name,
      type_short: component.type_short,
      data: this.cloneData(component.data),
    };
  }

  private cloneEntity(entity: EntitySnapshot): EntitySnapshot {
    return {
      id: entity.id,
      archetype: [...entity.archetype],
      components: entity.components.map((component) => this.cloneComponent(component)),
    };
  }

  private deriveArchetypes(entities: EntitySnapshot[]): string[][] {
    const archetypes = new Map<string, string[]>();
    for (const entity of entities) {
      const normalized = [...entity.archetype].sort();
      const key = normalized.join("\u0000");
      if (!archetypes.has(key)) {
        archetypes.set(key, normalized);
      }
    }
    return [...archetypes.values()].sort((a, b) => a.join(",").localeCompare(b.join(",")));
  }

  private applyDelta(snapshot: WorldSnapshot, delta: TickDelta): WorldSnapshot {
    const entitiesById = new Map<number, EntitySnapshot>(
      snapshot.entities.map((entity) => [entity.id, entity]),
    );

    for (const entityId of delta.destroyed) {
      entitiesById.delete(entityId);
    }

    for (const [rawEntityId, diffs] of Object.entries(delta.modified)) {
      const entityId = Number(rawEntityId);
      const entity = entitiesById.get(entityId);
      if (!entity) continue;

      const componentsByType = new Map<string, ComponentSnapshot>(
        entity.components.map((component) => [component.type_short, component]),
      );

      let entityChanged = false;

      for (const diff of diffs) {
        if (diff.old_value === null && diff.new_value !== null) {
          componentsByType.set(diff.component_type, {
            type_name: diff.type_name,
            type_short: diff.component_type,
            data: this.cloneData(diff.new_value),
          });
          entityChanged = true;
          continue;
        }

        if (diff.new_value === null) {
          if (componentsByType.delete(diff.component_type)) {
            entityChanged = true;
          }
          continue;
        }

        const component = componentsByType.get(diff.component_type);
        const nextData = this.cloneData(diff.new_value);
        if (component) {
          componentsByType.set(diff.component_type, {
            type_name: component.type_name,
            type_short: component.type_short,
            data: nextData,
          });
        } else {
          componentsByType.set(diff.component_type, {
            type_name: diff.type_name,
            type_short: diff.component_type,
            data: nextData,
          });
        }
        entityChanged = true;
      }

      if (!entityChanged) continue;

      const components = [...componentsByType.values()];
      entitiesById.set(entityId, {
        id: entity.id,
        archetype: components
          .map((component) => component.type_short)
          .sort((a, b) => a.localeCompare(b)),
        components,
      });
    }

    for (const entity of delta.spawned) {
      entitiesById.set(entity.id, this.cloneEntity(entity));
    }

    const entities = [...entitiesById.values()];
    return {
      tick: delta.tick,
      timestamp: delta.timestamp,
      entity_count: entities.length,
      entities,
      archetypes: this.deriveArchetypes(entities),
      metadata: snapshot.metadata,
    };
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "metadata":
        this.config = msg.config;
        this.tickRange = msg.tick_range ?? this.tickRange;
        this.supportsHistory = msg.supports_history;
        this.isPaused = msg.is_paused;
        break;

      case "snapshot":
        this.updateEntityTracking(msg.snapshot);
        this.previousSnapshot = this.snapshot;
        this.snapshot = msg.snapshot;
        if (this.tickRange) {
          this.tickRange = [
            this.tickRange[0],
            Math.max(this.tickRange[1], msg.snapshot.tick),
          ];
        } else {
          this.tickRange = [msg.snapshot.tick, msg.snapshot.tick];
        }
        break;

      case "tick_update":
        if (this.snapshot) {
          this.snapshot = {
            ...this.snapshot,
            tick: msg.tick,
            entity_count: msg.entity_count,
          };
        }
        this.isPaused = msg.is_paused;
        if (this.tickRange) {
          this.tickRange = [
            this.tickRange[0],
            Math.max(this.tickRange[1], msg.tick),
          ];
        } else {
          this.tickRange = [0, msg.tick];
        }
        break;

      case "error":
        this.lastError = msg.message;
        break;

      case "error_event": {
        if (this.errors.length < 1000) {
          this.errors = [...this.errors, msg];
          break;
        }
        const nextErrors = this.errors.slice(1);
        nextErrors.push(msg);
        this.errors = nextErrors;
        break;
      }

      case "span_event": {
        if (this.spans.length < 2000) {
          this.spans = [...this.spans, msg];
          break;
        }
        const nextSpans = this.spans.slice(1);
        nextSpans.push(msg);
        this.spans = nextSpans;
        break;
      }

      case "delta":
        if (!this.snapshot) {
          console.warn("[world] received delta before initial snapshot; ignoring");
          break;
        }

        this.previousSnapshot = this.snapshot;
        this.snapshot = this.applyDelta(this.snapshot, msg.delta);
        this.updateEntityTracking(this.snapshot);
        if (this.tickRange) {
          this.tickRange = [
            this.tickRange[0],
            Math.max(this.tickRange[1], this.snapshot.tick),
          ];
        } else {
          this.tickRange = [this.snapshot.tick, this.snapshot.tick];
        }
        break;
    }
  }

  private updateEntityTracking(newSnapshot: WorldSnapshot): void {
    const prevHashes = this.entityHashes;
    const prevLoopIds = this.loopEntityIds;
    const prevUnchangedTickCounts = this.unchangedTickCounts;
    const prevEverChangedEntityIds = this.everChangedEntityIds;
    const newHashes = new Map<number, string>();
    const newIds = new Set<number>();
    const changedIds = new Set<number>();
    const nextUnchangedTickCounts = new Map<number, number>();
    const nextLoopIds = new Set<number>();
    const nextEverChangedEntityIds = new Set<number>();

    for (const entity of newSnapshot.entities) {
      const hash = entityHash(entity);
      newHashes.set(entity.id, hash);

      const prevHash = prevHashes.get(entity.id);
      if (prevHash === undefined) {
        newIds.add(entity.id);
      } else if (prevHash !== hash) {
        changedIds.add(entity.id);
      }

      const wasEverChanged = prevEverChangedEntityIds.has(entity.id);

      if (changedIds.has(entity.id)) {
        nextUnchangedTickCounts.set(entity.id, 0);
        nextEverChangedEntityIds.add(entity.id);
        continue;
      }

      if (newIds.has(entity.id)) {
        continue;
      }

      const unchangedTicks = (prevUnchangedTickCounts.get(entity.id) ?? 0) + 1;
      nextUnchangedTickCounts.set(entity.id, unchangedTicks);

      if (wasEverChanged) {
        nextEverChangedEntityIds.add(entity.id);
        if (unchangedTicks >= LOOP_DETECTION_THRESHOLD) {
          nextLoopIds.add(entity.id);
        }
      }
    }

    let shouldAutoPause = false;
    if (this.autoPauseOnLoop && nextLoopIds.size > 0) {
      for (const id of nextLoopIds) {
        if (!prevLoopIds.has(id)) {
          shouldAutoPause = true;
          break;
        }
      }
    }

    this.entityHashes = newHashes;
    this.unchangedTickCounts = nextUnchangedTickCounts;
    this.everChangedEntityIds = nextEverChangedEntityIds;
    this.newEntityIds = newIds;
    this.changedEntityIds = changedIds;
    this.loopEntityIds = nextLoopIds;

    if (shouldAutoPause && !this.isPaused) {
      queueMicrotask(() => this.pause());
    }
  }

  private getSpanUsageAtTick(tick: number): AggregatedSpanUsage {
    const timeline = this.spanUsageTimeline;
    if (timeline.length === 0 || tick < timeline[0].tick) {
      return EMPTY_SPAN_USAGE;
    }

    let low = 0;
    let high = timeline.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (timeline[mid].tick <= tick) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return high >= 0 ? timeline[high].usage : EMPTY_SPAN_USAGE;
  }

  private startReplay(speed?: number): void {
    this.stopReplay();
    this.isReplayPlaying = true;
    const effectiveSpeed = speed ?? this.currentSpeed;
    const interval = effectiveSpeed > 0 ? 1000 / effectiveSpeed : 1000;
    this.replayTimer = setInterval(() => {
      if (!this.tickRange || !this.snapshot) {
        this.stopReplay();
        return;
      }
      const next = this.snapshot.tick + 1;
      if (next > this.tickRange[1]) {
        this.stopReplay();
        return;
      }
      this.seek(next);
    }, interval);
  }

  private stopReplay(): void {
    if (this.replayTimer !== null) {
      clearInterval(this.replayTimer);
      this.replayTimer = null;
    }
    this.isReplayPlaying = false;
  }
}

export const world = new WorldState();
