import {
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_ATTEMPTS,
  RECONNECT_MAX_DELAY_MS,
} from "./config";
import type {
  ClientCommand,
  ConnectionState,
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
      try {
        const data: unknown = JSON.parse(event.data as string);
        if (isServerMessage(data)) {
          this.callbacks.onMessage(data);
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onerror = (event: Event) => {
      this.callbacks.onError?.(event);
    };

    ws.onclose = () => {
      this.ws = null;
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
