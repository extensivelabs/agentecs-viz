import type { EntitySnapshot } from "./types";
import { getArchetypeKey } from "./utils";
import { layoutSpacing, WORLD_SIZE } from "./rendering";

export type FocusMode = "archetypes" | "components";

export interface EntityPosition {
  x: number;
  y: number;
}

function hasPositionComponent(entity: EntitySnapshot): { x: number; y: number } | null {
  for (const comp of entity.components) {
    const name = comp.type_short.toLowerCase();
    if (name === "position" || name === "pos" || name === "transform") {
      const data = comp.data;
      if (typeof data.x === "number" && typeof data.y === "number") {
        return { x: data.x, y: data.y };
      }
    }
  }
  return null;
}

function spiralPosition(index: number, centerX: number, centerY: number, spacing: number): { x: number; y: number } {
  if (index === 0) return { x: centerX, y: centerY };
  const angle = index * 2.4; // golden angle
  const radius = spacing * Math.sqrt(index);
  return {
    x: centerX + Math.cos(angle) * radius,
    y: centerY + Math.sin(angle) * radius,
  };
}

function clampToWorld(v: number): number {
  return Math.max(0, Math.min(WORLD_SIZE, v));
}

export function archetypeLayout(entities: EntitySnapshot[]): Map<number, EntityPosition> {
  const positions = new Map<number, EntityPosition>();
  if (entities.length === 0) return positions;

  const spacing = layoutSpacing(entities.length);
  const center = WORLD_SIZE / 2;
  const scale = WORLD_SIZE / 200;

  const unpositioned = new Map<string, EntitySnapshot[]>();

  for (const entity of entities) {
    const pos = hasPositionComponent(entity);
    if (pos) {
      positions.set(entity.id, {
        x: clampToWorld(center + pos.x * scale),
        y: clampToWorld(center + pos.y * scale),
      });
    } else {
      const key = getArchetypeKey(entity.archetype);
      let group = unpositioned.get(key);
      if (!group) {
        group = [];
        unpositioned.set(key, group);
      }
      group.push(entity);
    }
  }

  if (unpositioned.size === 0) return positions;

  // Arrange unpositioned groups in a circle around center
  const sortedKeys = [...unpositioned.keys()].sort();
  const groupCount = sortedKeys.length;
  const orbitRadius = WORLD_SIZE * 0.3;

  for (let i = 0; i < groupCount; i++) {
    const key = sortedKeys[i];
    const group = unpositioned.get(key)!;
    const angle = (2 * Math.PI * i) / groupCount - Math.PI / 2;
    const cx = center + Math.cos(angle) * orbitRadius;
    const cy = center + Math.sin(angle) * orbitRadius;

    for (let j = 0; j < group.length; j++) {
      const pos = spiralPosition(j, cx, cy, spacing);
      positions.set(group[j].id, {
        x: clampToWorld(pos.x),
        y: clampToWorld(pos.y),
      });
    }
  }

  return positions;
}

export function componentLayout(entities: EntitySnapshot[]): Map<number, EntityPosition> {
  const positions = new Map<number, EntityPosition>();
  if (entities.length === 0) return positions;

  const spacing = layoutSpacing(entities.length);
  const center = WORLD_SIZE / 2;

  // Group entities by archetype
  const groups = new Map<string, EntitySnapshot[]>();
  for (const entity of entities) {
    const key = getArchetypeKey(entity.archetype);
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(entity);
  }

  // Collect all unique component names and assign anchor points on a circle
  const allComponents = new Set<string>();
  for (const entity of entities) {
    for (const comp of entity.archetype) {
      allComponents.add(comp);
    }
  }
  const sortedComponents = [...allComponents].sort();
  const anchorRadius = WORLD_SIZE * 0.3;
  const componentAnchors = new Map<string, { x: number; y: number }>();
  for (let i = 0; i < sortedComponents.length; i++) {
    const angle = (2 * Math.PI * i) / sortedComponents.length;
    componentAnchors.set(sortedComponents[i], {
      x: center + Math.cos(angle) * anchorRadius,
      y: center + Math.sin(angle) * anchorRadius,
    });
  }

  // Each archetype's centroid = average of its components' anchor positions
  const groupCentroids = new Map<string, { x: number; y: number }>();
  for (const [key, group] of groups) {
    const archetype = group[0].archetype;
    let cx = 0;
    let cy = 0;
    for (const comp of archetype) {
      const anchor = componentAnchors.get(comp)!;
      cx += anchor.x;
      cy += anchor.y;
    }
    if (archetype.length > 0) {
      cx /= archetype.length;
      cy /= archetype.length;
    } else {
      cx = center;
      cy = center;
    }
    groupCentroids.set(key, { x: cx, y: cy });
  }

  // Place entities in spiral around their group centroid
  for (const [key, group] of groups) {
    const centroid = groupCentroids.get(key)!;
    for (let j = 0; j < group.length; j++) {
      const pos = spiralPosition(j, centroid.x, centroid.y, spacing);
      positions.set(group[j].id, {
        x: clampToWorld(pos.x),
        y: clampToWorld(pos.y),
      });
    }
  }

  return positions;
}

export function computeLayout(entities: EntitySnapshot[], mode: FocusMode): Map<number, EntityPosition> {
  return mode === "components" ? componentLayout(entities) : archetypeLayout(entities);
}
