import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
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
});
