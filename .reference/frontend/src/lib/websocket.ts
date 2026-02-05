/**
 * WebSocket client for AgentECS visualization server.
 *
 * Handles connection, reconnection, and message parsing.
 */

import { WS_PORT } from "./config";
import { isServerMessage, type VisualizationConfig } from "./types";

export interface ComponentSnapshot {
  type_name: string;
  type_short: string;
  data: Record<string, unknown>;
}

export interface EntitySnapshot {
  id: number;
  archetype: string[];
  components: ComponentSnapshot[];
}

export interface WorldSnapshot {
  tick: number;
  entity_count: number;
  entities: EntitySnapshot[];
  archetypes: string[][];
  metadata: Record<string, unknown>;
}

export interface TickEvent {
  type: "tick";
  snapshot: WorldSnapshot;
}

export interface ErrorEvent {
  type: "error";
  message: string;
}

export interface HistoryInfoEvent {
  type: "history_info";
  supports_replay: boolean;
  tick_range: [number, number] | null;
  is_paused: boolean;
}

export interface SeekCompleteEvent {
  type: "seek_complete";
  tick: number;
  snapshot: WorldSnapshot;
}

export interface EntityLifecyclesEvent {
  type: "entity_lifecycles";
  lifecycles: Array<{
    entity_id: number;
    spawn_tick: number;
    despawn_tick: number | null;
    archetype: string;
  }>;
  tick_range: [number, number] | null;
}

export interface ConfigEvent {
  type: "config";
  config: VisualizationConfig;
}

export type ServerMessage =
  | TickEvent
  | ErrorEvent
  | HistoryInfoEvent
  | SeekCompleteEvent
  | EntityLifecyclesEvent
  | ConfigEvent;

export interface ClientCommand {
  command:
    | "pause"
    | "resume"
    | "step"
    | "set_tick_rate"
    | "seek"
    | "get_history_info"
    | "get_entity_lifecycles";
  params?: Record<string, unknown>;
}

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface WebSocketClientOptions {
  url?: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  onMessage?: (message: ServerMessage) => void;
  onStateChange?: (state: ConnectionState) => void;
  onError?: (error: Event) => void;
}

/**
 * WebSocket client for real-time world state streaming.
 *
 * Usage:
 *   const client = new WebSocketClient({
 *     onMessage: (msg) => console.log(msg),
 *     onStateChange: (state) => console.log(state),
 *   });
 *   await client.connect();
 *   client.send({ command: "pause" });
 *   client.disconnect();
 */
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectInterval: number;
  private maxReconnectAttempts: number;
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private state: ConnectionState = "disconnected";

  private onMessage?: (message: ServerMessage) => void;
  private onStateChange?: (state: ConnectionState) => void;
  private onError?: (error: Event) => void;

  constructor(options: WebSocketClientOptions = {}) {
    this.url = options.url ?? `ws://${window.location.hostname}:${WS_PORT}/ws`;
    this.reconnectInterval = options.reconnectInterval ?? 2000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
    this.onMessage = options.onMessage;
    this.onStateChange = options.onStateChange;
    this.onError = options.onError;
  }

  /**
   * Connect to the WebSocket server.
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.setState("connecting");

      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          this.setState("connected");
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (!isServerMessage(data)) {
              console.error("Invalid message format:", data);
              this.onError?.(new Event("invalid_message"));
              return;
            }
            this.onMessage?.(data);
          } catch (e) {
            console.error("Failed to parse message:", e);
            this.onError?.(new Event("parse_error"));
          }
        };

        this.ws.onerror = (event) => {
          this.onError?.(event);
          if (this.state === "connecting") {
            reject(new Error("WebSocket connection failed"));
          }
        };

        this.ws.onclose = () => {
          this.ws = null;
          if (this.state === "connected") {
            this.setState("disconnected");
            this.scheduleReconnect();
          }
        };
      } catch (e) {
        this.setState("error");
        reject(e);
      }
    });
  }

  /**
   * Disconnect from the server.
   */
  disconnect(): void {
    this.cancelReconnect();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState("disconnected");
  }

  /**
   * Send a command to the server.
   */
  send(command: ClientCommand): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(command));
    } else {
      console.warn("WebSocket not connected, cannot send command");
    }
  }

  /**
   * Send pause command.
   */
  pause(): void {
    this.send({ command: "pause" });
  }

  /**
   * Send resume command.
   */
  resume(): void {
    this.send({ command: "resume" });
  }

  /**
   * Send step command (when paused).
   */
  step(): void {
    this.send({ command: "step" });
  }

  /**
   * Set tick rate.
   */
  setTickRate(ticksPerSecond: number): void {
    this.send({ command: "set_tick_rate", params: { ticks_per_second: ticksPerSecond } });
  }

  /**
   * Seek to a specific tick (for replay).
   */
  seek(tick: number): void {
    this.send({ command: "seek", params: { tick } });
  }

  /**
   * Request history info update.
   */
  getHistoryInfo(): void {
    this.send({ command: "get_history_info" });
  }

  /**
   * Request entity lifecycle data from history.
   */
  getEntityLifecycles(): void {
    this.send({ command: "get_entity_lifecycles" });
  }

  /**
   * Get current connection state.
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.state === "connected";
  }

  private setState(state: ConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      this.onStateChange?.(state);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setState("error");
      return;
    }

    this.reconnectAttempts++;
    this.reconnectTimeout = setTimeout(() => {
      console.log(`Reconnecting (attempt ${this.reconnectAttempts})...`);
      this.connect().catch(() => {
        // Will schedule another reconnect via onclose
      });
    }, this.reconnectInterval);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }
}

/**
 * Create a WebSocket client with default options.
 */
export function createWebSocketClient(options?: WebSocketClientOptions): WebSocketClient {
  return new WebSocketClient(options);
}
