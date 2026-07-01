import { describe, expect, it } from "vitest";
import { computeMetrics } from "../../src/logic/derived";
import type { SampleSchema } from "../../src/types";

const SKEW_SCHEMA: SampleSchema = {
  metrics: [],
  derived: [
    { name: "skew_ms", unit: "ms", expr: { minute_offset_ms: [{ var: "created_at" }] } },
  ],
};
const EMPTY_SCHEMA: SampleSchema = { metrics: [], derived: [] };
const MS = Date.UTC(2026, 6, 1, 14, 3, 0) + 87;

describe("computeMetrics", () => {
  it("computes a derived metric for a bare (null-metrics) sample", () => {
    expect(computeMetrics(null, SKEW_SCHEMA, MS)).toEqual({ skew_ms: 87 });
  });

  it("merges stored metrics with derived metrics", () => {
    expect(computeMetrics('{"p95_ms":12.4}', SKEW_SCHEMA, MS)).toEqual({
      p95_ms: 12.4,
      skew_ms: 87,
    });
  });

  it("returns null when there is nothing to emit", () => {
    expect(computeMetrics(null, EMPTY_SCHEMA, MS)).toBeNull();
  });

  it("treats invalid stored JSON as empty", () => {
    expect(computeMetrics("not json", SKEW_SCHEMA, MS)).toEqual({ skew_ms: 87 });
    expect(computeMetrics("not json", EMPTY_SCHEMA, MS)).toBeNull();
  });

  it("treats non-object stored JSON (array/number) as empty", () => {
    expect(computeMetrics("[1,2]", EMPTY_SCHEMA, MS)).toBeNull();
    expect(computeMetrics("5", EMPTY_SCHEMA, MS)).toBeNull();
  });

  it("lets a derived value win a name collision with a stored value", () => {
    expect(computeMetrics('{"skew_ms":999}', SKEW_SCHEMA, MS)).toEqual({
      skew_ms: 87,
    });
  });

  it("omits a derived field whose expression throws, without failing the read", () => {
    const schema: SampleSchema = {
      metrics: [],
      derived: [{ name: "x", expr: { no_such_op: [1] } }],
    };
    expect(computeMetrics('{"a":1}', schema, MS)).toEqual({ a: 1 });
  });

  it("omits a derived field that evaluates to a non-finite or non-numeric value", () => {
    const schema: SampleSchema = {
      metrics: [],
      derived: [
        { name: "inf", expr: { "/": [1, 0] } }, // Infinity
        { name: "str", expr: "hello" }, // non-numeric
      ],
    };
    expect(computeMetrics('{"a":1}', schema, MS)).toEqual({ a: 1 });
  });
});
