/**
 * Runtime type guards for validating data from the server.
 */

import type { ServerMessage, WorldSnapshot, EntitySnapshot, ComponentSnapshot } from "./websocket";

// TaskData structure from task_dispatch example
export interface TaskData {
  id: string;
  description: string;
  status: "unassigned" | "in_progress" | "waiting_for_input" | "completed";
  result: string | null;
  user_query: string | null;
  user_response: string | null;
}

// AgentStateData structure
export interface AgentStateData {
  system_prompt: string;
  conversation_history: Array<{ role: string; content: string }>;
  iteration_count: number;
}

// Entity lifecycle data from backend
export interface EntityLifecycleData {
  entity_id: number;
  spawn_tick: number;
  despawn_tick: number | null;
  archetype: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isComponentSnapshot(value: unknown): value is ComponentSnapshot {
  if (!isRecord(value)) return false;
  return (
    typeof value.type_name === "string" &&
    typeof value.type_short === "string" &&
    isRecord(value.data)
  );
}

export function isEntitySnapshot(value: unknown): value is EntitySnapshot {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "number" &&
    Array.isArray(value.archetype) &&
    value.archetype.every((a: unknown) => typeof a === "string") &&
    Array.isArray(value.components) &&
    value.components.every(isComponentSnapshot)
  );
}

export function isWorldSnapshot(value: unknown): value is WorldSnapshot {
  if (!isRecord(value)) return false;
  return (
    typeof value.tick === "number" &&
    typeof value.entity_count === "number" &&
    Array.isArray(value.entities) &&
    value.entities.every(isEntitySnapshot)
  );
}

export function isServerMessage(value: unknown): value is ServerMessage {
  if (!isRecord(value)) return false;
  const type = value.type;

  switch (type) {
    case "tick":
      return isWorldSnapshot(value.snapshot);
    case "error":
      return typeof value.message === "string";
    case "config":
      return isVisualizationConfig(value.config);
    case "history_info":
      return (
        typeof value.supports_replay === "boolean" &&
        (value.tick_range === null ||
          (Array.isArray(value.tick_range) &&
            value.tick_range.length === 2 &&
            typeof value.tick_range[0] === "number" &&
            typeof value.tick_range[1] === "number")) &&
        typeof value.is_paused === "boolean"
      );
    case "seek_complete":
      return typeof value.tick === "number" && isWorldSnapshot(value.snapshot);
    case "entity_lifecycles":
      return (
        Array.isArray(value.lifecycles) &&
        value.lifecycles.every(isEntityLifecycleData) &&
        (value.tick_range === null ||
          (Array.isArray(value.tick_range) &&
            value.tick_range.length === 2 &&
            typeof value.tick_range[0] === "number" &&
            typeof value.tick_range[1] === "number"))
      );
    default:
      return false;
  }
}

const VALID_TASK_STATUSES = ["unassigned", "in_progress", "waiting_for_input", "completed"] as const;

export function isTaskData(value: unknown): value is TaskData {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.description === "string" &&
    typeof value.status === "string" &&
    VALID_TASK_STATUSES.includes(value.status as TaskData["status"]) &&
    (value.result === null || typeof value.result === "string") &&
    (value.user_query === null || typeof value.user_query === "string") &&
    (value.user_response === null || typeof value.user_response === "string")
  );
}

export function isAgentStateData(value: unknown): value is AgentStateData {
  if (!isRecord(value)) return false;
  return (
    typeof value.system_prompt === "string" &&
    typeof value.iteration_count === "number" &&
    Array.isArray(value.conversation_history) &&
    value.conversation_history.every(
      (item: unknown) =>
        isRecord(item) && typeof item.role === "string" && typeof item.content === "string"
    )
  );
}

export function isEntityLifecycleData(value: unknown): value is EntityLifecycleData {
  if (!isRecord(value)) return false;
  return (
    typeof value.entity_id === "number" &&
    typeof value.spawn_tick === "number" &&
    (value.despawn_tick === null || typeof value.despawn_tick === "number") &&
    typeof value.archetype === "string"
  );
}

// Visualization configuration types

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

export interface VisualizationConfig {
  world_name?: string | null;
  archetypes: ArchetypeConfig[];
  color_palette?: string[] | null;
  component_metrics: ComponentMetricConfig[];
  chat_enabled: boolean;
  entity_label_template?: string | null;
}

export function isArchetypeConfig(value: unknown): value is ArchetypeConfig {
  if (!isRecord(value)) return false;
  return (
    typeof value.key === "string" &&
    (value.label === undefined || value.label === null || typeof value.label === "string") &&
    (value.color === undefined || value.color === null || typeof value.color === "string") &&
    (value.description === undefined ||
      value.description === null ||
      typeof value.description === "string")
  );
}

export function isComponentMetricConfig(value: unknown): value is ComponentMetricConfig {
  if (!isRecord(value)) return false;
  return (
    typeof value.component === "string" &&
    (value.metric_field === undefined ||
      value.metric_field === null ||
      typeof value.metric_field === "string") &&
    (value.format === undefined || value.format === null || typeof value.format === "string")
  );
}

export function isVisualizationConfig(value: unknown): value is VisualizationConfig {
  if (!isRecord(value)) return false;
  return (
    (value.world_name === undefined ||
      value.world_name === null ||
      typeof value.world_name === "string") &&
    Array.isArray(value.archetypes) &&
    value.archetypes.every(isArchetypeConfig) &&
    (value.color_palette === undefined ||
      value.color_palette === null ||
      (Array.isArray(value.color_palette) &&
        value.color_palette.every((c: unknown) => typeof c === "string"))) &&
    Array.isArray(value.component_metrics) &&
    value.component_metrics.every(isComponentMetricConfig) &&
    typeof value.chat_enabled === "boolean" &&
    (value.entity_label_template === undefined ||
      value.entity_label_template === null ||
      typeof value.entity_label_template === "string")
  );
}
