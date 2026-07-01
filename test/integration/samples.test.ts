import { beforeEach, describe, expect, it } from "vitest";
import { clearCache } from "../../src/auth/ingest_cache";
import {
  apiGet,
  apiPost,
  makeBenchmark,
  makeRun,
  makeTarget,
  resetDb,
  seedAccount,
} from "./helpers";

let account: string;
let runId: string;
let secret: string;

beforeEach(async () => {
  clearCache();
  await resetDb();
  account = await seedAccount();
  const bm = await makeBenchmark(account);
  const t = await makeTarget(bm.id);
  secret = t.secret;
  runId = (await makeRun(t.target.id)).id;
});

function ingestAt(
  createdAt: string,
  metrics?: Record<string, number>,
  run = runId,
  sec = secret,
) {
  return apiPost(
    `/api/v1/runs/${run}/samples`,
    { data: { type: "sample", attributes: { created_at: createdAt, ...(metrics ? { metrics } : {}) } } },
    { Authorization: `Bearer ${sec}` },
  );
}

const WINDOW = "[2026-06-01T00:00:00Z,2026-06-30T00:00:00Z)";

interface SampleDoc {
  data: { id: string; attributes: { created_at: string; metrics: Record<string, number> } }[];
  meta: { pagination: { page: number; size: number; total?: number; total_pages?: number } };
}

describe("GET /api/v1/samples — validation", () => {
  it("requires filter[created_at]", async () => {
    expect((await apiGet("/api/v1/samples")).status).toBe(400);
  });

  it("rejects a window wider than 30 days", async () => {
    const res = await apiGet(
      "/api/v1/samples?filter[created_at]=[2026-05-01T00:00:00Z,2026-06-15T00:00:00Z)",
    );
    expect(res.status).toBe(400);
  });

  it("rejects an open-ended upper bound older than 30 days", async () => {
    const res = await apiGet("/api/v1/samples?filter[created_at]=[2026-01-01T00:00:00Z,*)");
    expect(res.status).toBe(400);
  });

  it("rejects more than one scope filter", async () => {
    const res = await apiGet(
      `/api/v1/samples?filter[created_at]=${WINDOW}&filter[run]=a&filter[target]=b`,
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/samples — read", () => {
  it("computes skew on read, merges stored metrics, and sorts by (created_at, id)", async () => {
    await ingestAt("2026-06-20T09:00:00.250Z"); // skew 250
    await ingestAt("2026-06-20T09:00:00.100Z", { p95_ms: 5 }); // skew 100 + stored
    await ingestAt("2026-06-20T09:00:15.000Z"); // skew 15000

    const res = await apiGet(`/api/v1/samples?filter[created_at]=${WINDOW}&filter[run]=${runId}`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as SampleDoc;
    const skews = doc.data.map((s) => s.attributes.metrics.skew_ms);
    expect(skews).toEqual([100, 250, 15000]); // sorted ascending by created_at
    expect(doc.data[0].attributes.metrics).toEqual({ p95_ms: 5, skew_ms: 100 });
  });

  it("breaks same-millisecond ties by id (rowid) ascending", async () => {
    const first = await ingestAt("2026-06-20T09:00:05.000Z");
    const second = await ingestAt("2026-06-20T09:00:05.000Z");
    const firstId = ((await first.json()) as { data: { id: string } }).data.id;
    const secondId = ((await second.json()) as { data: { id: string } }).data.id;

    const res = await apiGet(`/api/v1/samples?filter[created_at]=${WINDOW}&filter[run]=${runId}`);
    const doc = (await res.json()) as SampleDoc;
    expect(doc.data.map((s) => s.id)).toEqual([firstId, secondId]);
    expect(Number(firstId)).toBeLessThan(Number(secondId));
  });

  it("negotiates CSV via Accept and sets Vary: Accept", async () => {
    await ingestAt("2026-06-20T09:00:00.087Z");

    const csv = await apiGet(`/api/v1/samples?filter[created_at]=${WINDOW}&filter[run]=${runId}`, {
      Accept: "text/csv",
    });
    expect(csv.status).toBe(200);
    expect(csv.headers.get("Content-Type")).toContain("text/csv");
    expect(csv.headers.get("Vary")).toBe("Accept");
    const text = await csv.text();
    expect(text.split("\r\n")[0]).toBe("id,created_at,run,skew_ms,meta");
    expect(text.split("\r\n")[1]).toContain(",87,");

    const jsonRes = await apiGet(`/api/v1/samples?filter[created_at]=${WINDOW}&filter[run]=${runId}`);
    expect(jsonRes.headers.get("Vary")).toBe("Accept");
    expect(jsonRes.headers.get("Content-Type")).toContain("application/vnd.api+json");
  });

  it("paginates and reports totals when asked", async () => {
    await ingestAt("2026-06-20T09:00:00.001Z");
    await ingestAt("2026-06-20T09:00:00.002Z");
    await ingestAt("2026-06-20T09:00:00.003Z");

    const res = await apiGet(
      `/api/v1/samples?filter[created_at]=${WINDOW}&filter[run]=${runId}&page[size]=2&meta[total]=true`,
    );
    const doc = (await res.json()) as SampleDoc;
    expect(doc.data).toHaveLength(2);
    expect(doc.meta.pagination).toEqual({ page: 1, size: 2, total: 3, total_pages: 2 });
  });

  it("excludes samples belonging to private benchmarks", async () => {
    await ingestAt("2026-06-20T09:00:00.010Z"); // public

    const privBm = await makeBenchmark(account, { key: "priv", visibility: "private" });
    const privT = await makeTarget(privBm.id, "pt");
    const privRun = await makeRun(privT.target.id, "pr");
    await ingestAt("2026-06-20T09:00:00.020Z", undefined, privRun.id, privT.secret);

    const res = await apiGet(`/api/v1/samples?filter[created_at]=${WINDOW}`);
    const doc = (await res.json()) as SampleDoc;
    expect(doc.data).toHaveLength(1);
    expect(doc.data[0].attributes.metrics.skew_ms).toBe(10);
  });
});
