import type { EntitySnapshot } from "./types";

export function getArchetypeKey(archetype: string[]): string {
  return [...archetype].sort().join(",");
}

export function getArchetypeDisplay(archetype: string[]): string {
  return [...archetype].sort().join(", ");
}

export function entityHash(entity: EntitySnapshot): string {
  const parts: string[] = [];
  for (const comp of entity.components) {
    parts.push(`${comp.type_short}:${JSON.stringify(comp.data)}`);
  }
  return parts.join("|");
}
