// Data types (mirror snapshot.py)

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
  timestamp: number;
  entity_count: number;
  entities: EntitySnapshot[];
  archetypes: string[][];
  metadata: Record<string, unknown>;
}

export interface ComponentDiff {
  component_type: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
}

export interface TickDelta {
  tick: number;
  timestamp: number;
  spawned: EntitySnapshot[];
  destroyed: number[];
  modified: Record<number, ComponentDiff[]>;
}

// Server → Client messages (mirror protocol.py, discriminated by `type`)

export interface SnapshotMessage {
  type: "snapshot";
  tick: number;
  snapshot: WorldSnapshot;
}

export interface DeltaMessage {
  type: "delta";
  tick: number;
  delta: TickDelta;
}

export interface ErrorMessage {
  type: "error";
  tick: number;
  message: string;
}

export interface TickUpdateMessage {
  type: "tick_update";
  tick: number;
  entity_count: number;
  is_paused: boolean;
}

export type ErrorSeverity = "critical" | "warning" | "info";

export interface ErrorEventMessage {
  type: "error_event";
  tick: number;
  entity_id: number;
  message: string;
  severity: ErrorSeverity;
}

export interface MetadataMessage {
  type: "metadata";
  tick: number;
  config: VisualizationConfig | null;
  tick_range: [number, number] | null;
  supports_history: boolean;
  is_paused: boolean;
}

export type SpanStatus = "ok" | "error" | "unset";

export interface SpanEventMessage {
  type: "span_event";
  span_id: string;
  trace_id: string;
  parent_span_id: string | null;
  name: string;
  start_time: number;
  end_time: number;
  status: SpanStatus;
  attributes: Record<string, unknown>;
}

export type ServerMessage =
  | SnapshotMessage
  | DeltaMessage
  | ErrorMessage
  | ErrorEventMessage
  | SpanEventMessage
  | TickUpdateMessage
  | MetadataMessage;

// Client → Server commands (flat format, mirror protocol.py)

export type ClientCommand =
  | { command: "subscribe" }
  | { command: "pause" }
  | { command: "resume" }
  | { command: "step" }
  | { command: "seek"; tick: number }
  | { command: "set_speed"; ticks_per_second: number };

// Config types (mirror config.py)

export interface ArchetypeConfig {
  key: string;
  label?: string | null;
  color?: string | null;
  description?: string | null;
}

export interface ComponentMetricConfig {
  component: string;
  metric_field?: string | null;
  format?: string | null;
}

export interface FieldHints {
  status_fields: string[];
  error_fields: string[];
}

export interface VisualizationConfig {
  world_name?: string | null;
  archetypes: ArchetypeConfig[];
  color_palette?: string[] | null;
  component_metrics: ComponentMetricConfig[];
  field_hints: FieldHints;
  chat_enabled: boolean;
  entity_label_template?: string | null;
}

// Connection state

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

// Type guard

const SERVER_MESSAGE_TYPES = new Set([
  "snapshot",
  "delta",
  "error",
  "error_event",
  "span_event",
  "tick_update",
  "metadata",
]);

export function isServerMessage(data: unknown): data is ServerMessage {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return typeof obj.type === "string" && SERVER_MESSAGE_TYPES.has(obj.type);
}
