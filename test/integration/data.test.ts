import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../../src/errors";
import { createBenchmark, listBenchmarks, updateBenchmark } from "../../src/data/benchmarks";
import { createTarget, listTargets, updateTarget } from "../../src/data/targets";
import { createRun, getRunTargetId, listRuns, updateRun } from "../../src/data/runs";
import { insertSample, listSamples } from "../../src/data/samples";
import type { DateRange } from "../../src/query/daterange";
import { resetDb, seedAccount, SKEW_SCHEMA } from "./helpers";

const OPEN: DateRange = { start: 0, startInclusive: true, end: null, endInclusive: false };

let account: string;
beforeEach(async () => {
  await resetDb();
  account = await seedAccount();
});

async function scaffold(visibility: "published" | "private" = "published") {
  const bm = await createBenchmark(env.DB, {
    account_id: account,
    key: `k-${visibility}`,
    name: "n",
    description: null,
    visibility,
    sample_schema: SKEW_SCHEMA,
  });
  const t = await createTarget(env.DB, {
    benchmark_id: bm.id,
    key: "t",
    name: "t",
    details: null,
    secret_hash: `hash-${visibility}`,
  });
  const r = await createRun(env.DB, { target_id: t.id, key: "r", name: null, details: null });
  return { bm, t, r };
}

describe("listBenchmarks branch coverage", () => {
  it("honours publishedOnly, filters, and includeTotal", async () => {
    await scaffold("published");
    await scaffold("private");

    const all = await listBenchmarks(env.DB, {
      publishedOnly: false,
      includeTotal: true,
      limit: 100,
      offset: 0,
    });
    expect(all.rows).toHaveLength(2);
    expect(all.total).toBe(2);

    const pub = await listBenchmarks(env.DB, {
      publishedOnly: true,
      includeTotal: false,
      limit: 100,
      offset: 0,
    });
    expect(pub.rows).toHaveLength(1);

    const byAccount = await listBenchmarks(env.DB, {
      filterAccount: account,
      filterKey: "k-published",
      publishedOnly: false,
      includeTotal: false,
      limit: 100,
      offset: 0,
    });
    expect(byAccount.rows).toHaveLength(1);
  });
});

describe("updateBenchmark branch coverage", () => {
  it("updates a single field, leaving others intact", async () => {
    const { bm } = await scaffold();
    const updated = await updateBenchmark(env.DB, bm.id, { visibility: "private" });
    expect(updated.visibility).toBe("private");
    expect(updated.name).toBe("n");
    expect(updated.sample_schema).toBe(bm.sample_schema);
  });

  it("throws NotFound for a missing benchmark", async () => {
    await expect(updateBenchmark(env.DB, "missing", {})).rejects.toBeInstanceOf(AppError);
  });
});

describe("targets & runs branch coverage", () => {
  it("lists targets with join, filters, and totals; updates a single field", async () => {
    const { bm, t } = await scaffold();
    const listed = await listTargets(env.DB, {
      filterBenchmark: bm.id,
      filterKey: "t",
      publishedOnly: true,
      includeTotal: true,
      limit: 100,
      offset: 0,
    });
    expect(listed.rows).toHaveLength(1);
    expect(listed.total).toBe(1);

    const updated = await updateTarget(env.DB, t.id, { name: "renamed" });
    expect(updated.name).toBe("renamed");
    await expect(updateTarget(env.DB, "missing", {})).rejects.toBeInstanceOf(AppError);
  });

  it("lists runs with filters and totals; updates; resolves run target id", async () => {
    const { t, r } = await scaffold();
    const listed = await listRuns(env.DB, {
      filterTarget: t.id,
      filterKey: "r",
      publishedOnly: true,
      includeTotal: true,
      limit: 100,
      offset: 0,
    });
    expect(listed.rows).toHaveLength(1);
    expect(listed.total).toBe(1);

    const updated = await updateRun(env.DB, r.id, { details: { note: "x" } });
    expect(updated.details).toBe('{"note":"x"}');
    await expect(updateRun(env.DB, "missing", {})).rejects.toBeInstanceOf(AppError);

    expect(await getRunTargetId(env.DB, r.id)).toBe(t.id);
    expect(await getRunTargetId(env.DB, "missing")).toBeNull();
  });
});

describe("listSamples scope branch coverage", () => {
  it("scopes by target and by benchmark, with and without publishedOnly", async () => {
    const { bm, t, r } = await scaffold();
    await insertSample(env.DB, {
      run_id: r.id,
      created_at: Date.UTC(2026, 5, 20),
      metrics: null,
      meta: null,
      client_ip: null,
    });

    const byTarget = await listSamples(env.DB, {
      range: OPEN,
      scope: { target: t.id },
      publishedOnly: true,
      includeTotal: true,
      limit: 100,
      offset: 0,
    });
    expect(byTarget.rows).toHaveLength(1);
    expect(byTarget.total).toBe(1);

    const byBenchmark = await listSamples(env.DB, {
      range: OPEN,
      scope: { benchmark: bm.id },
      publishedOnly: false,
      includeTotal: false,
      limit: 100,
      offset: 0,
    });
    expect(byBenchmark.rows).toHaveLength(1);
  });
});
