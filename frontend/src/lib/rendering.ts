export const WORLD_SIZE = 2000;

export const GRID_SIZE = 50;
export const GRID_COLOR = 0x2a2a3a;
export const GRID_ALPHA = 0.5;

export const BACKGROUND_COLOR = 0x0a0a0f;

export const DETAIL_BASE_RADIUS = 8;
export const DETAIL_PER_COMPONENT = 2;
export const DETAIL_MIN_RADIUS = 6;
export const DETAIL_MAX_RADIUS = 20;

export const OVERVIEW_DOT_RADIUS = 3;

export const MIN_HIT_RADIUS = 12;

export const DETAIL_OVERVIEW_THRESHOLD = 15;
export const LABEL_ZOOM_THRESHOLD = 1.5;

export const SELECTION_RING_COLOR = 0xffffff;
export const ERROR_RING_COLOR = 0xf87171;
export const CHANGED_RING_COLOR = 0xfbbf24;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

export function adaptiveMaxRadius(entityCount: number): number {
  if (entityCount <= 30) return DETAIL_MAX_RADIUS;
  if (entityCount <= 100) return lerp(DETAIL_MAX_RADIUS, 12, (entityCount - 30) / 70);
  if (entityCount <= 500) return lerp(12, DETAIL_MIN_RADIUS, (entityCount - 100) / 400);
  return DETAIL_MIN_RADIUS;
}

export function layoutSpacing(entityCount: number): number {
  return 2 * adaptiveMaxRadius(entityCount);
}

export function entityRadius(componentCount: number, maxRadius: number = DETAIL_MAX_RADIUS): number {
  const r = DETAIL_BASE_RADIUS + componentCount * DETAIL_PER_COMPONENT;
  return Math.max(DETAIL_MIN_RADIUS, Math.min(maxRadius, r));
}
