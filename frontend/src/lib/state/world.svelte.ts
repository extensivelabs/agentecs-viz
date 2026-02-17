import { WS_URL } from "../config";
import { diffEntity, type EntityDiff } from "../diff";
import type {
  ArchetypeConfig,
  ConnectionState,
  EntitySnapshot,
  ErrorEventMessage,
  ServerMessage,
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

  previousSnapshot: WorldSnapshot | null = $state(null);
  pinnedEntityState: Map<number, EntitySnapshot> | null = $state(null);
  pinnedTick: number | null = $state(null);

  private client: WebSocketClient | null = null;
  private entityHashes = new Map<number, string>();
  private replayTimer: ReturnType<typeof setInterval> | null = null;

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

    this.client = new WebSocketClient(url ?? WS_URL, {
      onMessage: (msg) => this.handleMessage(msg),
      onStateChange: (state) => {
        this.connectionState = state;
        if (state === "disconnected" || state === "error") {
          this.snapshot = null;
          this.previousSnapshot = null;
          this.pinnedEntityState = null;
          this.pinnedTick = null;
          this.config = null;
          this.tickRange = null;
          this.supportsHistory = false;
          this.entityHashes.clear();
          this.newEntityIds.clear();
          this.changedEntityIds.clear();
          this.selectedEntityId = null;
          this.errors = [];
          this.errorPanelOpen = false;
        }
      },
      onError: (err) => {
        this.lastError =
          err instanceof Event ? "Connection error" : String(err);
      },
    });
    this.client.connect();
  }

  disconnect(): void {
    this.stopReplay();
    this.client?.disconnect();
    this.client = null;
  }

  pause(): void {
    this.client?.pause();
  }

  resume(): void {
    this.client?.resume();
  }

  togglePause(): void {
    if (this.isPaused) {
      this.resume();
    } else {
      this.pause();
    }
  }

  step(): void {
    this.client?.step();
  }

  stepBack(): void {
    if (!this.canScrub || this.tick <= this.minTick) return;
    this.seek(this.tick - 1);
  }

  goToLive(): void {
    if (this.tickRange) {
      this.seek(this.tickRange[1]);
    }
    this.resume();
  }

  seek(tick: number): void {
    this.client?.seek(tick);
  }

  setSpeed(ticksPerSecond: number): void {
    this.client?.setSpeed(ticksPerSecond);
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

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "metadata":
        this.config = msg.config;
        this.tickRange = msg.tick_range;
        this.supportsHistory = msg.supports_history;
        this.isPaused = msg.is_paused;
        break;

      case "snapshot":
        this.updateEntityTracking(msg.snapshot);
        this.previousSnapshot = this.snapshot;
        this.snapshot = msg.snapshot;
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

      case "delta":
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
    const interval = speed ? 1000 / speed : 1000;
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
