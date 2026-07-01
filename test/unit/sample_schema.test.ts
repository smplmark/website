import { describe, expect, it } from "vitest";
import { AppError } from "../../src/errors";
import {
  parseSampleSchema,
  validateSampleSchema,
} from "../../src/schema/sample_schema";

function expect400(fn: () => void) {
  expect(fn).toThrow(AppError);
  try {
    fn();
  } catch (e) {
    expect((e as AppError).status).toBe(400);
  }
}

describe("validateSampleSchema", () => {
  it("normalizes a full valid schema", () => {
    const out = validateSampleSchema({
      metrics: [{ name: "p95_ms", type: "number", unit: "ms" }],
      derived: [
        { name: "skew_ms", unit: "ms", expr: { minute_offset_ms: [{ var: "created_at" }] } },
      ],
    });
    expect(out).toEqual({
      metrics: [{ name: "p95_ms", type: "number", unit: "ms" }],
      derived: [
        { name: "skew_ms", unit: "ms", expr: { minute_offset_ms: [{ var: "created_at" }] } },
      ],
    });
  });

  it("defaults missing metrics/derived to empty arrays", () => {
    expect(validateSampleSchema({})).toEqual({ metrics: [], derived: [] });
  });

  it("keeps a metric without a unit and a derived without a unit", () => {
    const out = validateSampleSchema({
      metrics: [{ name: "n", type: "number" }],
      derived: [{ name: "d", expr: { var: "created_at" } }],
    });
    expect(out.metrics[0].unit).toBeUndefined();
    expect(out.derived[0].unit).toBeUndefined();
  });

  it.each([
    [null, "null value"],
    [["a"], "array value"],
    ["str", "string value"],
    [{ metrics: {} }, "metrics not an array"],
    [{ derived: 5 }, "derived not an array"],
    [{ metrics: [1] }, "metric not an object"],
    [{ metrics: [{ type: "number" }] }, "metric missing name"],
    [{ metrics: [{ name: "", type: "number" }] }, "metric empty name"],
    [{ metrics: [{ name: "x" }] }, "metric missing type"],
    [{ metrics: [{ name: "x", type: "number", unit: 5 }] }, "metric bad unit"],
    [{ derived: [1] }, "derived not an object"],
    [{ derived: [{ name: "x" }] }, "derived missing expr"],
    [{ derived: [{ expr: {} }] }, "derived missing name"],
    [{ derived: [{ name: "x", expr: {}, unit: 5 }] }, "derived bad unit"],
    [
      { metrics: [{ name: "dup", type: "number" }, { name: "dup", type: "number" }] },
      "duplicate within metrics",
    ],
    [
      {
        metrics: [{ name: "dup", type: "number" }],
        derived: [{ name: "dup", expr: {} }],
      },
      "duplicate across metrics and derived",
    ],
  ])("rejects %o (%s)", (value, _label) => {
    expect400(() => validateSampleSchema(value));
  });
});

describe("parseSampleSchema", () => {
  it("round-trips a stored schema", () => {
    const json = JSON.stringify({ metrics: [], derived: [{ name: "d", expr: {} }] });
    expect(parseSampleSchema(json)).toEqual({
      metrics: [],
      derived: [{ name: "d", expr: {} }],
    });
  });

  it("defaults null / missing keys to empty arrays", () => {
    expect(parseSampleSchema("null")).toEqual({ metrics: [], derived: [] });
    expect(parseSampleSchema("{}")).toEqual({ metrics: [], derived: [] });
  });
});
