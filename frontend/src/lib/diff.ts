import type { ComponentSnapshot, EntitySnapshot, WorldSnapshot } from "./types";

export interface FieldChange {
  path: string[];
  oldValue: unknown;
  newValue: unknown;
  type: "added" | "removed" | "changed";
}

export interface ComponentChanges {
  componentType: string;
  status: "added" | "removed" | "modified";
  fields: FieldChange[];
}

export interface EntityDiff {
  entityId: number;
  components: ComponentChanges[];
  totalChanges: number;
}

export type EntityChangeType = "spawned" | "destroyed" | "modified";

export interface WorldDiffEntry {
  entityId: number;
  changeType: EntityChangeType;
  archetype: string[];
  entity: EntitySnapshot;
  components: ComponentChanges[];
  totalChanges: number;
}

export interface WorldDiffSummary {
  spawnedCount: number;
  destroyedCount: number;
  modifiedCount: number;
  totalFieldChanges: number;
}

export interface WorldDiff {
  t1: number;
  t2: number;
  summary: WorldDiffSummary;
  entries: WorldDiffEntry[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fieldsForValue(
  value: unknown,
  type: FieldChange["type"],
  path: string[] = [],
): FieldChange[] {
  if (isObject(value)) {
    return Object.entries(value).flatMap(([key, nestedValue]) =>
      fieldsForValue(nestedValue, type, [...path, key]),
    );
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      fieldsForValue(item, type, [...path, String(index)]),
    );
  }

  return [{
    path,
    oldValue: type === "removed" ? value : undefined,
    newValue: type === "added" ? value : undefined,
    type,
  }];
}

function fieldsForComponent(
  component: ComponentSnapshot,
  type: FieldChange["type"],
): FieldChange[] {
  return fieldsForValue(component.data, type);
}

function componentChangesForEntity(
  entity: EntitySnapshot,
  status: ComponentChanges["status"],
): ComponentChanges[] {
  const fieldType = status === "removed" ? "removed" : "added";

  return entity.components.map((component) => ({
    componentType: component.type_short,
    status,
    fields: fieldsForComponent(component, fieldType),
  }));
}

export function diffObjects(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
  prefix: string[] = [],
): FieldChange[] {
  const changes: FieldChange[] = [];
  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

  for (const key of allKeys) {
    const path = [...prefix, key];
    const hasOld = key in oldObj;
    const hasNew = key in newObj;
    const oldVal = oldObj[key];
    const newVal = newObj[key];

    if (!hasOld) {
      changes.push({ path, oldValue: undefined, newValue: newVal, type: "added" });
    } else if (!hasNew) {
      changes.push({ path, oldValue: oldVal, newValue: undefined, type: "removed" });
    } else if (isObject(oldVal) && isObject(newVal)) {
      changes.push(...diffObjects(oldVal, newVal, path));
    } else if (Array.isArray(oldVal) && Array.isArray(newVal)) {
      const maxLen = Math.max(oldVal.length, newVal.length);
      for (let i = 0; i < maxLen; i++) {
        const elemPath = [...path, String(i)];
        if (i >= oldVal.length) {
          changes.push({ path: elemPath, oldValue: undefined, newValue: newVal[i], type: "added" });
        } else if (i >= newVal.length) {
          changes.push({ path: elemPath, oldValue: oldVal[i], newValue: undefined, type: "removed" });
        } else if (isObject(oldVal[i]) && isObject(newVal[i])) {
          changes.push(
            ...diffObjects(
              oldVal[i] as Record<string, unknown>,
              newVal[i] as Record<string, unknown>,
              elemPath,
            ),
          );
        } else if (oldVal[i] !== newVal[i]) {
          changes.push({ path: elemPath, oldValue: oldVal[i], newValue: newVal[i], type: "changed" });
        }
      }
    } else if (oldVal !== newVal) {
      changes.push({ path, oldValue: oldVal, newValue: newVal, type: "changed" });
    }
  }

  return changes;
}

export function diffEntity(
  oldEntity: EntitySnapshot,
  newEntity: EntitySnapshot,
): EntityDiff {
  const components: ComponentChanges[] = [];
  const oldMap = new Map(oldEntity.components.map((c) => [c.type_short, c]));
  const newMap = new Map(newEntity.components.map((c) => [c.type_short, c]));
  const allTypes = new Set([...oldMap.keys(), ...newMap.keys()]);

  for (const type of allTypes) {
    const oldComp = oldMap.get(type);
    const newComp = newMap.get(type);

    if (!oldComp) {
      const fields = fieldsForComponent(newComp!, "added");
      components.push({ componentType: type, status: "added", fields });
    } else if (!newComp) {
      const fields = fieldsForComponent(oldComp, "removed");
      components.push({ componentType: type, status: "removed", fields });
    } else {
      const fields = diffObjects(oldComp.data, newComp.data);
      if (fields.length > 0) {
        components.push({ componentType: type, status: "modified", fields });
      }
    }
  }

  const totalChanges = components.reduce((sum, c) => sum + c.fields.length, 0);
  return { entityId: newEntity.id, components, totalChanges };
}

export function changedPaths(changes: FieldChange[]): Set<string> {
  return new Set(changes.map((c) => c.path.join(".")));
}

export function diffWorld(
  snapshot1: WorldSnapshot,
  snapshot2: WorldSnapshot,
): WorldDiff {
  const [olderSnapshot, newerSnapshot] = snapshot1.tick <= snapshot2.tick
    ? [snapshot1, snapshot2]
    : [snapshot2, snapshot1];

  const entries: WorldDiffEntry[] = [];
  const olderById = new Map(olderSnapshot.entities.map((entity) => [entity.id, entity]));
  const newerById = new Map(newerSnapshot.entities.map((entity) => [entity.id, entity]));

  for (const [entityId, entity] of newerById) {
    if (olderById.has(entityId)) continue;

    const components = componentChangesForEntity(entity, "added");
    entries.push({
      entityId,
      changeType: "spawned",
      archetype: entity.archetype,
      entity,
      components,
      totalChanges: components.reduce((sum, component) => sum + component.fields.length, 0),
    });
  }

  for (const [entityId, entity] of olderById) {
    if (newerById.has(entityId)) continue;

    const components = componentChangesForEntity(entity, "removed");
    entries.push({
      entityId,
      changeType: "destroyed",
      archetype: entity.archetype,
      entity,
      components,
      totalChanges: components.reduce((sum, component) => sum + component.fields.length, 0),
    });
  }

  for (const [entityId, newerEntity] of newerById) {
    const olderEntity = olderById.get(entityId);
    if (!olderEntity) continue;

    const diff = diffEntity(olderEntity, newerEntity);
    if (diff.totalChanges === 0) continue;

    entries.push({
      entityId,
      changeType: "modified",
      archetype: newerEntity.archetype,
      entity: newerEntity,
      components: diff.components,
      totalChanges: diff.totalChanges,
    });
  }

  entries.sort((left, right) => left.entityId - right.entityId);

  return {
    t1: olderSnapshot.tick,
    t2: newerSnapshot.tick,
    summary: {
      spawnedCount: entries.filter((entry) => entry.changeType === "spawned").length,
      destroyedCount: entries.filter((entry) => entry.changeType === "destroyed").length,
      modifiedCount: entries.filter((entry) => entry.changeType === "modified").length,
      totalFieldChanges: entries.reduce((sum, entry) => sum + entry.totalChanges, 0),
    },
    entries,
  };
}
