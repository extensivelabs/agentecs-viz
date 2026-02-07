import type { EntitySnapshot } from "./types";

export function getArchetypeKey(archetype: string[]): string {
  return [...archetype].sort().join(",");
}

export function getArchetypeDisplay(archetype: string[]): string {
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

export function entityHash(entity: EntitySnapshot): string {
  const sorted = [...entity.components].sort((a, b) =>
    a.type_short.localeCompare(b.type_short),
  );
  return sorted.map((c) => `${c.type_short}:${stableStringify(c.data)}`).join("|");
}
