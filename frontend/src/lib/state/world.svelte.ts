import { WS_URL } from "../config";
import type {
  ConnectionState,
  EntitySnapshot,
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

  connect(url?: string): void {
    if (this.client) this.disconnect();

    this.client = new WebSocketClient(url ?? WS_URL, {
      onMessage: (msg) => this.handleMessage(msg),
      onStateChange: (state) => {
        this.connectionState = state;
        if (state === "disconnected" || state === "error") {
          this.snapshot = null;
          this.config = null;
          this.tickRange = null;
          this.supportsHistory = false;
          this.entityHashes.clear();
          this.newEntityIds.clear();
          this.changedEntityIds.clear();
          this.selectedEntityId = null;
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

  play(): void {
    if (!this.supportsHistory || !this.tickRange) return;
    this.startReplay();
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

      case "delta":
        // Delta application deferred to REQ-006/007
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

  private startReplay(): void {
    this.stopReplay();
    this.isReplayPlaying = true;
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
    }, 1000);
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
