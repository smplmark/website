import { Hono } from "hono";
import { getAccountById } from "../data/accounts";
import {
  createBenchmark,
  getBenchmarkById,
  listBenchmarks,
  updateBenchmark,
  type UpdateBenchmarkPatch,
} from "../data/benchmarks";
import { BadRequestError, NotFoundError } from "../errors";
import {
  attributesOf,
  optionalEnum,
  optionalStringOrNull,
  parseJsonBody,
  requireString,
} from "../http/body";
import { collectionResponse, resourceResponse } from "../http/jsonapi";
import { adminAuth, type AppBindings } from "../http/middleware";
import { paginationMeta, parsePagination } from "../query/pagination";
import { validateSampleSchema } from "../schema/sample_schema";
import { serializeBenchmark } from "../serialize/resource";
import type { SampleSchema } from "../types";

const VISIBILITY = ["published", "private"] as const;
const EMPTY_SCHEMA: SampleSchema = { metrics: [], derived: [] };

export const benchmarks = new Hono<AppBindings>();

benchmarks.post("/", adminAuth, async (c) => {
  const attrs = attributesOf(parseJsonBody(await c.req.text()));
  const account = requireString(attrs, "account");
  const key = requireString(attrs, "key");
  const name = requireString(attrs, "name");
  const description = optionalStringOrNull(attrs, "description") ?? null;
  const visibility = optionalEnum(attrs, "visibility", VISIBILITY) ?? "private";
  const sample_schema =
    "sample_schema" in attrs
      ? validateSampleSchema(attrs.sample_schema)
      : EMPTY_SCHEMA;

  if (!(await getAccountById(c.env.DB, account))) {
    throw new BadRequestError(`Unknown account ${JSON.stringify(account)}.`, {
      pointer: "/data/attributes/account",
    });
  }
  const row = await createBenchmark(c.env.DB, {
    account_id: account,
    key,
    name,
    description,
    visibility,
    sample_schema,
  });
  return resourceResponse(serializeBenchmark(row), { status: 201 });
});

benchmarks.get("/", async (c) => {
  const pagination = parsePagination(
    c.req.query("page[number]") ?? null,
    c.req.query("page[size]") ?? null,
    c.req.query("meta[total]") ?? null,
  );
  const { rows, total } = await listBenchmarks(c.env.DB, {
    filterKey: c.req.query("filter[key]"),
    filterAccount: c.req.query("filter[account]"),
    publishedOnly: true,
    limit: pagination.limit,
    offset: pagination.offset,
    includeTotal: pagination.includeTotal,
  });
  return collectionResponse(rows.map(serializeBenchmark), {
    meta: { pagination: paginationMeta(pagination, total) },
  });
});

benchmarks.get("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await getBenchmarkById(c.env.DB, id, { publishedOnly: true });
  if (!row) throw new NotFoundError(`Benchmark ${JSON.stringify(id)} not found.`);
  return resourceResponse(serializeBenchmark(row));
});

benchmarks.patch("/:id", adminAuth, async (c) => {
  const attrs = attributesOf(parseJsonBody(await c.req.text()));
  const patch: UpdateBenchmarkPatch = {};
  if ("name" in attrs) patch.name = requireString(attrs, "name");
  if ("description" in attrs) {
    patch.description = optionalStringOrNull(attrs, "description") ?? null;
  }
  if ("visibility" in attrs) {
    patch.visibility = optionalEnum(attrs, "visibility", VISIBILITY);
  }
  if ("sample_schema" in attrs) {
    patch.sample_schema = validateSampleSchema(attrs.sample_schema);
  }
  const row = await updateBenchmark(c.env.DB, c.req.param("id"), patch);
  return resourceResponse(serializeBenchmark(row));
});
