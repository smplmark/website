import { Hono } from "hono";
import { listSamples } from "../data/samples";
import { BadRequestError } from "../errors";
import { wantsCsv } from "../http/content_negotiation";
import { collectionResponse } from "../http/jsonapi";
import type { AppBindings } from "../http/middleware";
import { parseDateRange } from "../query/daterange";
import { paginationMeta, parsePagination } from "../query/pagination";
import { validateWindow } from "../query/window";
import { parseSampleSchema } from "../schema/sample_schema";
import { samplesToCsv } from "../serialize/csv";
import { serializeSample } from "../serialize/resource";
import type { SampleSchema } from "../types";

export const samples = new Hono<AppBindings>();

samples.get("/", async (c) => {
  const createdAt = c.req.query("filter[created_at]");
  if (createdAt === undefined) {
    throw new BadRequestError("filter[created_at] is required.");
  }
  const range = parseDateRange(createdAt);
  validateWindow(range, Date.now());

  // Optional scope: at most one of filter[run] / filter[target] / filter[benchmark].
  const run = c.req.query("filter[run]");
  const target = c.req.query("filter[target]");
  const benchmark = c.req.query("filter[benchmark]");
  if ([run, target, benchmark].filter((x) => x !== undefined).length > 1) {
    throw new BadRequestError(
      "Provide at most one of filter[run], filter[target], filter[benchmark].",
    );
  }

  const pagination = parsePagination(
    c.req.query("page[number]") ?? null,
    c.req.query("page[size]") ?? null,
    c.req.query("meta[total]") ?? null,
  );
  const { rows, total } = await listSamples(c.env.DB, {
    range,
    scope: { run, target, benchmark },
    publishedOnly: true,
    limit: pagination.limit,
    offset: pagination.offset,
    includeTotal: pagination.includeTotal,
  });

  // Parse each benchmark's schema once per request (compute-on-read is O(rows × derived)).
  const schemaCache = new Map<string, SampleSchema>();
  const resources = rows.map((r) => {
    let schema = schemaCache.get(r.sample_schema);
    if (schema === undefined) {
      schema = parseSampleSchema(r.sample_schema);
      schemaCache.set(r.sample_schema, schema);
    }
    return serializeSample(
      {
        id: r.id,
        run_id: r.run_id,
        created_at: r.created_at,
        metrics: r.metrics,
        meta: r.meta,
        client_ip: null,
      },
      schema,
    );
  });

  if (wantsCsv(c.req.header("Accept"))) {
    return new Response(samplesToCsv(resources), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="samples.csv"',
        Vary: "Accept",
      },
    });
  }

  return collectionResponse(resources, {
    meta: { pagination: paginationMeta(pagination, total) },
    headers: { Vary: "Accept" },
  });
});
