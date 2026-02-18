import type {
  EntitySnapshot,
  ErrorEventMessage,
  ErrorSeverity,
  WorldSnapshot,
  VisualizationConfig,
} from "../lib/types";
import { world } from "../lib/state/world.svelte";


type ComponentInput = {
  type_short: string;
  data: Record<string, unknown>;
};

export class MockWebSocket {
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

  simulateRawMessage(raw: string): void {
    this.onmessage?.(new MessageEvent("message", { data: raw }));
  }

  simulateError(): void {
    this.onerror?.(new Event("error"));
  }

  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close"));
  }
}


export function makeEntity(
  id: number,
  archetypeOrComponents: string[] | ComponentInput[],
  explicitComponents?: ComponentInput[],
): EntitySnapshot {
  if (
    archetypeOrComponents.length > 0 &&
    typeof archetypeOrComponents[0] === "object"
  ) {
    const comps = archetypeOrComponents as ComponentInput[];
    return {
      id,
      archetype: comps.map((c) => c.type_short),
      components: comps.map((c) => ({
        type_name: `mod.${c.type_short}`,
        type_short: c.type_short,
        data: c.data,
      })),
    };
  }

  const archetype = archetypeOrComponents as string[];
  const components = explicitComponents
    ? explicitComponents.map((c) => ({
        type_name: `mod.${c.type_short}`,
        type_short: c.type_short,
        data: c.data,
      }))
    : archetype.map((a) => ({
        type_name: `mod.${a}`,
        type_short: a,
        data: {},
      }));

  return { id, archetype, components };
}


export function makeSnapshot(
  overrides: Partial<WorldSnapshot> = {},
): WorldSnapshot {
  return {
    tick: 1,
    timestamp: 1000,
    entity_count: 2,
    entities: [
      {
        id: 1,
        archetype: ["Agent", "Position"],
        components: [
          { type_name: "Agent", type_short: "Agent", data: { name: "a1" } },
          {
            type_name: "Position",
            type_short: "Position",
            data: { x: 0, y: 0 },
          },
        ],
      },
      {
        id: 2,
        archetype: ["Task"],
        components: [
          {
            type_name: "Task",
            type_short: "Task",
            data: { status: "active" },
          },
        ],
      },
    ],
    archetypes: [["Agent", "Position"], ["Task"]],
    metadata: {},
    ...overrides,
  };
}


export function makeConfig(
  overrides: Partial<VisualizationConfig> = {},
): VisualizationConfig {
  return {
    world_name: "Test World",
    archetypes: [],
    color_palette: null,
    component_metrics: [],
    field_hints: { status_fields: ["status"], error_fields: ["error"] },
    chat_enabled: true,
    entity_label_template: null,
    ...overrides,
  };
}


export function makeErrorEvent(
  tick: number,
  entity_id: number,
  message: string = "test error",
  severity: ErrorSeverity = "warning",
): ErrorEventMessage {
  return { type: "error_event", tick, entity_id, message, severity };
}


export function setWorldState(
  entities: EntitySnapshot[],
  config?: Partial<VisualizationConfig>,
): void {
  const snapshot: WorldSnapshot = {
    tick: 1,
    timestamp: Date.now() / 1000,
    entity_count: entities.length,
    entities,
    archetypes: [],
    metadata: {},
  };
  world.snapshot = snapshot as WorldSnapshot;
  world.config = {
    world_name: "Test",
    archetypes: [],
    component_metrics: [],
    field_hints: { status_fields: [], error_fields: [] },
    chat_enabled: false,
    entity_label_template: null,
    color_palette: null,
    ...config,
  } as VisualizationConfig;
}
