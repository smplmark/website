// Validate a client-supplied sample_schema (benchmark create/update only — never the hot path)
// and parse a stored one back. Enforces that metric names are unique across metrics + derived so
// the merged read surface is unambiguous (spec §4).
import { BadRequestError } from "../errors";
import type { DerivedDecl, MetricDecl, SampleSchema } from "../types";

function asArray(v: unknown, field: string): unknown[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    throw new BadRequestError(`sample_schema.${field} must be an array.`);
  }
  return v;
}

function nonEmptyString(v: unknown, field: string): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new BadRequestError(`${field} must be a non-empty string.`);
  }
  return v;
}

function asObject(v: unknown, field: string): Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new BadRequestError(`${field} must be an object.`);
  }
  return v as Record<string, unknown>;
}

export function validateSampleSchema(value: unknown): SampleSchema {
  const obj = asObject(value, "sample_schema");
  const metricsRaw = asArray(obj.metrics, "metrics");
  const derivedRaw = asArray(obj.derived, "derived");

  const metrics: MetricDecl[] = metricsRaw.map((m, i) => {
    const mm = asObject(m, `sample_schema.metrics[${i}]`);
    const decl: MetricDecl = {
      name: nonEmptyString(mm.name, `sample_schema.metrics[${i}].name`),
      type: nonEmptyString(mm.type, `sample_schema.metrics[${i}].type`),
    };
    if (mm.unit !== undefined) {
      decl.unit = nonEmptyString(mm.unit, `sample_schema.metrics[${i}].unit`);
    }
    if (mm.description !== undefined) {
      decl.description = nonEmptyString(
        mm.description,
        `sample_schema.metrics[${i}].description`,
      );
    }
    return decl;
  });

  const derived: DerivedDecl[] = derivedRaw.map((d, i) => {
    const dd = asObject(d, `sample_schema.derived[${i}]`);
    if (!("expr" in dd)) {
      throw new BadRequestError(`sample_schema.derived[${i}].expr is required.`);
    }
    const decl: DerivedDecl = {
      name: nonEmptyString(dd.name, `sample_schema.derived[${i}].name`),
      expr: dd.expr,
    };
    if (dd.unit !== undefined) {
      decl.unit = nonEmptyString(dd.unit, `sample_schema.derived[${i}].unit`);
    }
    if (dd.description !== undefined) {
      decl.description = nonEmptyString(
        dd.description,
        `sample_schema.derived[${i}].description`,
      );
    }
    return decl;
  });

  const seen = new Set<string>();
  for (const name of [
    ...metrics.map((m) => m.name),
    ...derived.map((d) => d.name),
  ]) {
    if (seen.has(name)) {
      throw new BadRequestError(
        `Duplicate metric name in sample_schema: ${JSON.stringify(name)}.`,
      );
    }
    seen.add(name);
  }

  return { metrics, derived };
}

/** Read a stored sample_schema JSON back into a normalized object (trusted DB value). */
export function parseSampleSchema(json: string): SampleSchema {
  const parsed = JSON.parse(json) as Partial<SampleSchema> | null;
  return {
    metrics: parsed?.metrics ?? [],
    derived: parsed?.derived ?? [],
  };
}
