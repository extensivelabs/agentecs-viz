import type { EntitySnapshot } from "./types";
import { getArchetypeKey } from "./utils";
import { layoutSpacing, WORLD_SIZE } from "./rendering";

export type LayoutMode = "spatial" | "pipeline";

export interface EntityPosition {
  x: number;
  y: number;
}

export interface ColumnInfo {
  name: string;
  x: number;
  width: number;
  count: number;
}

export interface LayoutResult {
  positions: Map<number, EntityPosition>;
  columns: ColumnInfo[];
}

export const PIPELINE_HEADER_Y = 80;
const PIPELINE_COLUMN_PADDING = 40;
const UNKNOWN_STATUS = "(unknown)";

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

function clampToColumn(x: number, colIndex: number, colWidth: number, padding: number): number {
  const left = colIndex * colWidth + padding;
  const right = (colIndex + 1) * colWidth - padding;
  return Math.max(left, Math.min(right, x));
}

export function getEntityStatusValue(
  entity: EntitySnapshot,
  statusFields: string[],
): string | null {
  for (const field of statusFields) {
    for (const comp of entity.components) {
      const val = comp.data[field];
      if (val !== undefined && val !== null) return String(val);
    }
  }
  return null;
}

export function componentLayout(entities: EntitySnapshot[]): Map<number, EntityPosition> {
  const positions = new Map<number, EntityPosition>();
  if (entities.length === 0) return positions;

  const center = WORLD_SIZE / 2;
  const scale = WORLD_SIZE / 200;

  const unpositioned: EntitySnapshot[] = [];
  for (const entity of entities) {
    const pos = hasPositionComponent(entity);
    if (pos) {
      positions.set(entity.id, {
        x: clampToWorld(center + pos.x * scale),
        y: clampToWorld(center + pos.y * scale),
      });
    } else {
      unpositioned.push(entity);
    }
  }

  if (unpositioned.length === 0) return positions;

  const spacing = layoutSpacing(unpositioned.length);

  const groups = new Map<string, EntitySnapshot[]>();
  for (const entity of unpositioned) {
    const key = getArchetypeKey(entity.archetype);
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(entity);
  }

  const allComponents = new Set<string>();
  for (const entity of unpositioned) {
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

export function pipelineLayout(
  entities: EntitySnapshot[],
  statusFields: string[],
): LayoutResult {
  const positions = new Map<number, EntityPosition>();
  const columns: ColumnInfo[] = [];
  if (entities.length === 0) return { positions, columns };

  // Group entities by status value
  const groups = new Map<string, EntitySnapshot[]>();
  for (const entity of entities) {
    const status = getEntityStatusValue(entity, statusFields) ?? UNKNOWN_STATUS;
    let group = groups.get(status);
    if (!group) {
      group = [];
      groups.set(status, group);
    }
    group.push(entity);
  }

  // Sort columns: by count descending, then alphabetically
  const sortedKeys = [...groups.keys()].sort((a, b) => {
    if (a === UNKNOWN_STATUS) return 1;
    if (b === UNKNOWN_STATUS) return -1;
    const countDiff = groups.get(b)!.length - groups.get(a)!.length;
    if (countDiff !== 0) return countDiff;
    return a.localeCompare(b);
  });

  const numCols = sortedKeys.length;
  const colWidth = WORLD_SIZE / numCols;
  const spacing = layoutSpacing(entities.length);
  const contentTop = PIPELINE_HEADER_Y + PIPELINE_COLUMN_PADDING;

  for (let col = 0; col < numCols; col++) {
    const key = sortedKeys[col];
    const group = groups.get(key)!;
    const colCenterX = (col + 0.5) * colWidth;

    columns.push({ name: key, x: colCenterX, width: colWidth, count: group.length });

    // Place entities in spiral within the column
    const spiralCenterY = contentTop + WORLD_SIZE * 0.35;
    for (let j = 0; j < group.length; j++) {
      const pos = spiralPosition(j, colCenterX, spiralCenterY, spacing);
      positions.set(group[j].id, {
        x: clampToWorld(clampToColumn(pos.x, col, colWidth, PIPELINE_COLUMN_PADDING)),
        y: clampToWorld(Math.max(contentTop, pos.y)),
      });
    }
  }

  return { positions, columns };
}

export function computeLayout(
  entities: EntitySnapshot[],
  mode: LayoutMode = "spatial",
  statusFields: string[] = [],
): LayoutResult {
  if (mode === "pipeline") {
    return pipelineLayout(entities, statusFields);
  }
  return { positions: componentLayout(entities), columns: [] };
}
