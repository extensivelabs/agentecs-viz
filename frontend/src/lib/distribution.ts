import type { EntitySnapshot } from "./types";

export type FieldType = "numeric" | "categorical";

export interface CategoricalBin {
  value: string;
  count: number;
  entityIds: number[];
}

export interface NumericBin {
  min: number;
  max: number;
  count: number;
  entityIds: number[];
  label: string;
}

export interface CategoricalDistribution {
  type: "categorical";
  component: string;
  field: string;
  bins: CategoricalBin[];
  totalWithComponent: number;
  missingCount: number;
}

export interface NumericDistribution {
  type: "numeric";
  component: string;
  field: string;
  bins: NumericBin[];
  totalWithComponent: number;
  missingCount: number;
  min: number;
  max: number;
}

export type Distribution = CategoricalDistribution | NumericDistribution;

type SampledFieldValue = {
  entityId: number;
  value: unknown;
};

const DEFAULT_BUCKET_COUNT = 8;

function getComponentData(
  entity: EntitySnapshot,
  component: string,
): Record<string, unknown> | null {
  const componentSnapshot = entity.components.find(
    (candidate) => candidate.type_short === component,
  );
  return componentSnapshot ? componentSnapshot.data : null;
}

function collectComponentFieldValues(
  entities: EntitySnapshot[],
  component: string,
  field: string,
): {
  totalWithComponent: number;
  missingCount: number;
  values: SampledFieldValue[];
} {
  const values: SampledFieldValue[] = [];
  let totalWithComponent = 0;
  let missingCount = 0;

  for (const entity of entities) {
    const data = getComponentData(entity, component);
    if (!data) continue;

    totalWithComponent += 1;
    const value = data[field];
    if (value === undefined || value === null) {
      missingCount += 1;
      continue;
    }

    values.push({ entityId: entity.id, value });
  }

  return { totalWithComponent, missingCount, values };
}

function detectFieldTypeFromValues(values: SampledFieldValue[]): FieldType {
  let sawNumber = false;

  for (const entry of values) {
    if (typeof entry.value === "number" && Number.isFinite(entry.value)) {
      sawNumber = true;
      continue;
    }
    return "categorical";
  }

  return sawNumber ? "numeric" : "categorical";
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return String(value);

  const rounded = value.toFixed(2);
  return rounded.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function formatRangeLabel(min: number, max: number): string {
  return `${formatNumber(min)}-${formatNumber(max)}`;
}

function asCategoricalDistribution(
  component: string,
  field: string,
  values: SampledFieldValue[],
  totalWithComponent: number,
  missingCount: number,
): CategoricalDistribution {
  const binsByValue = new Map<string, CategoricalBin>();

  for (const entry of values) {
    const key = String(entry.value);
    const existing = binsByValue.get(key);
    if (existing) {
      existing.count += 1;
      existing.entityIds.push(entry.entityId);
      continue;
    }

    binsByValue.set(key, {
      value: key,
      count: 1,
      entityIds: [entry.entityId],
    });
  }

  const bins = [...binsByValue.values()].sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    return left.value.localeCompare(right.value);
  });

  return {
    type: "categorical",
    component,
    field,
    bins,
    totalWithComponent,
    missingCount,
  };
}

function asNumericDistribution(
  component: string,
  field: string,
  values: SampledFieldValue[],
  totalWithComponent: number,
  missingCount: number,
  bucketCount: number,
): NumericDistribution {
  const numericValues = values as Array<{ entityId: number; value: number }>;
  const min = Math.min(...numericValues.map((entry) => entry.value));
  const max = Math.max(...numericValues.map((entry) => entry.value));

  if (min === max) {
    return {
      type: "numeric",
      component,
      field,
      bins: [
        {
          min,
          max,
          count: numericValues.length,
          entityIds: numericValues.map((entry) => entry.entityId),
          label: formatNumber(min),
        },
      ],
      totalWithComponent,
      missingCount,
      min,
      max,
    };
  }

  const safeBucketCount = Math.max(1, Math.floor(bucketCount));
  const width = (max - min) / safeBucketCount;

  const bins: NumericBin[] = Array.from({ length: safeBucketCount }, (_, index) => {
    const bucketMin = min + index * width;
    const bucketMax = index === safeBucketCount - 1
      ? max
      : min + (index + 1) * width;

    return {
      min: bucketMin,
      max: bucketMax,
      count: 0,
      entityIds: [],
      label: formatRangeLabel(bucketMin, bucketMax),
    };
  });

  for (const entry of numericValues) {
    const normalized = (entry.value - min) / width;
    const bucketIndex = Math.min(
      safeBucketCount - 1,
      Math.max(0, Math.floor(normalized)),
    );

    bins[bucketIndex].count += 1;
    bins[bucketIndex].entityIds.push(entry.entityId);
  }

  return {
    type: "numeric",
    component,
    field,
    bins,
    totalWithComponent,
    missingCount,
    min,
    max,
  };
}

export function getFieldsForComponent(
  entities: EntitySnapshot[],
  component: string,
): string[] {
  const fields = new Set<string>();

  for (const entity of entities) {
    const data = getComponentData(entity, component);
    if (!data) continue;

    for (const fieldName of Object.keys(data)) {
      fields.add(fieldName);
    }
  }

  return [...fields].sort();
}

export function detectFieldType(
  entities: EntitySnapshot[],
  component: string,
  field: string,
): FieldType {
  const { values } = collectComponentFieldValues(entities, component, field);
  return detectFieldTypeFromValues(values);
}

export function computeDistribution(
  entities: EntitySnapshot[],
  component: string,
  field: string,
  bucketCount = DEFAULT_BUCKET_COUNT,
): Distribution {
  const { totalWithComponent, missingCount, values } = collectComponentFieldValues(
    entities,
    component,
    field,
  );

  const fieldType = detectFieldTypeFromValues(values);
  if (fieldType === "categorical") {
    return asCategoricalDistribution(
      component,
      field,
      values,
      totalWithComponent,
      missingCount,
    );
  }

  return asNumericDistribution(
    component,
    field,
    values,
    totalWithComponent,
    missingCount,
    bucketCount,
  );
}
