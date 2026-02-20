const loc = typeof window !== "undefined" ? window.location : undefined;
const wsProtocol = loc?.protocol === "https:" ? "wss:" : "ws:";

export const WS_URL = loc ? `${wsProtocol}//${loc.host}/ws` : "ws://localhost:8000/ws";

export const RECONNECT_MAX_ATTEMPTS = 10;
export const RECONNECT_BASE_DELAY_MS = 1000;
export const RECONNECT_MAX_DELAY_MS = 30000;

export interface ModelTokenPricing {
  inputPer1kUsd: number;
  outputPer1kUsd: number;
}

export const MODEL_TOKEN_PRICING_USD_PER_1K: Record<string, ModelTokenPricing> = {
  "gpt-4o": { inputPer1kUsd: 0.005, outputPer1kUsd: 0.015 },
  "gpt-4o-mini": { inputPer1kUsd: 0.00015, outputPer1kUsd: 0.0006 },
  "claude-sonnet-4-20250514": { inputPer1kUsd: 0.003, outputPer1kUsd: 0.015 },
};

const rawCostBudgetThreshold = Number(
  import.meta.env.VITE_TOKEN_COST_BUDGET_USD ?? "1",
);

export const TOKEN_COST_BUDGET_USD =
  Number.isFinite(rawCostBudgetThreshold) && rawCostBudgetThreshold > 0
    ? rawCostBudgetThreshold
    : 1;

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
