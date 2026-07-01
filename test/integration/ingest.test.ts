import { env } from "cloudflare:test";
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

let runId: string;
let secret: string;

beforeEach(async () => {
  clearCache();
  await resetDb();
  const account = await seedAccount();
  const bm = await makeBenchmark(account);
  const t = await makeTarget(bm.id);
  secret = t.secret;
  runId = (await makeRun(t.target.id)).id;
});

function ingest(
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) {
  return apiPost(path, body, headers);
}

const bearer = (s: string) => ({ Authorization: `Bearer ${s}` });

describe("POST /api/v1/runs/:id/samples — ingest", () => {
  it("accepts an empty-body beacon, stamps created_at, and computes skew on read", async () => {
    const res = await ingest(`/api/v1/runs/${runId}/samples`, bearer(secret));
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as {
      data: { id: string; attributes: { created_at: string; run: string; metrics: { skew_ms: number } } };
    };
    expect(data.attributes.run).toBe(runId);
    expect(Date.parse(data.attributes.created_at)).toBeGreaterThan(Date.now() - 60_000);
    expect(data.attributes.metrics.skew_ms).toBeGreaterThanOrEqual(0);
    expect(data.attributes.metrics.skew_ms).toBeLessThan(60_000);
  });

  it("captures CF-Connecting-IP internally but never surfaces it", async () => {
    const res = await ingest(`/api/v1/runs/${runId}/samples`, {
      ...bearer(secret),
      "CF-Connecting-IP": "203.0.113.9",
    });
    const text = await res.text();
    expect(text).not.toContain("203.0.113.9");
    expect(text).not.toContain("client_ip");

    const row = await env.DB.prepare(
      "SELECT client_ip FROM sample WHERE run_id = ?",
    )
      .bind(runId)
      .first<{ client_ip: string }>();
    expect(row?.client_ip).toBe("203.0.113.9");
  });

  it("accepts a bulk sample with client-supplied created_at, metrics, and meta", async () => {
    const createdAt = "2026-06-15T09:00:00.000Z";
    const res = await ingest(`/api/v1/runs/${runId}/samples`, bearer(secret), {
      data: {
        type: "sample",
        attributes: {
          created_at: createdAt,
          metrics: { p95_ms: 12.4 },
          meta: { commit: "a1b2c3d" },
        },
      },
    });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as {
      data: { attributes: { created_at: string; metrics: Record<string, number>; meta: unknown } };
    };
    expect(data.attributes.created_at).toBe(createdAt);
    // stored p95_ms merged with derived skew_ms (top of the minute -> 0)
    expect(data.attributes.metrics).toEqual({ p95_ms: 12.4, skew_ms: 0 });
    expect(data.attributes.meta).toEqual({ commit: "a1b2c3d" });
  });

  it("rejects an out-of-range created_at with 400, never a 500", async () => {
    const res = await ingest(`/api/v1/runs/${runId}/samples`, bearer(secret), {
      data: { type: "sample", attributes: { created_at: 1e18 } },
    });
    expect(res.status).toBe(400);
  });

  it("treats a timezone-less client created_at as UTC", async () => {
    const res = await ingest(`/api/v1/runs/${runId}/samples`, bearer(secret), {
      data: { type: "sample", attributes: { created_at: "2026-06-15T09:00:00" } },
    });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { attributes: { created_at: string } } };
    expect(data.attributes.created_at).toBe("2026-06-15T09:00:00.000Z");
  });

  it("returns a byte-identical uniform 401 for every auth failure", async () => {
    // Set up a second target/run to exercise the run/target-mismatch case.
    const account2 = await env.DB.prepare("SELECT id FROM account LIMIT 1").first<{ id: string }>();
    const bm2 = await makeBenchmark(account2!.id, { key: "other" });
    const t2 = await makeTarget(bm2.id, "t2");
    const otherRun = await makeRun(t2.target.id, "r2");

    const cases: Array<[string, Record<string, string>]> = [
      ["no header", {}],
      ["wrong scheme", { Authorization: "Basic abc123" }],
      ["empty bearer", { Authorization: "Bearer " }],
      ["unknown secret", bearer("00000000-0000-0000-0000-000000000000")],
      ["run belongs to another target", bearer(t2.secret)], // valid secret, wrong run below
    ];

    const bodies: string[] = [];
    let status = 0;
    for (const [, headers] of cases) {
      const res = await ingest(`/api/v1/runs/${runId}/samples`, headers);
      status = res.status;
      expect(res.status).toBe(401);
      bodies.push(await res.text());
    }
    // Also: correct secret but a run under a different target.
    const mismatch = await ingest(`/api/v1/runs/${otherRun.id}/samples`, bearer(secret));
    expect(mismatch.status).toBe(401);
    bodies.push(await mismatch.text());

    expect(status).toBe(401);
    for (const b of bodies) expect(b).toBe(bodies[0]);
    expect(bodies[0]).toContain('"status":"401"');
  });

  it("authenticates a target created after the isolate warmed (positives-only cache)", async () => {
    // Warm the cache with the first target's secret.
    expect((await ingest(`/api/v1/runs/${runId}/samples`, bearer(secret))).status).toBe(201);

    // A brand-new target + run created afterwards must authenticate on its very next request.
    const account = await env.DB.prepare("SELECT id FROM account LIMIT 1").first<{ id: string }>();
    const bm = await makeBenchmark(account!.id, { key: "fresh" });
    const fresh = await makeTarget(bm.id, "fresh");
    const freshRun = await makeRun(fresh.target.id, "fresh");
    const res = await ingest(`/api/v1/runs/${freshRun.id}/samples`, bearer(fresh.secret));
    expect(res.status).toBe(201);
  });

  it("serves repeated ingests for the same secret (warm cache)", async () => {
    const first = await ingest(`/api/v1/runs/${runId}/samples`, bearer(secret));
    const second = await ingest(`/api/v1/runs/${runId}/samples`, bearer(secret));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const lower = new Date(Date.now() - 86_400_000).toISOString();
    const upper = new Date(Date.now() + 86_400_000).toISOString();
    const count = await apiGet(
      `/api/v1/samples?filter[created_at]=[${lower},${upper})&filter[run]=${runId}&meta[total]=true`,
    );
    const body = (await count.json()) as { meta: { pagination: { total: number } } };
    expect(body.meta.pagination.total).toBe(2);
  });
});
