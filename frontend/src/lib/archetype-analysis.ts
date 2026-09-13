import { resolveArchetypeColorCSS } from "./colors";
import type { EntitySnapshot, WorldSnapshot } from "./types";
import { getArchetypeDisplay, getArchetypeKey } from "./utils";

type ArchetypeConfigLike = {
  label?: string | null;
  color?: string | null;
};

export interface ArchetypeSummary {
  key: string;
  archetype: string[];
  label: string;
  color: string;
  entityCount: number;
  percentage: number;
}

export interface EntityArchetypeHistoryEntry {
  tick: number;
  kind: "spawned" | "changed";
  archetype: string[];
  key: string;
  label: string;
}

function normalizeArchetype(archetype: readonly string[]): string[] {
  return [...archetype].sort((left, right) => left.localeCompare(right));
}

function archetypeLabel(
  archetype: readonly string[],
  configMap: Map<string, ArchetypeConfigLike>,
): string {
  const key = getArchetypeKey(archetype);
  return configMap.get(key)?.label ?? (getArchetypeDisplay(archetype) || "(empty)");
}

export function summarizeArchetypes(
  entities: EntitySnapshot[],
  configMap: Map<string, ArchetypeConfigLike>,
  palette?: string[] | null,
): ArchetypeSummary[] {
  const counts = new Map<string, { archetype: string[]; entityCount: number }>();

  for (const entity of entities) {
    const archetype = normalizeArchetype(entity.archetype);
    const key = getArchetypeKey(archetype);
    const existing = counts.get(key);

    if (existing) {
      existing.entityCount += 1;
      continue;
    }

    counts.set(key, { archetype, entityCount: 1 });
  }

  const totalEntities = entities.length;

  return [...counts.values()]
    .map(({ archetype, entityCount }) => ({
      key: getArchetypeKey(archetype),
      archetype,
      label: archetypeLabel(archetype, configMap),
      color: resolveArchetypeColorCSS(archetype, configMap, palette),
      entityCount,
      percentage: totalEntities === 0 ? 0 : (entityCount / totalEntities) * 100,
    }))
    .sort((left, right) => right.entityCount - left.entityCount || left.label.localeCompare(right.label));
}

export function computeEntityArchetypeHistory(
  snapshots: WorldSnapshot[],
  entityId: number,
  configMap: Map<string, ArchetypeConfigLike>,
): EntityArchetypeHistoryEntry[] {
  const history: EntityArchetypeHistoryEntry[] = [];
  let previousKey: string | null = null;
  let previousPresence = false;

  const orderedSnapshots = [...snapshots].sort((left, right) => left.tick - right.tick);

  for (const snapshot of orderedSnapshots) {
    const entity = snapshot.entities.find((candidate) => candidate.id === entityId);
    if (!entity) {
      previousPresence = false;
      previousKey = null;
      continue;
    }

    const archetype = normalizeArchetype(entity.archetype);
    const key = getArchetypeKey(archetype);

    if (!previousPresence) {
      history.push({
        tick: snapshot.tick,
        kind: "spawned",
        archetype,
        key,
        label: archetypeLabel(archetype, configMap),
      });
    } else if (key !== previousKey) {
      history.push({
        tick: snapshot.tick,
        kind: "changed",
        archetype,
        key,
        label: archetypeLabel(archetype, configMap),
      });
    }

    previousPresence = true;
    previousKey = key;
  }

  return history;
}
