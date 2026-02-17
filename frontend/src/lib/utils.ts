import type { EntitySnapshot } from "./types";

export function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

export function getArchetypeKey(archetype: readonly string[]): string {
  return [...archetype].sort().join(",");
}

export function getArchetypeDisplay(archetype: readonly string[]): string {
  return [...archetype].sort().join(", ");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function severityLabel(severity: string): string {
  switch (severity) {
    case "critical": return "CRIT";
    case "warning": return "WARN";
    case "info": return "INFO";
    default: return severity.toUpperCase();
  }
}

export function severityClasses(severity: string): string {
  switch (severity) {
    case "critical": return "text-error bg-error/20";
    case "warning": return "text-warning bg-warning/20";
    case "info": return "text-accent bg-accent/20";
    default: return "text-text-muted bg-bg-tertiary";
  }
}

export function entityHash(entity: EntitySnapshot): string {
  const sorted = [...entity.components].sort((a, b) =>
    a.type_short.localeCompare(b.type_short),
  );
  return sorted.map((c) => `${c.type_short}:${stableStringify(c.data)}`).join("|");
}
