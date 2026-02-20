import type { SpanEventMessage } from "./types";
import {
  MODEL_TOKEN_PRICING_USD_PER_1K,
  type ModelTokenPricing,
} from "./config";

export type SpanType = "llm" | "tool" | "system" | "retrieval" | "generic";

export interface SpanTreeNode {
  span: SpanEventMessage;
  children: SpanTreeNode[];
  depth: number;
}

export interface SpanUsageTotals {
  prompt: number;
  completion: number;
  total: number;
  costUsd: number;
}

export interface ModelUsageTotals extends SpanUsageTotals {
  model: string;
}

export const SPAN_TYPE_COLORS: Record<SpanType, string> = {
  llm: "#8b5cf6",
  tool: "#06b6d4",
  system: "#f59e0b",
  retrieval: "#22c55e",
  generic: "#6b7280",
};

export function detectSpanType(attributes: Record<string, unknown>): SpanType {
  let hasTool = false;
  let hasRetrieval = false;

  for (const key of Object.keys(attributes)) {
    if (key.startsWith("gen_ai.") || key.startsWith("llm.")) return "llm";
    if (key.startsWith("tool.")) hasTool = true;
    else if (key.startsWith("retrieval.")) hasRetrieval = true;
  }

  if (hasTool) return "tool";
  if (hasRetrieval) return "retrieval";
  if (attributes["agentecs.system"]) return "system";
  return "generic";
}

export function getModelName(
  attributes: Record<string, unknown>,
): string | null {
  const model =
    attributes["gen_ai.request.model"] ?? attributes["llm.model_name"];
  return typeof model === "string" ? model : null;
}

export function getTokenCounts(attributes: Record<string, unknown>): {
  prompt: number | null;
  completion: number | null;
  total: number | null;
} {
  const promptAttr =
    attributes["gen_ai.usage.prompt_tokens"] ??
    attributes["gen_ai.usage.input_tokens"] ??
    attributes["llm.usage.prompt_tokens"] ??
    attributes["llm.token_count.prompt"];
  const completionAttr =
    attributes["gen_ai.usage.completion_tokens"] ??
    attributes["gen_ai.usage.output_tokens"] ??
    attributes["llm.usage.completion_tokens"] ??
    attributes["llm.token_count.completion"];
  const prompt = typeof promptAttr === "number" ? promptAttr : null;
  const completion = typeof completionAttr === "number" ? completionAttr : null;
  const total =
    prompt !== null || completion !== null
      ? (prompt ?? 0) + (completion ?? 0)
      : null;
  return { prompt, completion, total };
}

function getNumberAttribute(
  attributes: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === "number") return value;
  }
  return null;
}

export function getSpanCostUsd(
  attributes: Record<string, unknown>,
  modelPricing: Record<string, ModelTokenPricing> = MODEL_TOKEN_PRICING_USD_PER_1K,
): number {
  const totalCost = getNumberAttribute(attributes, [
    "llm.cost.total",
    "gen_ai.cost.total",
    "gen_ai.usage.cost.total",
  ]);
  if (totalCost !== null) return totalCost;

  const promptCost = getNumberAttribute(attributes, [
    "llm.cost.prompt",
    "gen_ai.cost.input",
    "gen_ai.usage.cost.input",
  ]);
  const completionCost = getNumberAttribute(attributes, [
    "llm.cost.completion",
    "gen_ai.cost.output",
    "gen_ai.usage.cost.output",
  ]);
  if (promptCost !== null || completionCost !== null) {
    return (promptCost ?? 0) + (completionCost ?? 0);
  }

  const model = getModelName(attributes);
  if (!model) return 0;
  const pricing = modelPricing[model];
  if (!pricing) return 0;

  const tokens = getTokenCounts(attributes);
  return (
    ((tokens.prompt ?? 0) * pricing.inputPer1kUsd +
      (tokens.completion ?? 0) * pricing.outputPer1kUsd) /
    1000
  );
}

export function aggregateSpanUsage(
  spans: SpanEventMessage[],
  modelPricing: Record<string, ModelTokenPricing> = MODEL_TOKEN_PRICING_USD_PER_1K,
): { totals: SpanUsageTotals; byModel: ModelUsageTotals[] } {
  const totals: SpanUsageTotals = {
    prompt: 0,
    completion: 0,
    total: 0,
    costUsd: 0,
  };
  const byModelMap = new Map<string, ModelUsageTotals>();

  for (const span of spans) {
    const model = getModelName(span.attributes);
    const tokens = getTokenCounts(span.attributes);
    const prompt = tokens.prompt ?? 0;
    const completion = tokens.completion ?? 0;
    const total = tokens.total ?? 0;
    const costUsd = getSpanCostUsd(span.attributes, modelPricing);

    totals.prompt += prompt;
    totals.completion += completion;
    totals.total += total;
    totals.costUsd += costUsd;

    if (!model) continue;
    const existing = byModelMap.get(model) ?? {
      model,
      prompt: 0,
      completion: 0,
      total: 0,
      costUsd: 0,
    };
    existing.prompt += prompt;
    existing.completion += completion;
    existing.total += total;
    existing.costUsd += costUsd;
    byModelMap.set(model, existing);
  }

  const byModel = [...byModelMap.values()].sort((a, b) => b.costUsd - a.costUsd);
  return { totals, byModel };
}

export function getSpanDurationMs(span: SpanEventMessage): number {
  return (span.end_time - span.start_time) * 1000;
}

export function buildSpanTree(spans: SpanEventMessage[]): SpanTreeNode[] {
  const byId = new Map<string, SpanTreeNode>();
  const roots: SpanTreeNode[] = [];

  for (const span of spans) {
    byId.set(span.span_id, { span, children: [], depth: 0 });
  }

  for (const span of spans) {
    const node = byId.get(span.span_id)!;
    if (span.parent_span_id && byId.has(span.parent_span_id)) {
      byId.get(span.parent_span_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  function setDepths(node: SpanTreeNode, depth: number): void {
    node.depth = depth;
    for (const child of node.children) {
      setDepths(child, depth + 1);
    }
  }
  for (const root of roots) {
    setDepths(root, 0);
  }

  return roots;
}
