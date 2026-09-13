import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import ArchetypesTab from "../lib/ArchetypesTab.svelte";
import { world } from "../lib/state/world.svelte";
import { makeEntity, setWorldState } from "./helpers";

describe("ArchetypesTab", () => {
  beforeEach(() => {
    world.clearQuery();
  });

  afterEach(() => {
    world.clearQuery();
    world.disconnect();
    vi.restoreAllMocks();
  });

  it("shows an empty state when there are no entities", () => {
    setWorldState([], { archetypes: [] });

    render(ArchetypesTab);

    expect(screen.getByTestId("archetypes-empty").textContent).toContain("No archetypes");
  });

  it("aggregates exact archetype rows from world.entities", () => {
    setWorldState(
      [
        makeEntity(1, ["Agent", "Position"]),
        makeEntity(2, ["Position", "Agent"]),
        makeEntity(3, ["Task"]),
      ],
      {
        archetypes: [{ key: "Agent,Position", label: "Agent / Position" }],
      },
    );

    render(ArchetypesTab);

    const rows = screen.getAllByTestId("archetype-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Agent / Position");
    expect(rows[0].textContent).toContain("2 entities");
    expect(rows[1].textContent).toContain("Task");
  });

  it("applies an exact archetype filter and calls back into the app", async () => {
    setWorldState(
      [
        makeEntity(1, ["Agent", "Position"]),
        makeEntity(2, ["Task"]),
      ],
      {
        archetypes: [{ key: "Agent,Position", label: "Agent / Position" }],
      },
    );

    const onOpenEntities = vi.fn();
    render(ArchetypesTab, { onOpenEntities });

    await fireEvent.click(screen.getAllByTestId("archetype-row")[0]);

    expect(world.activeQuery).toEqual({
      name: "",
      clauses: [{ type: "archetype_eq", component: "Agent,Position" }],
    });
    expect(onOpenEntities).toHaveBeenCalledOnce();
  });
});
