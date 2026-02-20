import type { EntitySnapshot } from "./types";

export type ClauseType = "with" | "without";

export interface QueryClause {
  type: ClauseType;
  component: string;
}

export interface QueryDef {
  name: string;
  clauses: QueryClause[];
}

export function matchesQuery(
  entity: EntitySnapshot,
  query: QueryDef,
): boolean {
  if (query.clauses.length === 0) return true;

  const components = new Set(entity.archetype);

  for (const clause of query.clauses) {
    const has = components.has(clause.component);
    if (clause.type === "with" && !has) return false;
    if (clause.type === "without" && has) return false;
  }
  return true;
}

export function getAvailableComponents(
  entities: EntitySnapshot[],
): string[] {
  const types = new Set<string>();
  for (const entity of entities) {
    for (const name of entity.archetype) {
      types.add(name);
    }
  }
  return [...types].sort();
}

export function filterSuggestions(
  available: string[],
  input: string,
  exclude: Set<string>,
): string[] {
  const lower = input.toLowerCase();
  return available.filter(
    (c) => c.toLowerCase().includes(lower) && !exclude.has(c),
  );
}

export function queryMatchCount(
  entities: EntitySnapshot[],
  query: QueryDef,
): number {
  let count = 0;
  for (const entity of entities) {
    if (matchesQuery(entity, query)) count++;
  }
  return count;
}

export function matchingEntityIds(
  entities: EntitySnapshot[],
  query: QueryDef,
): Set<number> {
  const ids = new Set<number>();
  for (const entity of entities) {
    if (matchesQuery(entity, query)) ids.add(entity.id);
  }
  return ids;
}
