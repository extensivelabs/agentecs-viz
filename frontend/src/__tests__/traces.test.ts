import { describe, it, expect } from "vitest";
import {
  detectSpanType,
  getModelName,
  getTokenCounts,
  getSpanDurationMs,
  buildSpanTree,
} from "../lib/traces";
import type { SpanEventMessage } from "../lib/types";

function makeSpan(overrides: Partial<SpanEventMessage> = {}): SpanEventMessage {
  return {
    type: "span_event",
    span_id: "s1",
    trace_id: "t1",
    parent_span_id: null,
    name: "test",
    start_time: 1000,
    end_time: 1000.5,
    status: "unset",
    attributes: {},
    ...overrides,
  };
}

describe("detectSpanType", () => {
  it("detects LLM span from gen_ai prefix", () => {
    expect(detectSpanType({ "gen_ai.request.model": "gpt-4o" })).toBe("llm");
  });

  it("detects LLM span from llm prefix", () => {
    expect(detectSpanType({ "llm.model_name": "claude" })).toBe("llm");
  });

  it("detects tool span", () => {
    expect(detectSpanType({ "tool.name": "web_search" })).toBe("tool");
  });

  it("detects retrieval span", () => {
    expect(detectSpanType({ "retrieval.source": "vector_db" })).toBe("retrieval");
  });

  it("detects system span", () => {
    expect(detectSpanType({ "agentecs.system": "MovementSystem" })).toBe("system");
  });

  it("returns generic for unknown attributes", () => {
    expect(detectSpanType({ "custom.field": "value" })).toBe("generic");
  });

  it("returns generic for empty attributes", () => {
    expect(detectSpanType({})).toBe("generic");
  });
});

describe("getModelName", () => {
  it("returns gen_ai model name", () => {
    expect(getModelName({ "gen_ai.request.model": "gpt-4o" })).toBe("gpt-4o");
  });

  it("returns llm model name as fallback", () => {
    expect(getModelName({ "llm.model_name": "claude" })).toBe("claude");
  });

  it("prefers gen_ai over llm", () => {
    expect(
      getModelName({
        "gen_ai.request.model": "gpt-4o",
        "llm.model_name": "claude",
      }),
    ).toBe("gpt-4o");
  });

  it("returns null when missing", () => {
    expect(getModelName({})).toBeNull();
  });
});

describe("getTokenCounts", () => {
  it("returns gen_ai token counts", () => {
    const result = getTokenCounts({
      "gen_ai.usage.prompt_tokens": 100,
      "gen_ai.usage.completion_tokens": 50,
    });
    expect(result).toEqual({ prompt: 100, completion: 50, total: 150 });
  });

  it("returns llm token counts as fallback", () => {
    const result = getTokenCounts({
      "llm.usage.prompt_tokens": 200,
      "llm.usage.completion_tokens": 75,
    });
    expect(result).toEqual({ prompt: 200, completion: 75, total: 275 });
  });

  it("returns nulls when missing", () => {
    expect(getTokenCounts({})).toEqual({
      prompt: null,
      completion: null,
      total: null,
    });
  });
});

describe("getSpanDurationMs", () => {
  it("computes duration in milliseconds", () => {
    const span = makeSpan({ start_time: 1000, end_time: 1000.25 });
    expect(getSpanDurationMs(span)).toBe(250);
  });

  it("returns 0 for same start and end", () => {
    const span = makeSpan({ start_time: 1000, end_time: 1000 });
    expect(getSpanDurationMs(span)).toBe(0);
  });
});

describe("buildSpanTree", () => {
  it("builds tree from flat span list", () => {
    const root = makeSpan({ span_id: "root", parent_span_id: null });
    const child1 = makeSpan({ span_id: "c1", parent_span_id: "root" });
    const child2 = makeSpan({ span_id: "c2", parent_span_id: "root" });

    const tree = buildSpanTree([root, child1, child2]);
    expect(tree).toHaveLength(1);
    expect(tree[0].span.span_id).toBe("root");
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].depth).toBe(0);
    expect(tree[0].children[0].depth).toBe(1);
  });

  it("handles orphan spans as roots", () => {
    const orphan = makeSpan({ span_id: "o1", parent_span_id: "missing" });
    const tree = buildSpanTree([orphan]);
    expect(tree).toHaveLength(1);
    expect(tree[0].span.span_id).toBe("o1");
  });

  it("returns empty for no spans", () => {
    expect(buildSpanTree([])).toEqual([]);
  });

  it("handles deep nesting", () => {
    const root = makeSpan({ span_id: "r" });
    const c1 = makeSpan({ span_id: "c1", parent_span_id: "r" });
    const c2 = makeSpan({ span_id: "c2", parent_span_id: "c1" });

    const tree = buildSpanTree([root, c1, c2]);
    expect(tree[0].children[0].children[0].depth).toBe(2);
  });
});
