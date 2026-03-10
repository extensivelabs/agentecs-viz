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
  type_name: string;
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

export interface SnapshotMessage {
  type: "snapshot";
  tick: number;
  snapshot: WorldSnapshot;
}

export interface SnapshotResponseMessage {
  type: "snapshot_response";
  request_id: string;
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
  | SnapshotResponseMessage
  | DeltaMessage
  | ErrorMessage
  | ErrorEventMessage
  | SpanEventMessage
  | TickUpdateMessage
  | MetadataMessage;

export type ClientCommand =
  | { command: "subscribe" }
  | { command: "pause" }
  | { command: "resume" }
  | { command: "step" }
  | { command: "get_snapshot"; tick: number; request_id: string }
  | { command: "seek"; tick: number }
  | { command: "set_speed"; ticks_per_second: number };

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

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isTickRange(value: unknown): value is [number, number] {
  return (
    Array.isArray(value)
    && value.length === 2
    && isNumber(value[0])
    && isNumber(value[1])
  );
}

function isSpanStatus(value: unknown): value is SpanStatus {
  return value === "ok" || value === "error" || value === "unset";
}

function isErrorSeverity(value: unknown): value is ErrorSeverity {
  return value === "critical" || value === "warning" || value === "info";
}

function isComponentSnapshot(value: unknown): value is ComponentSnapshot {
  return (
    isRecord(value)
    && isString(value.type_name)
    && isString(value.type_short)
    && isRecord(value.data)
  );
}

function isEntitySnapshot(value: unknown): value is EntitySnapshot {
  return (
    isRecord(value)
    && isNumber(value.id)
    && Array.isArray(value.archetype)
    && value.archetype.every(isString)
    && Array.isArray(value.components)
    && value.components.every(isComponentSnapshot)
  );
}

function isWorldSnapshot(value: unknown): value is WorldSnapshot {
  return (
    isRecord(value)
    && isNumber(value.tick)
    && isNumber(value.timestamp)
    && isNumber(value.entity_count)
    && Array.isArray(value.entities)
    && value.entities.every(isEntitySnapshot)
    && Array.isArray(value.archetypes)
    && value.archetypes.every(
      (archetype): archetype is string[] => Array.isArray(archetype) && archetype.every(isString),
    )
    && isRecord(value.metadata)
  );
}

function isComponentDiff(value: unknown): value is ComponentDiff {
  return (
    isRecord(value)
    && isString(value.component_type)
    && isString(value.type_name)
    && (value.old_value === null || isRecord(value.old_value))
    && (value.new_value === null || isRecord(value.new_value))
  );
}

function isModifiedDiffMap(value: unknown): value is Record<number, ComponentDiff[]> {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([entityId, diffs]) => Number.isInteger(Number(entityId))
      && Array.isArray(diffs)
      && diffs.every(isComponentDiff),
  );
}

function isTickDelta(value: unknown): value is TickDelta {
  return (
    isRecord(value)
    && isNumber(value.tick)
    && isNumber(value.timestamp)
    && Array.isArray(value.spawned)
    && value.spawned.every(isEntitySnapshot)
    && Array.isArray(value.destroyed)
    && value.destroyed.every(isNumber)
    && isModifiedDiffMap(value.modified)
  );
}

export function isServerMessage(data: unknown): data is ServerMessage {
  if (!isRecord(data) || !isString(data.type)) return false;

  switch (data.type) {
    case "snapshot":
      return isNumber(data.tick) && isWorldSnapshot(data.snapshot);
    case "snapshot_response":
      return isString(data.request_id) && isNumber(data.tick) && isWorldSnapshot(data.snapshot);
    case "delta":
      return isNumber(data.tick) && isTickDelta(data.delta);
    case "error":
      return isNumber(data.tick) && isString(data.message);
    case "error_event":
      return (
        isNumber(data.tick)
        && isNumber(data.entity_id)
        && isString(data.message)
        && isErrorSeverity(data.severity)
      );
    case "span_event":
      return (
        isString(data.span_id)
        && isString(data.trace_id)
        && (data.parent_span_id === null || isString(data.parent_span_id))
        && isString(data.name)
        && isNumber(data.start_time)
        && isNumber(data.end_time)
        && isSpanStatus(data.status)
        && isRecord(data.attributes)
      );
    case "tick_update":
      return (
        isNumber(data.tick)
        && isNumber(data.entity_count)
        && isBoolean(data.is_paused)
      );
    case "metadata":
      return (
        isNumber(data.tick)
        && (data.config === null || isRecord(data.config))
        && (data.tick_range === null || isTickRange(data.tick_range))
        && isBoolean(data.supports_history)
        && isBoolean(data.is_paused)
      );
    default:
      return false;
  }
}
