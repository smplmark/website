import { SELF, env } from "cloudflare:test";
import { expect } from "vitest";
import type { SampleSchema } from "../../src/types";

export const ADMIN_TOKEN = "dev-stub-admin-token";
export const adminHeaders = { Authorization: `Bearer ${ADMIN_TOKEN}` };
export const JSONAPI = "application/vnd.api+json";

export const SKEW_SCHEMA: SampleSchema = {
  metrics: [],
  derived: [
    { name: "skew_ms", unit: "ms", expr: { minute_offset_ms: [{ var: "created_at" }] } },
  ],
};

const TABLES = ["sample", "run", "target", "benchmark", "account"] as const;

export async function resetDb(): Promise<void> {
  for (const t of TABLES) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
}

export async function seedAccount(id = "acct-smplkit", key = "smplkit"): Promise<string> {
  await env.DB.prepare(
    "INSERT INTO account (id, key, name, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(id, key, "smplkit", 1_700_000_000_000)
    .run();
  return id;
}

const base = (path: string) => `http://smplmark.test${path}`;

export function apiGet(path: string, headers: Record<string, string> = {}) {
  return SELF.fetch(base(path), { headers });
}

export function apiPost(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return SELF.fetch(base(path), {
    method: "POST",
    headers: { "Content-Type": JSONAPI, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function apiPatch(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return SELF.fetch(base(path), {
    method: "PATCH",
    headers: { "Content-Type": JSONAPI, ...headers },
    body: JSON.stringify(body),
  });
}

interface Resource {
  type: string;
  id: string;
  attributes: Record<string, unknown>;
}

/** Create a published benchmark; returns its resource. */
export async function makeBenchmark(
  account: string,
  attrs: Record<string, unknown> = {},
): Promise<Resource> {
  const res = await apiPost(
    "/api/v1/benchmarks",
    {
      data: {
        type: "benchmark",
        attributes: {
          account,
          key: "scheduler-latency",
          name: "Scheduler Latency",
          visibility: "published",
          sample_schema: SKEW_SCHEMA,
          ...attrs,
        },
      },
    },
    adminHeaders,
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { data: Resource }).data;
}

/** Create a target; returns { target, secret } (the plaintext secret from the create response). */
export async function makeTarget(
  benchmarkId: string,
  key = "sched-a",
): Promise<{ target: Resource; secret: string }> {
  const res = await apiPost(
    "/api/v1/targets",
    { data: { type: "target", attributes: { benchmark: benchmarkId, key, name: key } } },
    adminHeaders,
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { data: Resource; meta: { secret: string } };
  return { target: body.data, secret: body.meta.secret };
}

/** Create a run; returns its resource. */
export async function makeRun(targetId: string, key = "default"): Promise<Resource> {
  const res = await apiPost(
    "/api/v1/runs",
    { data: { type: "run", attributes: { target: targetId, key, name: key } } },
    adminHeaders,
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { data: Resource }).data;
}
