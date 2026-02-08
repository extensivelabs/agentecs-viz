const loc = typeof window !== "undefined" ? window.location : undefined;
const wsProtocol = loc?.protocol === "https:" ? "wss:" : "ws:";

export const WS_URL = loc ? `${wsProtocol}//${loc.host}/ws` : "ws://localhost:8000/ws";

export const RECONNECT_MAX_ATTEMPTS = 10;
export const RECONNECT_BASE_DELAY_MS = 1000;
export const RECONNECT_MAX_DELAY_MS = 30000;

export const DEFAULT_COLOR_PALETTE: number[] = [
  0x8b5cf6, // purple
  0x06b6d4, // cyan
  0xf59e0b, // amber
  0x34d399, // emerald
  0xf87171, // red
  0x4f8eff, // blue
  0xec4899, // pink
  0xa78bfa, // violet
  0x22d3ee, // sky
  0xfbbf24, // yellow
];
