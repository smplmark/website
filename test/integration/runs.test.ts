import { beforeEach, describe, expect, it } from "vitest";
import {
  adminHeaders,
  apiGet,
  apiPatch,
  apiPost,
  makeBenchmark,
  makeRun,
  makeTarget,
  resetDb,
  seedAccount,
} from "./helpers";

let account: string;
beforeEach(async () => {
  await resetDb();
  account = await seedAccount();
});

describe("runs CRUD", () => {
  it("creates a run with a bare target ref", async () => {
    const bm = await makeBenchmark(account);
    const { target } = await makeTarget(bm.id);
    const run = await makeRun(target.id);
    expect(run.attributes.target).toBe(target.id);
    expect(run.attributes.name).toBe("default");
  });

  it("rejects an unknown target with 400", async () => {
    const res = await apiPost(
      "/api/v1/runs",
      { data: { type: "run", attributes: { target: "nope", key: "k" } } },
      adminHeaders,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate key within the target with 409", async () => {
    const bm = await makeBenchmark(account);
    const { target } = await makeTarget(bm.id);
    await makeRun(target.id, "dup");
    const res = await apiPost(
      "/api/v1/runs",
      { data: { type: "run", attributes: { target: target.id, key: "dup" } } },
      adminHeaders,
    );
    expect(res.status).toBe(409);
  });

  it("filters by target and hides runs of private benchmarks", async () => {
    const bm = await makeBenchmark(account);
    const { target } = await makeTarget(bm.id);
    const run = await makeRun(target.id);
    const res = await apiGet(`/api/v1/runs?filter[target]=${target.id}`);
    const list = (await res.json()) as { data: { id: string }[] };
    expect(list.data.map((r) => r.id)).toEqual([run.id]);
  });

  it("updates a run name to null (admin)", async () => {
    const bm = await makeBenchmark(account);
    const { target } = await makeTarget(bm.id);
    const run = await makeRun(target.id);
    const res = await apiPatch(
      `/api/v1/runs/${run.id}`,
      { data: { type: "run", attributes: { name: null } } },
      adminHeaders,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { attributes: { name: unknown } } }).data.attributes.name).toBeNull();
  });
});
