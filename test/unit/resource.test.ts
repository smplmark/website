import { describe, expect, it } from "vitest";
import {
  serializeAccount,
  serializeBenchmark,
  serializeRun,
  serializeSample,
  serializeTarget,
} from "../../src/serialize/resource";
import type {
  AccountRow,
  BenchmarkRow,
  RunRow,
  SampleRow,
  SampleSchema,
  TargetRow,
} from "../../src/types";

const T0 = Date.UTC(2026, 6, 1, 9, 0, 0);

describe("serializeAccount", () => {
  it("emits key/name/description/url and ISO created_at", () => {
    const row: AccountRow = {
      id: "a1",
      key: "smplkit",
      name: "smplkit",
      description: "we build things",
      url: "https://smplkit.com",
      created_at: T0,
    };
    expect(serializeAccount(row)).toEqual({
      type: "account",
      id: "a1",
      attributes: {
        key: "smplkit",
        name: "smplkit",
        description: "we build things",
        url: "https://smplkit.com",
        created_at: "2026-07-01T09:00:00.000Z",
      },
    });
  });
});

describe("serializeBenchmark", () => {
  it("maps account_id -> account and parses sample_schema", () => {
    const row: BenchmarkRow = {
      id: "b1",
      account_id: "a1",
      key: "scheduler-latency",
      name: "Scheduler Latency",
      description: null,
      about: "the long story",
      methodology: "how it's measured",
      visibility: "published",
      sample_schema: JSON.stringify({ metrics: [], derived: [] }),
      created_at: T0,
      updated_at: T0,
    };
    const out = serializeBenchmark(row);
    expect(out.type).toBe("benchmark");
    expect(out.attributes.account).toBe("a1");
    expect(out.attributes.about).toBe("the long story");
    expect(out.attributes.methodology).toBe("how it's measured");
    expect(out.attributes.sample_schema).toEqual({ metrics: [], derived: [] });
    expect(out.attributes).not.toHaveProperty("account_id");
    expect(out.attributes.created_at).toBe("2026-07-01T09:00:00.000Z");
  });
});

describe("serializeTarget", () => {
  const row: TargetRow = {
    id: "t1",
    benchmark_id: "b1",
    key: "sched-a",
    name: "Scheduler A",
    details: JSON.stringify({ region: "us-east-1" }),
    secret_hash: "deadbeef",
    created_at: T0,
    updated_at: T0,
  };

  it("maps benchmark_id -> benchmark and parses details", () => {
    const out = serializeTarget(row);
    expect(out.attributes.benchmark).toBe("b1");
    expect(out.attributes.details).toEqual({ region: "us-east-1" });
  });

  it("never surfaces secret_hash", () => {
    const out = serializeTarget(row);
    expect(JSON.stringify(out)).not.toContain("secret_hash");
    expect(JSON.stringify(out)).not.toContain("deadbeef");
  });

  it("emits null details as null", () => {
    expect(serializeTarget({ ...row, details: null }).attributes.details).toBeNull();
  });
});

describe("serializeRun", () => {
  it("maps target_id -> target and passes a null name through", () => {
    const row: RunRow = {
      id: "r1",
      target_id: "t1",
      key: "default",
      name: null,
      details: null,
      created_at: T0,
      updated_at: T0,
    };
    const out = serializeRun(row);
    expect(out.attributes.target).toBe("t1");
    expect(out.attributes.name).toBeNull();
  });
});

describe("serializeSample", () => {
  const schema: SampleSchema = {
    metrics: [],
    derived: [{ name: "skew_ms", expr: { minute_offset_ms: [{ var: "created_at" }] } }],
  };
  const base: SampleRow = {
    id: 48213,
    run_id: "r1",
    created_at: T0 + 87,
    metrics: null,
    meta: null,
    client_ip: "203.0.113.7",
  };

  it("computes derived metrics, stringifies id, and never surfaces client_ip", () => {
    const out = serializeSample(base, schema);
    expect(out.id).toBe("48213");
    expect(out.attributes).toEqual({
      created_at: "2026-07-01T09:00:00.087Z",
      run: "r1",
      metrics: { skew_ms: 87 },
    });
    expect(JSON.stringify(out)).not.toContain("client_ip");
    expect(JSON.stringify(out)).not.toContain("203.0.113.7");
  });

  it("includes meta when non-empty", () => {
    const out = serializeSample(
      { ...base, meta: JSON.stringify({ commit: "a1b2c3d" }) },
      schema,
    );
    expect(out.attributes.meta).toEqual({ commit: "a1b2c3d" });
  });

  it("omits meta when it is null, an empty object, or an array", () => {
    expect(serializeSample(base, schema).attributes).not.toHaveProperty("meta");
    expect(
      serializeSample({ ...base, meta: "{}" }, schema).attributes,
    ).not.toHaveProperty("meta");
    expect(
      serializeSample({ ...base, meta: "[1,2]" }, schema).attributes,
    ).not.toHaveProperty("meta");
  });

  it("omits metrics entirely for a bare sample under an empty schema", () => {
    const out = serializeSample(base, { metrics: [], derived: [] });
    expect(out.attributes).not.toHaveProperty("metrics");
  });
});
