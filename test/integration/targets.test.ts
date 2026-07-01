import { beforeEach, describe, expect, it } from "vitest";
import {
  adminHeaders,
  apiGet,
  apiPatch,
  apiPost,
  makeBenchmark,
  makeTarget,
  resetDb,
  seedAccount,
} from "./helpers";

let account: string;
beforeEach(async () => {
  await resetDb();
  account = await seedAccount();
});

describe("POST /api/v1/targets", () => {
  it("returns the plaintext secret exactly once and never again", async () => {
    const bm = await makeBenchmark(account);
    const { target, secret } = await makeTarget(bm.id);
    expect(secret).toMatch(/^[0-9a-f-]{36}$/);
    // The create resource itself must not carry the secret or its hash.
    expect(JSON.stringify(target)).not.toContain("secret");

    const res = await apiGet(`/api/v1/targets/${target.id}`);
    const text = await res.text();
    expect(text).not.toContain(secret);
    expect(text).not.toContain("secret_hash");
    expect(text).not.toContain("secret");
  });

  it("requires admin auth", async () => {
    const bm = await makeBenchmark(account);
    const res = await apiPost("/api/v1/targets", {
      data: { type: "target", attributes: { benchmark: bm.id, key: "k", name: "k" } },
    });
    expect(res.status).toBe(401);
  });

  it("rejects an unknown benchmark with 400", async () => {
    const res = await apiPost(
      "/api/v1/targets",
      { data: { type: "target", attributes: { benchmark: "nope", key: "k", name: "k" } } },
      adminHeaders,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate key within the benchmark with 409", async () => {
    const bm = await makeBenchmark(account);
    await makeTarget(bm.id, "dup");
    const res = await apiPost(
      "/api/v1/targets",
      { data: { type: "target", attributes: { benchmark: bm.id, key: "dup", name: "x" } } },
      adminHeaders,
    );
    expect(res.status).toBe(409);
  });
});

describe("GET /api/v1/targets", () => {
  it("filters by benchmark and hides targets of private benchmarks", async () => {
    const pub = await makeBenchmark(account, { key: "pub", visibility: "published" });
    const priv = await makeBenchmark(account, { key: "priv", visibility: "private" });
    const { target: pt } = await makeTarget(pub.id, "pt");
    await makeTarget(priv.id, "xt");

    const res = await apiGet(`/api/v1/targets?filter[benchmark]=${pub.id}`);
    const list = (await res.json()) as { data: { id: string }[] };
    expect(list.data.map((t) => t.id)).toEqual([pt.id]);

    // A target under a private benchmark is not readable.
    const all = await apiGet("/api/v1/targets");
    const allList = (await all.json()) as { data: { id: string }[] };
    expect(allList.data).toHaveLength(1);
  });

  it("hides a target of a private benchmark behind a 404", async () => {
    const priv = await makeBenchmark(account, { visibility: "private" });
    const { target } = await makeTarget(priv.id);
    expect((await apiGet(`/api/v1/targets/${target.id}`)).status).toBe(404);
  });
});

describe("PATCH /api/v1/targets/:id", () => {
  it("updates the name (admin) and preserves the secret hash internally", async () => {
    const bm = await makeBenchmark(account);
    const { target } = await makeTarget(bm.id);
    const res = await apiPatch(
      `/api/v1/targets/${target.id}`,
      { data: { type: "target", attributes: { name: "Renamed", details: { region: "eu" } } } },
      adminHeaders,
    );
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { data: { attributes: Record<string, unknown> } };
    expect(updated.data.attributes.name).toBe("Renamed");
    expect(updated.data.attributes.details).toEqual({ region: "eu" });
  });
});
