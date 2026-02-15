import type { EntitySnapshot } from "./types";

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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
      const fields = Object.keys(newComp!.data).map((key) => ({
        path: [key],
        oldValue: undefined,
        newValue: newComp!.data[key],
        type: "added" as const,
      }));
      components.push({ componentType: type, status: "added", fields });
    } else if (!newComp) {
      const fields = Object.keys(oldComp.data).map((key) => ({
        path: [key],
        oldValue: oldComp.data[key],
        newValue: undefined,
        type: "removed" as const,
      }));
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
