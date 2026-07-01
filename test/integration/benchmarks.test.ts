import { beforeEach, describe, expect, it } from "vitest";
import {
  SKEW_SCHEMA,
  adminHeaders,
  apiGet,
  apiPatch,
  apiPost,
  makeBenchmark,
  resetDb,
  seedAccount,
} from "./helpers";

let account: string;
beforeEach(async () => {
  await resetDb();
  account = await seedAccount();
});

const body = (attrs: Record<string, unknown>) => ({
  data: { type: "benchmark", attributes: attrs },
});

describe("POST /api/v1/benchmarks", () => {
  it("requires admin auth", async () => {
    const res = await apiPost("/api/v1/benchmarks", body({ account, key: "k", name: "n" }));
    expect(res.status).toBe(401);
  });

  it("creates a benchmark with a bare account ref and parsed sample_schema", async () => {
    const bm = await makeBenchmark(account);
    expect(bm.attributes.account).toBe(account);
    expect(bm.attributes.visibility).toBe("published");
    expect(bm.attributes.sample_schema).toEqual(SKEW_SCHEMA);
    expect(bm.attributes.description).toBeNull();
  });

  it("defaults visibility to private", async () => {
    const bm = await makeBenchmark(account, { key: "priv", visibility: undefined });
    expect(bm.attributes.visibility).toBe("private");
  });

  it("rejects an unknown account with 400", async () => {
    const res = await apiPost(
      "/api/v1/benchmarks",
      body({ account: "nope", key: "k", name: "n" }),
      adminHeaders,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate key within the account with 409", async () => {
    await makeBenchmark(account);
    const res = await apiPost(
      "/api/v1/benchmarks",
      body({ account, key: "scheduler-latency", name: "again" }),
      adminHeaders,
    );
    expect(res.status).toBe(409);
  });

  it("rejects a missing required field with 400", async () => {
    const res = await apiPost("/api/v1/benchmarks", body({ account, key: "k" }), adminHeaders);
    expect(res.status).toBe(400);
  });

  it("rejects an invalid sample_schema (duplicate metric name) with 400", async () => {
    const res = await apiPost(
      "/api/v1/benchmarks",
      body({
        account,
        key: "k",
        name: "n",
        sample_schema: {
          metrics: [{ name: "dup", type: "number" }],
          derived: [{ name: "dup", expr: {} }],
        },
      }),
      adminHeaders,
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/benchmarks", () => {
  it("lists only published benchmarks", async () => {
    await makeBenchmark(account, { key: "pub", visibility: "published" });
    await makeBenchmark(account, { key: "priv", visibility: "private" });
    const res = await apiGet("/api/v1/benchmarks");
    expect(res.headers.get("Content-Type")).toContain("application/vnd.api+json");
    const list = (await res.json()) as { data: { attributes: { key: string } }[]; meta: unknown };
    expect(list.data.map((b) => b.attributes.key)).toEqual(["pub"]);
    expect(list.meta).toEqual({ pagination: { page: 1, size: 1000 } });
  });

  it("supports filter[key]", async () => {
    await makeBenchmark(account, { key: "a" });
    await makeBenchmark(account, { key: "b" });
    const res = await apiGet("/api/v1/benchmarks?filter[key]=b");
    const list = (await res.json()) as { data: { attributes: { key: string } }[] };
    expect(list.data).toHaveLength(1);
    expect(list.data[0].attributes.key).toBe("b");
  });
});

describe("GET /api/v1/benchmarks/:id", () => {
  it("returns a published benchmark", async () => {
    const bm = await makeBenchmark(account);
    const res = await apiGet(`/api/v1/benchmarks/${bm.id}`);
    expect(res.status).toBe(200);
  });

  it("hides a private benchmark behind a 404", async () => {
    const bm = await makeBenchmark(account, { visibility: "private" });
    const res = await apiGet(`/api/v1/benchmarks/${bm.id}`);
    expect(res.status).toBe(404);
  });

  it("404s an unknown id", async () => {
    expect((await apiGet("/api/v1/benchmarks/missing")).status).toBe(404);
  });
});

describe("PATCH /api/v1/benchmarks/:id", () => {
  it("publishes a private benchmark (admin)", async () => {
    const bm = await makeBenchmark(account, { visibility: "private" });
    const res = await apiPatch(
      `/api/v1/benchmarks/${bm.id}`,
      { data: { type: "benchmark", attributes: { visibility: "published", description: "now live" } } },
      adminHeaders,
    );
    expect(res.status).toBe(200);
    expect((await apiGet(`/api/v1/benchmarks/${bm.id}`)).status).toBe(200);
  });

  it("requires admin auth", async () => {
    const bm = await makeBenchmark(account);
    const res = await apiPatch(`/api/v1/benchmarks/${bm.id}`, {
      data: { type: "benchmark", attributes: { name: "x" } },
    });
    expect(res.status).toBe(401);
  });
});
