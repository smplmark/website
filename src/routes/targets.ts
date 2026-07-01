import { Hono } from "hono";
import { generateSecret, hashSecret } from "../auth/secret";
import { getBenchmarkById } from "../data/benchmarks";
import {
  createTarget,
  getTargetById,
  listTargets,
  updateTarget,
  type UpdateTargetPatch,
} from "../data/targets";
import { BadRequestError, NotFoundError } from "../errors";
import {
  attributesOf,
  parseJsonBody,
  requireString,
} from "../http/body";
import { collectionResponse, resourceResponse } from "../http/jsonapi";
import { adminAuth, type AppBindings } from "../http/middleware";
import { paginationMeta, parsePagination } from "../query/pagination";
import { serializeTarget } from "../serialize/resource";

export const targets = new Hono<AppBindings>();

targets.post("/", adminAuth, async (c) => {
  const attrs = attributesOf(parseJsonBody(await c.req.text()));
  const benchmark = requireString(attrs, "benchmark");
  const key = requireString(attrs, "key");
  const name = requireString(attrs, "name");
  const details = "details" in attrs ? attrs.details : null;

  if (!(await getBenchmarkById(c.env.DB, benchmark, { publishedOnly: false }))) {
    throw new BadRequestError(`Unknown benchmark ${JSON.stringify(benchmark)}.`, {
      pointer: "/data/attributes/benchmark",
    });
  }

  // Secret is generated server-side and returned once, in plaintext, in the response meta.
  const secret = generateSecret();
  const secret_hash = await hashSecret(secret);
  const row = await createTarget(c.env.DB, {
    benchmark_id: benchmark,
    key,
    name,
    details,
    secret_hash,
  });
  return resourceResponse(serializeTarget(row), {
    status: 201,
    meta: { secret },
  });
});

targets.get("/", async (c) => {
  const pagination = parsePagination(
    c.req.query("page[number]") ?? null,
    c.req.query("page[size]") ?? null,
    c.req.query("meta[total]") ?? null,
  );
  const { rows, total } = await listTargets(c.env.DB, {
    filterBenchmark: c.req.query("filter[benchmark]"),
    filterKey: c.req.query("filter[key]"),
    publishedOnly: true,
    limit: pagination.limit,
    offset: pagination.offset,
    includeTotal: pagination.includeTotal,
  });
  return collectionResponse(rows.map(serializeTarget), {
    meta: { pagination: paginationMeta(pagination, total) },
  });
});

targets.get("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await getTargetById(c.env.DB, id, { publishedOnly: true });
  if (!row) throw new NotFoundError(`Target ${JSON.stringify(id)} not found.`);
  return resourceResponse(serializeTarget(row));
});

targets.patch("/:id", adminAuth, async (c) => {
  const attrs = attributesOf(parseJsonBody(await c.req.text()));
  const patch: UpdateTargetPatch = {};
  if ("name" in attrs) patch.name = requireString(attrs, "name");
  if ("details" in attrs) patch.details = attrs.details;
  const row = await updateTarget(c.env.DB, c.req.param("id"), patch);
  return resourceResponse(serializeTarget(row));
});
