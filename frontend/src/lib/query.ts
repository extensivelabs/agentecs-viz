import type { EntitySnapshot } from "./types";

export type ClauseType = "with" | "without" | "value_eq" | "value_range";

export interface QueryClause {
  type: ClauseType;
  component: string;
  field?: string;
  value?: string;
  min?: number;
  max?: number;
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

  for (const clause of query.clauses) {
    const has = entity.archetype.includes(clause.component);

    if (clause.type === "with") {
      if (!has) return false;
      continue;
    }

    if (clause.type === "without") {
      if (has) return false;
      continue;
    }

    const component = entity.components.find(
      (candidate) => candidate.type_short === clause.component,
    );

    if (clause.type === "value_eq") {
      if (!component || clause.field === undefined || clause.value === undefined) {
        return false;
      }

      const value = component.data[clause.field];
      if (value === undefined || value === null) return false;
      if (String(value) !== clause.value) return false;
      continue;
    }

    if (!component || clause.field === undefined) return false;
    const value = component.data[clause.field];
    if (typeof value !== "number") return false;

    const min = clause.min ?? -Infinity;
    const max = clause.max ?? Infinity;
    if (value < min || value >= max) return false;
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
