import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocketClient, createWebSocketClient } from "../lib/websocket";
import type { WebSocketCallbacks } from "../lib/websocket";
import type { ConnectionState, ServerMessage } from "../lib/types";

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close"));
  }

  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  simulateMessage(data: unknown): void {
    this.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(data) }),
    );
  }

  simulateError(): void {
    this.onerror?.(new Event("error"));
  }

  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close"));
  }
}

function setupCallbacks() {
  const states: ConnectionState[] = [];
  const messages: ServerMessage[] = [];
  const errors: (Event | string)[] = [];
  const callbacks: WebSocketCallbacks = {
    onMessage: (msg) => messages.push(msg),
    onStateChange: (state) => states.push(state),
    onError: (err) => errors.push(err),
  };
  return { states, messages, errors, callbacks };
}

describe("WebSocketClient", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("creates via factory function", () => {
    const { callbacks } = setupCallbacks();
    const client = createWebSocketClient({
      url: "ws://test/ws",
      callbacks,
    });
    expect(client).toBeInstanceOf(WebSocketClient);
    expect(client.url).toBe("ws://test/ws");
  });

  it("transitions to connecting then connected on open", () => {
    const { states, callbacks } = setupCallbacks();
    const client = new WebSocketClient("ws://test/ws", callbacks);

    client.connect();
    expect(states).toEqual(["connecting"]);

    MockWebSocket.instances[0].simulateOpen();
    expect(states).toEqual(["connecting", "connected"]);
    expect(client.isConnected).toBe(true);
  });

  it("transitions to disconnected on intentional close", () => {
    const { states, callbacks } = setupCallbacks();
    const client = new WebSocketClient("ws://test/ws", callbacks);

    client.connect();
    MockWebSocket.instances[0].simulateOpen();

    client.disconnect();
    expect(states).toEqual(["connecting", "connected", "disconnected"]);
    expect(client.isConnected).toBe(false);
  });

  it("dispatches valid server messages", () => {
    const { messages, callbacks } = setupCallbacks();
    const client = new WebSocketClient("ws://test/ws", callbacks);

    client.connect();
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    const msg = {
      type: "tick_update",
      tick: 5,
      entity_count: 10,
      is_paused: false,
    };
    ws.simulateMessage(msg);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(msg);
  });

  it("ignores invalid messages", () => {
    const { messages, callbacks } = setupCallbacks();
    const client = new WebSocketClient("ws://test/ws", callbacks);

    client.connect();
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    ws.simulateMessage({ invalid: true });
    ws.simulateMessage({ type: "unknown_type" });

    expect(messages).toHaveLength(0);
  });

  it("sends flat command format", () => {
    const { callbacks } = setupCallbacks();
    const client = new WebSocketClient("ws://test/ws", callbacks);

    client.connect();
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    client.seek(42);
    expect(JSON.parse(ws.sentMessages[0])).toEqual({
      command: "seek",
      tick: 42,
    });

    client.pause();
    expect(JSON.parse(ws.sentMessages[1])).toEqual({ command: "pause" });

    client.resume();
    expect(JSON.parse(ws.sentMessages[2])).toEqual({ command: "resume" });

    client.step();
    expect(JSON.parse(ws.sentMessages[3])).toEqual({ command: "step" });

    client.setSpeed(5);
    expect(JSON.parse(ws.sentMessages[4])).toEqual({
      command: "set_speed",
      ticks_per_second: 5,
    });
  });

  it("does not send when not connected", () => {
    const { callbacks } = setupCallbacks();
    const client = new WebSocketClient("ws://test/ws", callbacks);

    client.pause();
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("attempts reconnect on unexpected close", () => {
    const { states, callbacks } = setupCallbacks();
    const client = new WebSocketClient("ws://test/ws", callbacks, {
      maxAttempts: 3,
      baseDelayMs: 100,
    });

    client.connect();
    MockWebSocket.instances[0].simulateOpen();
    MockWebSocket.instances[0].simulateClose();

    expect(states).toEqual(["connecting", "connected", "error"]);
    expect(MockWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(100);
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(states).toEqual(["connecting", "connected", "error", "connecting"]);
  });

  it("uses exponential backoff for reconnect", () => {
    const { callbacks } = setupCallbacks();
    const client = new WebSocketClient("ws://test/ws", callbacks, {
      maxAttempts: 5,
      baseDelayMs: 100,
      maxDelayMs: 10000,
    });

    client.connect();
    MockWebSocket.instances[0].simulateClose();

    // First reconnect: 100ms
    vi.advanceTimersByTime(99);
    expect(MockWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(2);

    // Second reconnect: 200ms
    MockWebSocket.instances[1].simulateClose();
    vi.advanceTimersByTime(199);
    expect(MockWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it("stops reconnecting after max attempts", () => {
    const { callbacks } = setupCallbacks();
    const client = new WebSocketClient("ws://test/ws", callbacks, {
      maxAttempts: 2,
      baseDelayMs: 100,
    });

    client.connect();
    MockWebSocket.instances[0].simulateClose();
    vi.advanceTimersByTime(100);
    MockWebSocket.instances[1].simulateClose();
    vi.advanceTimersByTime(200);

    // 1 original + 2 reconnect attempts = 3 total instances
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it("cancels reconnect on disconnect", () => {
    const { callbacks } = setupCallbacks();
    const client = new WebSocketClient("ws://test/ws", callbacks, {
      maxAttempts: 5,
      baseDelayMs: 100,
    });

    client.connect();
    MockWebSocket.instances[0].simulateOpen();
    MockWebSocket.instances[0].simulateClose();

    client.disconnect();
    vi.advanceTimersByTime(10000);

    // Only the initial + intentional close, no reconnects
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
