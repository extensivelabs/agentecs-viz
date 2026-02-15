import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import JsonTree from "../lib/JsonTree.svelte";
import type { FieldChange } from "../lib/diff";

describe("JsonTree", () => {
  it("renders string values in green with quotes", () => {
    const { container } = render(JsonTree, { props: { data: { name: "Alice" } } });
    const span = container.querySelector(".text-green-400");
    expect(span).toBeTruthy();
    expect(span!.textContent).toContain('"Alice"');
  });

  it("renders number values with accent color", () => {
    const { container } = render(JsonTree, { props: { data: { count: 42 } } });
    const span = container.querySelector(".text-accent");
    expect(span).toBeTruthy();
    expect(span!.textContent).toBe("42");
  });

  it("renders boolean values in purple", () => {
    const { container } = render(JsonTree, { props: { data: { active: true } } });
    const span = container.querySelector(".text-purple-400");
    expect(span).toBeTruthy();
    expect(span!.textContent).toBe("true");
  });

  it("renders null values in muted italic", () => {
    const { container } = render(JsonTree, { props: { data: { value: null } } });
    const span = container.querySelector(".italic.text-text-muted");
    expect(span).toBeTruthy();
    expect(span!.textContent).toBe("null");
  });

  it("renders nested objects as collapsible (collapsed by default at depth>0)", () => {
    const { container } = render(JsonTree, {
      props: { data: { nested: { a: 1, b: 2, c: 3 } } },
    });
    const toggles = container.querySelectorAll("[data-testid='json-toggle']");
    expect(toggles.length).toBeGreaterThan(0);
    expect(container.textContent).toContain("a:");
  });

  it("collapses object on toggle click", async () => {
    const { container } = render(JsonTree, {
      props: { data: { nested: { a: 1 } } },
    });
    expect(container.textContent).toContain("a:");

    const toggle = container.querySelector("[data-testid='json-toggle']");
    expect(toggle).toBeTruthy();
    await fireEvent.click(toggle!);

    expect(container.textContent).toContain("{...}");
    expect(container.textContent).toContain("1 key");
  });

  it("renders arrays with item count when collapsed", async () => {
    const { container } = render(JsonTree, {
      props: { data: { items: [1, 2, 3, 4, 5] } },
    });
    const toggle = container.querySelector("[data-testid='json-toggle']");
    expect(toggle).toBeTruthy();
    await fireEvent.click(toggle!);

    expect(container.textContent).toContain("[...]");
    expect(container.textContent).toContain("5 items");
  });

  it("renders status fields with accent badge", () => {
    const { container } = render(JsonTree, {
      props: {
        data: { status: "active" },
        statusFields: ["status"],
      },
    });
    const badge = container.querySelector(".bg-accent\\/20");
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe("active");
  });

  it("renders error fields with error styling", () => {
    const { container } = render(JsonTree, {
      props: {
        data: { error: "something broke" },
        errorFields: ["error"],
      },
    });
    const badge = container.querySelector(".bg-error\\/20");
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe("something broke");
  });

  it("sorts keys alphabetically", () => {
    const { container } = render(JsonTree, {
      props: { data: { z: 1, a: 2, m: 3 } },
    });
    const text = container.textContent ?? "";
    const aIdx = text.indexOf("a:");
    const mIdx = text.indexOf("m:");
    const zIdx = text.indexOf("z:");
    expect(aIdx).toBeLessThan(mIdx);
    expect(mIdx).toBeLessThan(zIdx);
  });

  describe("diff highlighting", () => {
    it("shows old → new for changed scalar with warning styling", () => {
      const diff: FieldChange[] = [
        { path: ["x"], oldValue: 0, newValue: 10, type: "changed" },
      ];
      const { container } = render(JsonTree, {
        props: { data: { x: 10, y: 0 }, diff },
      });
      const changed = container.querySelector("[data-testid='diff-changed']");
      expect(changed).toBeTruthy();
      expect(changed!.textContent).toContain("0");
      expect(changed!.textContent).toContain("10");
      const warningSpan = changed!.querySelector(".text-warning");
      expect(warningSpan).toBeTruthy();
      const strikethrough = changed!.querySelector(".line-through");
      expect(strikethrough).toBeTruthy();
    });

    it("shows added field with success styling", () => {
      const diff: FieldChange[] = [
        { path: ["newField"], oldValue: undefined, newValue: 42, type: "added" },
      ];
      const { container } = render(JsonTree, {
        props: { data: { newField: 42 }, diff },
      });
      const added = container.querySelector("[data-testid='diff-added']");
      expect(added).toBeTruthy();
      expect(added!.textContent).toContain("newField");
      expect(added!.textContent).toContain("42");
      expect(added!.classList.contains("text-success")).toBe(true);
    });

    it("no highlighting when diff undefined", () => {
      const { container } = render(JsonTree, {
        props: { data: { x: 10 } },
      });
      expect(container.querySelector("[data-testid='diff-changed']")).toBeNull();
      expect(container.querySelector("[data-testid='diff-added']")).toBeNull();
      expect(container.querySelector("[data-diff-type]")).toBeNull();
    });

    it("shows nested change indicator on parent key", () => {
      const diff: FieldChange[] = [
        { path: ["pos", "x"], oldValue: 0, newValue: 10, type: "changed" },
      ];
      const { container } = render(JsonTree, {
        props: { data: { pos: { x: 10, y: 0 } }, diff },
      });
      const nested = container.querySelector("[data-diff-type='nested']");
      expect(nested).toBeTruthy();
    });
  });
});
