import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import TabBar from "../lib/TabBar.svelte";
import type { Tab } from "../lib/TabBar.svelte";

const tabs: Tab[] = [
  { id: "entities", label: "Entities" },
  { id: "traces", label: "Traces" },
  { id: "timeline", label: "Timeline" },
];

describe("TabBar", () => {
  it("switches tabs with numeric keyboard shortcuts", async () => {
    const onTabChange = vi.fn();
    render(TabBar, {
      props: {
        tabs,
        activeTab: "entities",
        onTabChange,
      },
    });

    await fireEvent.keyDown(window, { key: "2" });
    expect(onTabChange).toHaveBeenCalledWith("traces");
  });

  it("ignores keyboard shortcuts when modifier keys are pressed", async () => {
    const onTabChange = vi.fn();
    render(TabBar, {
      props: {
        tabs,
        activeTab: "entities",
        onTabChange,
      },
    });

    await fireEvent.keyDown(window, { key: "2", ctrlKey: true });
    await fireEvent.keyDown(window, { key: "2", altKey: true });
    await fireEvent.keyDown(window, { key: "2", metaKey: true });

    expect(onTabChange).not.toHaveBeenCalled();
  });

  it("ignores disabled tabs for keyboard shortcuts", async () => {
    const onTabChange = vi.fn();
    render(TabBar, {
      props: {
        tabs: [
          { id: "entities", label: "Entities" },
          { id: "traces", label: "Traces", disabled: true },
        ],
        activeTab: "entities",
        onTabChange,
      },
    });

    await fireEvent.keyDown(window, { key: "2" });
    expect(onTabChange).not.toHaveBeenCalled();
  });
});
