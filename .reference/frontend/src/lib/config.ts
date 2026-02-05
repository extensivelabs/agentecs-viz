// WebSocket configuration (override via VITE_WS_PORT)
export const WS_PORT = import.meta.env.VITE_WS_PORT
  ? parseInt(import.meta.env.VITE_WS_PORT as string, 10)
  : 8000;

// World/grid dimensions
export const WORLD_SIZE = 2000;
export const GRID_SIZE = 50;
export const GRID_COLOR = 0x2a2a3a;
export const GRID_ALPHA = 0.5;

// Zoom level thresholds (based on viewport scale)
export const SCALE_THRESHOLDS = {
  micro: 2.5, // scale > 2.5: focused inspection
  detail: 0.8, // scale 0.8-2.5: default working level
  meso: 0.3, // scale 0.3-0.8: medium zoom
  // scale < 0.3: macro (density view)
};

// Animation durations (ms)
export const SPAWN_DURATION = 300;
export const DESTROY_DURATION = 200;
export const PULSE_DURATION = 150;

// Entity rendering - DETAIL level
export const DETAIL_BASE_RADIUS = 8;
export const DETAIL_RADIUS_PER_COMPONENT = 2;
export const DETAIL_MIN_RADIUS = 6;
export const DETAIL_MAX_RADIUS = 20;

// Entity rendering - MESO level
export const MESO_RADIUS = 4;
export const MESO_GRID_SIZE = 100; // World units per grid cell
export const CLUSTER_LABEL_THRESHOLD = 5; // Min entities to show label

// Entity rendering - MACRO level
export const MACRO_RADIUS = 2;
export const MACRO_GRID_COLS = 20;
export const MACRO_GRID_ROWS = 20;
export const MACRO_CELL_MIN_ALPHA = 0.2;
export const MACRO_CELL_MAX_ALPHA = 0.9;

// MICRO level
export const MICRO_MAX_ACTIVE_NEIGHBORS = 3;

// Archetype color palette (vibrant colors for dark background)
export const ARCHETYPE_COLORS = [
  0x6366f1, // indigo
  0x8b5cf6, // violet
  0xec4899, // pink
  0xf43f5e, // rose
  0xf97316, // orange
  0xeab308, // yellow
  0x22c55e, // green
  0x14b8a6, // teal
  0x06b6d4, // cyan
  0x3b82f6, // blue
];
