/**
 * World state store using Svelte 5 runes.
 *
 * Provides reactive state for the world visualization.
 */

import {
  createWebSocketClient,
  type ConnectionState,
  type EntityLifecyclesEvent,
  type EntitySnapshot,
  type ServerMessage,
  type WebSocketClient,
  type WorldSnapshot,
} from "./websocket";
import type { VisualizationConfig, ArchetypeConfig } from "./types";
import { getArchetypeKey, entityHash } from "./utils";

/**
 * Entity lifecycle data from backend history.
 */
export interface EntityLifecycle {
  entityId: number;
  spawnTick: number;
  despawnTick: number | null;
  archetype: string;
}

/**
 * Playback mode for the visualization.
 */
export type PlaybackMode = "live" | "recording" | "paused" | "paused_history" | "replay";

/**
 * World state managed with Svelte 5 runes.
 */
class WorldState {
  // Connection state
  connectionState = $state<ConnectionState>("disconnected");

  // World data
  snapshot = $state<WorldSnapshot | null>(null);
  lastError = $state<string | null>(null);

  // Playback state
  isPaused = $state(false);
  isReplayPlaying = $state(false);

  // Replay timer handle
  private replayTimer: ReturnType<typeof setInterval> | null = null;

  // Temporal/history state
  supportsReplay = $state(false);
  tickRange = $state<[number, number] | null>(null);

  // Entity lifecycle data from backend history
  entityLifecycles = $state<EntityLifecycle[]>([]);
  lifecycleTickRange = $state<[number, number] | null>(null);

  // Entity change tracking
  newEntityIds = $state<Set<number>>(new Set());
  changedEntityIds = $state<Set<number>>(new Set());

  // Selected entity for detail view
  selectedEntityId = $state<number | null>(null);

  // Archetype filter for Petri Dish
  archetypeFilter = $state<string[] | null>(null);

  // Visualization config from server
  config = $state<VisualizationConfig | null>(null);

  // Derived config helpers
  archetypeConfigMap = $derived(
    new Map<string, ArchetypeConfig>(this.config?.archetypes.map((a) => [a.key, a]) ?? [])
  );
  chatEnabled = $derived(this.config?.chat_enabled ?? true);
  worldName = $derived(this.config?.world_name ?? "AgentECS World");

  // Derived values
  tick = $derived(this.snapshot?.tick ?? 0);
  entityCount = $derived(this.snapshot?.entity_count ?? 0);
  entities = $derived(this.snapshot?.entities ?? []);
  archetypes = $derived(this.snapshot?.archetypes ?? []);
  isConnected = $derived(this.connectionState === "connected");
  selectedEntity = $derived(
    this.selectedEntityId !== null ? this.getEntity(this.selectedEntityId) : null
  );

  // Filtered entities for Petri Dish (respects archetypeFilter)
  archetypeFilterKey = $derived(
    this.archetypeFilter ? getArchetypeKey(this.archetypeFilter) : null
  );
  filteredEntities = $derived(
    this.archetypeFilterKey
      ? this.entities.filter((e) => getArchetypeKey(e.archetype) === this.archetypeFilterKey)
      : this.entities
  );

  // Playback mode derived from state
  playbackMode = $derived.by<PlaybackMode>(() => {
    if (!this.supportsReplay) {
      return this.isPaused ? "paused" : "live";
    }
    // Playing through history
    if (this.isReplayPlaying) {
      return "replay";
    }
    // Live simulation running
    if (!this.isPaused) {
      return "recording";
    }
    // Paused - distinguish between live edge and history
    if (this.tick < this.maxTick) {
      return "paused_history"; // Paused while viewing history (blue)
    }
    return "paused"; // Paused at live edge (yellow)
  });

  // Whether timeline scrubbing is available
  canScrub = $derived(this.supportsReplay && this.tickRange !== null);

  // Min/max tick for timeline (maxTick always includes current tick for live following)
  minTick = $derived(this.tickRange?.[0] ?? 0);
  maxTick = $derived(Math.max(this.tickRange?.[1] ?? 0, this.tick));

  // Whether we're at the live edge (not viewing history)
  isAtLive = $derived(this.tick >= this.maxTick);

  // WebSocket client
  private client: WebSocketClient | null = null;
  private previousEntityMap: Map<number, string> = new Map();

  /**
   * Connect to the visualization server.
   */
  async connect(url?: string): Promise<void> {
    if (this.client) {
      this.client.disconnect();
    }

    this.client = createWebSocketClient({
      url,
      onMessage: (msg) => this.handleMessage(msg),
      onStateChange: (state) => {
        this.connectionState = state;
      },
      onError: () => {
        this.lastError = "Connection error";
      },
    });

    await this.client.connect();
  }

  /**
   * Disconnect from the server.
   */
  disconnect(): void {
    this.stopReplay();
    this.client?.disconnect();
    this.client = null;
    this.snapshot = null;
    this.isPaused = false;
    this.supportsReplay = false;
    this.tickRange = null;
  }

  /**
   * Pause world execution.
   */
  pause(): void {
    this.stopReplay();
    this.client?.pause();
    this.isPaused = true;
  }

  /**
   * Resume world execution.
   */
  resume(): void {
    this.client?.resume();
    this.isPaused = false;
  }

  /**
   * Toggle pause state.
   */
  togglePause(): void {
    if (this.isPaused && !this.isReplayPlaying) {
      this.play();
    } else {
      this.pause();
    }
  }

  /**
   * Context-aware play: at live edge resumes simulation, in history starts replay.
   */
  play(): void {
    if (this.isAtLive) {
      this.resume();
    } else {
      this.startReplay();
    }
  }

  /**
   * Start playing through recorded history.
   */
  private startReplay(): void {
    if (this.replayTimer) return;
    this.isReplayPlaying = true;

    // Play at ~10 ticks/second (100ms interval)
    this.replayTimer = setInterval(() => {
      const nextTick = this.tick + 1;
      if (nextTick > this.maxTick) {
        // Reached live edge - stop replay, stay paused
        this.stopReplay();
      } else {
        this.seek(nextTick);
      }
    }, 100);
  }

  /**
   * Stop replay playback.
   */
  private stopReplay(): void {
    if (this.replayTimer) {
      clearInterval(this.replayTimer);
      this.replayTimer = null;
    }
    this.isReplayPlaying = false;
  }

  /**
   * Go to live edge and resume simulation.
   */
  goToLive(): void {
    this.stopReplay();
    this.seek(this.maxTick);
    // Small delay to let seek complete, then resume
    setTimeout(() => this.resume(), 50);
  }

  /**
   * Step forward one tick. Context-aware: at live edge steps simulation, in history steps through recorded ticks.
   * If replaying, pauses after the step.
   */
  step(): void {
    if (!this.isPaused && !this.isReplayPlaying) return;

    // Stop replay if active (step should pause)
    if (this.isReplayPlaying) {
      this.stopReplay();
    }

    if (this.isAtLive) {
      // At live edge - step the simulation
      this.client?.step();
    } else {
      // In history - step through recorded ticks
      const nextTick = this.tick + 1;
      if (nextTick <= this.maxTick) {
        this.seek(nextTick);
      }
    }
  }

  /**
   * Set tick rate.
   */
  setTickRate(ticksPerSecond: number): void {
    this.client?.setTickRate(ticksPerSecond);
  }

  /**
   * Seek to a specific tick (for replay).
   */
  seek(tick: number): void {
    this.client?.seek(tick);
  }

  /**
   * Request updated history info.
   */
  getHistoryInfo(): void {
    this.client?.getHistoryInfo();
  }

  /**
   * Request entity lifecycle data from backend history.
   */
  requestEntityLifecycles(): void {
    this.client?.getEntityLifecycles();
  }

  /**
   * Get entity by ID.
   */
  getEntity(id: number): EntitySnapshot | undefined {
    return this.entities.find((e) => e.id === id);
  }

  /**
   * Get entities by archetype.
   */
  getEntitiesByArchetype(archetype: string[]): EntitySnapshot[] {
    const archetypeKey = getArchetypeKey(archetype);
    return this.entities.filter((e) => getArchetypeKey(e.archetype) === archetypeKey);
  }

  /**
   * Select an entity to view details.
   */
  selectEntity(id: number | null): void {
    this.selectedEntityId = id;
  }

  /**
   * Set archetype filter for Petri Dish.
   * Pass null to clear the filter.
   */
  setArchetypeFilter(archetype: string[] | null): void {
    this.archetypeFilter = archetype;
  }

  /**
   * Clear archetype filter.
   */
  clearArchetypeFilter(): void {
    this.archetypeFilter = null;
  }

  /**
   * Check if an entity is new (spawned this tick).
   */
  isNewEntity(id: number): boolean {
    return this.newEntityIds.has(id);
  }

  /**
   * Check if an entity changed this tick.
   */
  isChangedEntity(id: number): boolean {
    return this.changedEntityIds.has(id);
  }

  private handleMessage(message: ServerMessage): void {
    if (message.type === "tick") {
      this.updateEntityTracking(message.snapshot.entities);
      this.snapshot = message.snapshot;
      this.lastError = null;
    } else if (message.type === "config") {
      this.config = message.config;
    } else if (message.type === "history_info") {
      this.supportsReplay = message.supports_replay;
      this.tickRange = message.tick_range;
      this.isPaused = message.is_paused;
    } else if (message.type === "seek_complete") {
      this.updateEntityTracking(message.snapshot.entities);
      this.snapshot = message.snapshot;
      this.lastError = null;
    } else if (message.type === "error") {
      this.lastError = message.message;
    } else if (message.type === "entity_lifecycles") {
      this.handleEntityLifecycles(message);
    }
  }

  private handleEntityLifecycles(message: EntityLifecyclesEvent): void {
    // Convert backend format to frontend format
    this.entityLifecycles = message.lifecycles.map((lc) => ({
      entityId: lc.entity_id,
      spawnTick: lc.spawn_tick,
      despawnTick: lc.despawn_tick,
      archetype: lc.archetype,
    }));
    this.lifecycleTickRange = message.tick_range;
  }

  private updateEntityTracking(entities: EntitySnapshot[]): void {
    const newIds = new Set<number>();
    const changedIds = new Set<number>();
    const currentEntityMap = new Map<number, string>();

    for (const entity of entities) {
      // Use efficient structural hash instead of JSON.stringify
      const stateHash = entityHash(entity);
      currentEntityMap.set(entity.id, stateHash);

      const previousHash = this.previousEntityMap.get(entity.id);
      if (previousHash === undefined) {
        // New entity
        newIds.add(entity.id);
      } else if (previousHash !== stateHash) {
        // Changed entity
        changedIds.add(entity.id);
      }
    }

    this.newEntityIds = newIds;
    this.changedEntityIds = changedIds;
    this.previousEntityMap = currentEntityMap;
  }
}

/**
 * Singleton world state instance.
 */
export const world = new WorldState();
