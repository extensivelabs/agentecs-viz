import { TOKEN_COST_BUDGET_USD, WS_URL } from "../config";
import { diffEntity, type EntityDiff } from "../diff";
import {
  getAvailableComponents,
  matchingEntityIds,
  type QueryDef,
} from "../query";
import { aggregateSpanUsage, type ModelUsageTotals, type SpanUsageTotals } from "../traces";
import type {
  ArchetypeConfig,
  ConnectionState,
  EntitySnapshot,
  ErrorEventMessage,
  ServerMessage,
  SpanEventMessage,
  VisualizationConfig,
  WorldSnapshot,
} from "../types";
import { entityHash } from "../utils";
import { WebSocketClient } from "../websocket";

export type PlaybackMode = "live" | "paused" | "history" | "replay";

export class WorldState {
  connectionState: ConnectionState = $state("disconnected");
  snapshot: WorldSnapshot | null = $state(null);
  lastError: string | null = $state(null);
  isPaused: boolean = $state(false);
  isReplayPlaying: boolean = $state(false);
  supportsHistory: boolean = $state(false);
  tickRange: [number, number] | null = $state(null);
  config: VisualizationConfig | null = $state(null);
  selectedEntityId: number | null = $state(null);

  newEntityIds: Set<number> = $state(new Set());
  changedEntityIds: Set<number> = $state(new Set());

  errors: ErrorEventMessage[] = $state([]);
  errorPanelOpen: boolean = $state(false);

  spans: SpanEventMessage[] = $state([]);
  selectedSpanId: string | null = $state(null);

  activeQuery: QueryDef | null = $state(null);
  savedQueries: QueryDef[] = $state([]);

  previousSnapshot: WorldSnapshot | null = $state(null);
  pinnedEntityState: Map<number, EntitySnapshot> | null = $state(null);
  pinnedTick: number | null = $state(null);

  private client: WebSocketClient | null = null;
  private entityHashes = new Map<number, string>();
  private replayTimer: ReturnType<typeof setInterval> | null = null;
  private currentSpeed: number = 1;

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
    this.errors.filter((e) => e.tick === this.tick),
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

  spanUsage: { totals: SpanUsageTotals; byModel: ModelUsageTotals[] } = $derived(
    aggregateSpanUsage(this.visibleSpans),
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

  availableComponents: string[] = $derived(
    getAvailableComponents(this.entities),
  );

  matchingEntityIds: Set<number> = $derived(
    this.activeQuery && this.activeQuery.clauses.length > 0
      ? matchingEntityIds(this.entities, this.activeQuery)
      : new Set<number>(),
  );

  hasActiveFilter: boolean = $derived(
    this.activeQuery !== null && this.activeQuery.clauses.length > 0,
  );

  matchCount: number = $derived(this.matchingEntityIds.size);

  selectedEntityDiff: EntityDiff | null = $derived.by(() => {
    if (!this.selectedEntity || !this.previousSnapshot) return null;
    const prev = this.previousSnapshot.entities.find(
      (e) => e.id === this.selectedEntityId,
    );
    if (!prev) return null;
    const diff = diffEntity(prev, this.selectedEntity);
    return diff.totalChanges > 0 ? diff : null;
  });

  entityDiffCounts: Map<number, number> = $derived.by(() => {
    const counts = new Map<number, number>();
    if (!this.previousSnapshot) return counts;
    const prevMap = new Map(
      this.previousSnapshot.entities.map((e) => [e.id, e]),
    );
    const curMap = new Map(this.entities.map((e) => [e.id, e]));
    for (const id of this.changedEntityIds) {
      const prev = prevMap.get(id);
      const cur = curMap.get(id);
      if (prev && cur) {
        const diff = diffEntity(prev, cur);
        if (diff.totalChanges > 0) {
          counts.set(id, diff.totalChanges);
        }
      }
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
    this.newEntityIds = new Set();
    this.changedEntityIds = new Set();
    this.selectedEntityId = null;
    this.errors = [];
    this.errorPanelOpen = false;
    this.spans = [];
    this.selectedSpanId = null;
    this.activeQuery = null;
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
    if (!this.isPaused) {
      this.pause();
    }
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
      this.pause();
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

  clearQuery(): void {
    this.activeQuery = null;
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
        if (!this.tickRange) {
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
        const updated = [...this.errors, msg];
        this.errors = updated.length > 1000 ? updated.slice(-1000) : updated;
        break;
      }

      case "span_event": {
        const updatedSpans = [...this.spans, msg];
        this.spans =
          updatedSpans.length > 2000 ? updatedSpans.slice(-2000) : updatedSpans;
        break;
      }

      case "delta":
        console.warn("[world] delta message received but not yet implemented");
        break;
    }
  }

  private updateEntityTracking(newSnapshot: WorldSnapshot): void {
    const prevHashes = this.entityHashes;
    const newHashes = new Map<number, string>();
    const newIds = new Set<number>();
    const changedIds = new Set<number>();

    for (const entity of newSnapshot.entities) {
      const hash = entityHash(entity);
      newHashes.set(entity.id, hash);

      const prevHash = prevHashes.get(entity.id);
      if (prevHash === undefined) {
        newIds.add(entity.id);
      } else if (prevHash !== hash) {
        changedIds.add(entity.id);
      }
    }

    this.entityHashes = newHashes;
    this.newEntityIds = newIds;
    this.changedEntityIds = changedIds;
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
