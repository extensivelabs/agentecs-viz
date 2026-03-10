import {
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_ATTEMPTS,
  RECONNECT_MAX_DELAY_MS,
} from "./config";
import type {
  ClientCommand,
  ConnectionState,
  SnapshotResponseMessage,
  WorldSnapshot,
  ServerMessage,
} from "./types";
import { isServerMessage } from "./types";

export interface WebSocketCallbacks {
  onMessage: (msg: ServerMessage) => void;
  onStateChange: (state: ConnectionState) => void;
  onError?: (error: Event | string) => void;
}

export interface ReconnectConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RECONNECT: ReconnectConfig = {
  maxAttempts: RECONNECT_MAX_ATTEMPTS,
  baseDelayMs: RECONNECT_BASE_DELAY_MS,
  maxDelayMs: RECONNECT_MAX_DELAY_MS,
};

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private intentionalClose = false;
  private pendingSnapshotRequests = new Map<string, {
    resolve: (snapshot: WorldSnapshot) => void;
    reject: (error: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  }>();

  readonly url: string;
  private readonly callbacks: WebSocketCallbacks;
  private readonly reconnect: ReconnectConfig;

  constructor(
    url: string,
    callbacks: WebSocketCallbacks,
    reconnect: Partial<ReconnectConfig> = {},
  ) {
    this.url = url;
    this.callbacks = callbacks;
    this.reconnect = { ...DEFAULT_RECONNECT, ...reconnect };
  }

  connect(): void {
    this.intentionalClose = false;
    this.callbacks.onStateChange("connecting");

    const ws = new WebSocket(this.url);

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.callbacks.onStateChange("connected");
    };

    ws.onmessage = (event: MessageEvent) => {
      let data: unknown;
      try {
        data = JSON.parse(event.data as string);
      } catch {
        console.warn("[ws] malformed message:", event.data);
        return;
      }

      if (isServerMessage(data)) {
        if (data.type === "snapshot_response") {
          this.handleSnapshotResponse(data);
          return;
        }
        this.callbacks.onMessage(data);
        return;
      }

      if (
        typeof data === "object" &&
        data !== null &&
        typeof (data as Record<string, unknown>).type === "string"
      ) {
        console.warn("[ws] unknown message type:", (data as Record<string, unknown>).type);
      }
    };

    ws.onerror = (event: Event) => {
      this.callbacks.onError?.(event);
    };

    ws.onclose = () => {
      this.ws = null;
      this.rejectPendingSnapshotRequests(new Error("WebSocket connection closed"));
      if (this.intentionalClose) {
        this.callbacks.onStateChange("disconnected");
        return;
      }
      this.callbacks.onStateChange("error");
      this.scheduleReconnect();
    };

    this.ws = ws;
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.cancelReconnect();
    this.rejectPendingSnapshotRequests(new Error("WebSocket disconnected"));
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    } else {
      this.callbacks.onStateChange("disconnected");
    }
  }

  send(command: ClientCommand): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(command));
    }
  }

  pause(): void {
    this.send({ command: "pause" });
  }

  resume(): void {
    this.send({ command: "resume" });
  }

  step(): void {
    this.send({ command: "step" });
  }

  getSnapshot(tick: number): Promise<WorldSnapshot> {
    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (!this.pendingSnapshotRequests.has(requestId)) return;
        this.pendingSnapshotRequests.delete(requestId);
        reject(new Error(`Snapshot request timed out for tick ${tick}`));
      }, 10000);

      this.pendingSnapshotRequests.set(requestId, { resolve, reject, timeoutId });
      this.send({ command: "get_snapshot", tick, request_id: requestId });

      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        const pending = this.pendingSnapshotRequests.get(requestId);
        if (!pending) return;
        clearTimeout(pending.timeoutId);
        this.pendingSnapshotRequests.delete(requestId);
        reject(new Error("WebSocket is not connected"));
      }
    });
  }

  seek(tick: number): void {
    this.send({ command: "seek", tick });
  }

  setSpeed(ticksPerSecond: number): void {
    this.send({ command: "set_speed", ticks_per_second: ticksPerSecond });
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.reconnect.maxAttempts) return;

    const delay = Math.min(
      this.reconnect.baseDelayMs * Math.pow(2, this.reconnectAttempts),
      this.reconnect.maxDelayMs,
    );
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
  }

  private handleSnapshotResponse(message: SnapshotResponseMessage): void {
    const pending = this.pendingSnapshotRequests.get(message.request_id);
    if (!pending) {
      console.warn("[ws] unhandled snapshot response:", message.request_id);
      return;
    }

    clearTimeout(pending.timeoutId);
    this.pendingSnapshotRequests.delete(message.request_id);
    pending.resolve(message.snapshot);
  }

  private rejectPendingSnapshotRequests(error: Error): void {
    for (const pending of this.pendingSnapshotRequests.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(error);
    }
    this.pendingSnapshotRequests.clear();
  }
}

export interface WebSocketClientOptions {
  url: string;
  callbacks: WebSocketCallbacks;
  reconnect?: Partial<ReconnectConfig>;
}

export function createWebSocketClient(
  options: WebSocketClientOptions,
): WebSocketClient {
  return new WebSocketClient(
    options.url,
    options.callbacks,
    options.reconnect,
  );
}
