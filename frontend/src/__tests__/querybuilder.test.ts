import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import QueryBuilder from "../lib/QueryBuilder.svelte";
import { world } from "../lib/state/world.svelte";
import { makeEntity, setWorldState } from "./helpers";

describe("QueryBuilder", () => {
  beforeEach(() => {
    world.clearQuery();
    world.savedQueries = [];
    setWorldState([
      makeEntity(1, ["Agent", "Position"]),
      makeEntity(2, ["Task"]),
      makeEntity(3, ["Agent", "Task"]),
    ]);
  });

  it("renders collapsed by default", () => {
    render(QueryBuilder);
    expect(screen.getByTestId("query-builder")).toBeTruthy();
    expect(screen.queryByTestId("query-builder-expanded")).toBeNull();
  });

  it("expands when toggle clicked", async () => {
    render(QueryBuilder);
    await fireEvent.click(screen.getByTestId("query-toggle"));
    expect(screen.getByTestId("query-builder-expanded")).toBeTruthy();
  });

  it("shows component input when expanded", async () => {
    render(QueryBuilder);
    await fireEvent.click(screen.getByTestId("query-toggle"));
    expect(screen.getByTestId("component-input")).toBeTruthy();
  });

  it("shows match count when filter is active", async () => {
    world.setQuery({ name: "", clauses: [{ type: "with", component: "Agent" }] });
    render(QueryBuilder);
    const badge = screen.getByTestId("match-count");
    expect(badge.textContent).toContain("2");
    expect(badge.textContent).toContain("3");
  });

  it("shows clause chips for active query", () => {
    world.setQuery({
      name: "",
      clauses: [
        { type: "with", component: "Agent" },
        { type: "without", component: "Task" },
      ],
    });
    render(QueryBuilder);
    const chips = screen.getAllByTestId("clause-chip");
    expect(chips).toHaveLength(2);
    expect(chips[0].textContent).toContain("WITH");
    expect(chips[0].textContent).toContain("Agent");
    expect(chips[1].textContent).toContain("NOT");
    expect(chips[1].textContent).toContain("Task");
  });

  it("renders chips for value clauses", () => {
    world.setQuery({
      name: "",
      clauses: [
        {
          type: "value_eq",
          component: "Agent",
          field: "state",
          value: "idle",
        },
        {
          type: "value_range",
          component: "Position",
          field: "x",
          min: 0,
          max: 10,
        },
        {
          type: "value_range",
          component: "Position",
          field: "y",
          min: 10,
          max: 20,
          inclusiveMax: true,
        },
      ],
    });

    render(QueryBuilder);

    const chips = screen.getAllByTestId("clause-chip");
    expect(chips).toHaveLength(3);
    expect(chips[0].textContent).toContain("Agent.state = idle");
    expect(chips[1].textContent).toContain("Position.x in [0, 10)");
    expect(chips[2].textContent).toContain("Position.y in [10, 20]");
  });

  it("renders a readable chip for exact archetype clauses", () => {
    setWorldState(
      [makeEntity(1, ["Agent", "Position"])],
      {
        archetypes: [{ key: "Agent,Position", label: "Agent / Position" }],
      },
    );

    world.setQuery({
      name: "",
      clauses: [{ type: "archetype_eq", component: "Agent,Position" }],
    });

    render(QueryBuilder);

    const chip = screen.getByTestId("clause-chip");
    expect(chip.textContent).toContain("ARCHETYPE");
    expect(chip.textContent).toContain("Agent / Position");
  });

  it("clear button removes active query", async () => {
    world.setQuery({ name: "", clauses: [{ type: "with", component: "Agent" }] });
    render(QueryBuilder);
    await fireEvent.click(screen.getByTestId("clear-query"));
    expect(world.activeQuery).toBeNull();
  });

  it("saved queries appear when expanded", async () => {
    world.saveQuery({ name: "my-query", clauses: [{ type: "with", component: "Agent" }] });
    render(QueryBuilder);
    await fireEvent.click(screen.getByTestId("query-toggle"));
    const saved = screen.getAllByTestId("saved-query");
    expect(saved).toHaveLength(1);
    expect(saved[0].textContent).toContain("my-query");
  });

  it("clicking saved query loads it", async () => {
    world.saveQuery({ name: "agents", clauses: [{ type: "with", component: "Agent" }] });
    render(QueryBuilder);
    await fireEvent.click(screen.getByTestId("query-toggle"));
    await fireEvent.click(screen.getByTestId("saved-query"));
    expect(world.hasActiveFilter).toBe(true);
    expect(world.matchCount).toBe(2);
  });

  it("updates suggestions when entity components change", async () => {
    render(QueryBuilder);
    await fireEvent.click(screen.getByTestId("query-toggle"));

    const input = screen.getByTestId("component-input") as HTMLInputElement;
    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: "Vel" } });
    expect(screen.queryByText("Velocity")).toBeNull();

    setWorldState([
      makeEntity(1, ["Agent", "Position"]),
      makeEntity(2, ["Velocity"]),
    ]);

    await waitFor(() => {
      expect(screen.getByText("Velocity")).toBeTruthy();
    });
  });

  it("does not suggest a component already used by the opposite clause type", async () => {
    world.setQuery({
      name: "",
      clauses: [{ type: "with", component: "Agent" }],
    });

    render(QueryBuilder);
    await fireEvent.click(screen.getByTestId("query-toggle"));
    await fireEvent.click(screen.getByTestId("clause-type-without"));

    const input = screen.getByTestId("component-input") as HTMLInputElement;
    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: "Ag" } });

    expect(screen.queryByText("Agent")).toBeNull();
  });
});
