import type { EntitySnapshot } from "./websocket";

/** Canonical archetype key for comparison (sorted, comma-joined). */
export function getArchetypeKey(archetype: string[]): string {
  return archetype.slice().sort().join(",");
}

/** Display-friendly archetype string with spaces after commas. */
export function getArchetypeDisplay(archetype: string[]): string {
  return archetype.slice().sort().join(", ");
}

/** Structural hash for change detection (avoids full JSON.stringify). */
export function entityHash(entity: EntitySnapshot): string {
  const archKey = entity.archetype.join(",");
  const compKeys = entity.components
    .map((c) => `${c.type_short}:${Object.keys(c.data).length}`)
    .join("|");
  return `${archKey}::${compKeys}`;
}
