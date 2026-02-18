import type { SpanEventMessage } from "./types";

export type SpanType = "llm" | "tool" | "system" | "retrieval" | "generic";

export interface SpanTreeNode {
  span: SpanEventMessage;
  children: SpanTreeNode[];
  depth: number;
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
  const prompt =
    (attributes["gen_ai.usage.prompt_tokens"] as number | undefined) ??
    (attributes["llm.usage.prompt_tokens"] as number | undefined) ??
    null;
  const completion =
    (attributes["gen_ai.usage.completion_tokens"] as number | undefined) ??
    (attributes["llm.usage.completion_tokens"] as number | undefined) ??
    null;
  const total = prompt !== null && completion !== null ? prompt + completion : null;
  return { prompt, completion, total };
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
