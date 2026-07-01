// Compute-on-read: merge a sample's stored metrics with its benchmark's derived metrics into one
// flat object. The consumer can't tell stored from derived — that split lives only in sample_schema
// and is the publisher's business (spec §4).
import type { SampleSchema } from "../types";
import { applyRule } from "./evaluator";

function parseStored(metricsJson: string | null): Record<string, unknown> {
  if (metricsJson === null) return {};
  try {
    const parsed: unknown = JSON.parse(metricsJson);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // stored metrics are written by us as a JSON object; anything else is treated as empty.
  }
  return {};
}

/**
 * Merge stored + derived. Derived values (schema-controlled) win on name collision. A per-row
 * expression error omits that one field rather than failing the read (never a 5xx — ADR-014).
 * Returns null when there is nothing to emit, so the serializer can omit `metrics` entirely.
 */
export function computeMetrics(
  metricsJson: string | null,
  schema: SampleSchema,
  createdAt: number,
): Record<string, unknown> | null {
  const merged: Record<string, unknown> = { ...parseStored(metricsJson) };
  for (const d of schema.derived) {
    try {
      const value = applyRule(d.expr, { created_at: createdAt });
      // Derived metrics are numeric. A non-finite/non-numeric result (NaN, Infinity, a division by
      // zero) is omitted rather than serialized as JSON null — same as a thrown expression.
      if (typeof value === "number" && Number.isFinite(value)) {
        merged[d.name] = value;
      }
    } catch {
      // omit this derived field
    }
  }
  return Object.keys(merged).length > 0 ? merged : null;
}
