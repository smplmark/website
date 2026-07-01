import { Hono } from "hono";
import { getCachedTarget, setCachedTarget } from "../auth/ingest_cache";
import { hashSecret } from "../auth/secret";
import { insertSample } from "../data/samples";
import {
  createRun,
  getRunById,
  getRunTargetId,
  listRuns,
  updateRun,
  type UpdateRunPatch,
} from "../data/runs";
import { getIngestTargetBySecretHash } from "../data/targets";
import { getTargetById } from "../data/targets";
import { BadRequestError, NotFoundError, UnauthorizedError } from "../errors";
import {
  attributesOf,
  optionalStringOrNull,
  parseBearer,
  parseEpochMs,
  parseJsonBody,
  requireObject,
  requireString,
} from "../http/body";
import { collectionResponse, resourceResponse } from "../http/jsonapi";
import { adminAuth, type AppBindings } from "../http/middleware";
import { paginationMeta, parsePagination } from "../query/pagination";
import { parseSampleSchema } from "../schema/sample_schema";
import { serializeRun, serializeSample } from "../serialize/resource";

export const runs = new Hono<AppBindings>();

runs.post("/", adminAuth, async (c) => {
  const attrs = attributesOf(parseJsonBody(await c.req.text()));
  const target = requireString(attrs, "target");
  const key = requireString(attrs, "key");
  const name = optionalStringOrNull(attrs, "name") ?? null;
  const details = "details" in attrs ? attrs.details : null;

  if (!(await getTargetById(c.env.DB, target, { publishedOnly: false }))) {
    throw new BadRequestError(`Unknown target ${JSON.stringify(target)}.`, {
      pointer: "/data/attributes/target",
    });
  }
  const row = await createRun(c.env.DB, {
    target_id: target,
    key,
    name,
    details,
  });
  return resourceResponse(serializeRun(row), { status: 201 });
});

runs.get("/", async (c) => {
  const pagination = parsePagination(
    c.req.query("page[number]") ?? null,
    c.req.query("page[size]") ?? null,
    c.req.query("meta[total]") ?? null,
  );
  const { rows, total } = await listRuns(c.env.DB, {
    filterTarget: c.req.query("filter[target]"),
    filterKey: c.req.query("filter[key]"),
    publishedOnly: true,
    limit: pagination.limit,
    offset: pagination.offset,
    includeTotal: pagination.includeTotal,
  });
  return collectionResponse(rows.map(serializeRun), {
    meta: { pagination: paginationMeta(pagination, total) },
  });
});

// ── The one nested write: sample ingest. Authenticated by the target secret. ──
runs.post("/:id/samples", async (c) => {
  const runId = c.req.param("id");

  // Any auth failure — missing, malformed, unrecognized, run/target mismatch — is a uniform 401.
  const secret = parseBearer(c.req.header("Authorization"));
  if (secret === null) throw new UnauthorizedError();

  const now = Date.now();
  const hash = await hashSecret(secret);
  let target = getCachedTarget(hash, now);
  if (target === null) {
    target = await getIngestTargetBySecretHash(c.env.DB, hash);
    if (target === null) throw new UnauthorizedError();
    setCachedTarget(hash, target, now);
  }
  if ((await getRunTargetId(c.env.DB, runId)) !== target.id) {
    throw new UnauthorizedError();
  }

  // Empty body is valid (the scheduler case). Bulk upload may supply created_at / metrics / meta.
  const body = parseJsonBody(await c.req.text());
  const attrs = body === undefined ? {} : attributesOf(body);
  const createdAt =
    "created_at" in attrs ? parseEpochMs(attrs.created_at, "created_at") : now;
  const metricsJson =
    "metrics" in attrs
      ? JSON.stringify(requireObject(attrs.metrics, "metrics"))
      : null;
  const metaJson =
    "meta" in attrs ? JSON.stringify(requireObject(attrs.meta, "meta")) : null;
  const clientIp = c.req.header("CF-Connecting-IP") ?? null;

  const id = await insertSample(c.env.DB, {
    run_id: runId,
    created_at: createdAt,
    metrics: metricsJson,
    meta: metaJson,
    client_ip: clientIp,
  });

  const schema = parseSampleSchema(target.sample_schema);
  const resource = serializeSample(
    {
      id,
      run_id: runId,
      created_at: createdAt,
      metrics: metricsJson,
      meta: metaJson,
      client_ip: null,
    },
    schema,
  );
  return resourceResponse(resource, { status: 201 });
});

runs.get("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await getRunById(c.env.DB, id, { publishedOnly: true });
  if (!row) throw new NotFoundError(`Run ${JSON.stringify(id)} not found.`);
  return resourceResponse(serializeRun(row));
});

runs.patch("/:id", adminAuth, async (c) => {
  const attrs = attributesOf(parseJsonBody(await c.req.text()));
  const patch: UpdateRunPatch = {};
  if ("name" in attrs) patch.name = optionalStringOrNull(attrs, "name") ?? null;
  if ("details" in attrs) patch.details = attrs.details;
  const row = await updateRun(c.env.DB, c.req.param("id"), patch);
  return resourceResponse(serializeRun(row));
});
