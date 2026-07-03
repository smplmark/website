import { Hono, type Context } from "hono";
import { covers, isPublicStatus, requireWrite } from "../authz";
import {
  accountHasVerifiedUser,
} from "../data/accounts";
import {
  createBenchmark,
  deleteBenchmarkCascade,
  getBenchmarkById,
  listBenchmarks,
  publishBenchmark,
  updateBenchmark,
  withdrawBenchmark,
} from "../data/benchmarks";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../errors";
import {
  optionalStringOrNull,
  requireString,
} from "../http/body";
import { collectionResponse, noContentResponse, resourceResponse } from "../http/jsonapi";
import { getAuth, getOptionalAuth, optionalAuth, requireAuth, type AppBindings } from "../http/middleware";
import { paginationMeta } from "../query/pagination";
import {
  assertFrozenCompatible,
  parseSampleSchema,
  validateSampleSchema,
} from "../schema/sample_schema";
import { serializeBenchmark } from "../serialize/resource";
import type { BenchmarkRow, SampleSchema, Status } from "../types";
import { readAttributes, readPagination, readSort } from "./shared";

const EMPTY_SCHEMA: SampleSchema = { metrics: [], derived: [] };
const PUBLIC_STATUSES: Status[] = ["PUBLISHED", "WITHDRAWN"];
const SORT_ALLOWED = ["name", "created_at", "updated_at"] as const;

export const benchmarks = new Hono<AppBindings>();

/** Load a benchmark or 404; enforce that the credential covers it (else 404 — no existence leak). */
async function loadOwned(c: Context<AppBindings>, id: string): Promise<BenchmarkRow> {
  const auth = getAuth(c);
  requireWrite(auth); // loadOwned backs only mutating handlers — gate viewers here.
  const row = await getBenchmarkById(c.env.DB, id);
  if (!row || !covers(auth, { account_id: row.account_id, benchmark_id: row.id })) {
    throw new NotFoundError();
  }
  return row;
}

benchmarks.post("/", requireAuth, async (c) => {
  const auth = getAuth(c);
  if (auth.scope_type !== "ACCOUNT") {
    throw new ForbiddenError("This credential's scope does not permit creating benchmarks.");
  }
  requireWrite(auth);
  const attrs = await readAttributes(c);
  const key = requireString(attrs, "key");
  const name = requireString(attrs, "name");
  const description = optionalStringOrNull(attrs, "description") ?? null;
  const about = optionalStringOrNull(attrs, "about") ?? null;
  const methodology = optionalStringOrNull(attrs, "methodology") ?? null;
  const sample_schema =
    "sample_schema" in attrs ? validateSampleSchema(attrs.sample_schema) : EMPTY_SCHEMA;

  const row = await createBenchmark(c.env.DB, {
    account_id: auth.account_id,
    key,
    name,
    description,
    about,
    methodology,
    sample_schema,
  });
  return resourceResponse(serializeBenchmark(row), { status: 201 });
});

benchmarks.get("/", optionalAuth, async (c) => {
  const auth = getOptionalAuth(c);
  const pagination = readPagination(c);
  const sort = readSort(c, "-created_at", SORT_ALLOWED);
  const filterAccount = c.req.query("filter[account]");
  const filterKey = c.req.query("filter[key]");

  // An account-authority caller viewing their own account sees every status; everyone else sees
  // only world-visible benchmarks.
  const ownerView =
    !!auth &&
    auth.scope_type === "ACCOUNT" &&
    filterAccount !== undefined &&
    filterAccount === auth.account_id;

  const { rows, total } = await listBenchmarks(c.env.DB, {
    statuses: ownerView ? undefined : PUBLIC_STATUSES,
    accountId: filterAccount,
    filterKey,
    sort,
    limit: pagination.limit,
    offset: pagination.offset,
    includeTotal: pagination.includeTotal,
  });
  return collectionResponse(rows.map(serializeBenchmark), {
    meta: { pagination: paginationMeta(pagination, total) },
  });
});

benchmarks.get("/:id", optionalAuth, async (c) => {
  const auth = getOptionalAuth(c);
  const row = await getBenchmarkById(c.env.DB, c.req.param("id"));
  if (!row) throw new NotFoundError();
  if (!isPublicStatus(row.status)) {
    if (!auth || !covers(auth, { account_id: row.account_id, benchmark_id: row.id })) {
      throw new NotFoundError();
    }
  }
  return resourceResponse(serializeBenchmark(row));
});

benchmarks.put("/:id", requireAuth, async (c) => {
  const existing = await loadOwned(c, c.req.param("id"));
  const attrs = await readAttributes(c);
  const name = requireString(attrs, "name");
  const description = optionalStringOrNull(attrs, "description") ?? null;
  const about = optionalStringOrNull(attrs, "about") ?? null;
  const methodology = optionalStringOrNull(attrs, "methodology") ?? null;
  const sample_schema =
    "sample_schema" in attrs ? validateSampleSchema(attrs.sample_schema) : EMPTY_SCHEMA;

  // Interpretation freeze: on a published/withdrawn benchmark the semantic core is immutable.
  if (existing.status !== "PRIVATE") {
    assertFrozenCompatible(parseSampleSchema(existing.sample_schema), sample_schema);
  }

  const row = await updateBenchmark(c.env.DB, existing.id, {
    name,
    description,
    about,
    methodology,
    sample_schema,
  });
  return resourceResponse(serializeBenchmark(row as BenchmarkRow));
});

benchmarks.delete("/:id", requireAuth, async (c) => {
  const existing = await loadOwned(c, c.req.param("id"));
  if (existing.status !== "PRIVATE") {
    throw new ConflictError(
      "Published benchmark data is append-only and cannot be deleted; withdraw it instead.",
    );
  }
  await deleteBenchmarkCascade(c.env.DB, existing.id);
  return noContentResponse();
});

benchmarks.post("/:id/actions/publish", requireAuth, async (c) => {
  const existing = await loadOwned(c, c.req.param("id"));
  if (existing.status !== "PRIVATE") {
    throw new ConflictError("Only a private benchmark can be published.");
  }
  if (!(await accountHasVerifiedUser(c.env.DB, existing.account_id))) {
    throw new ForbiddenError(
      "Verify your email address before publishing a benchmark.",
    );
  }
  const row = await publishBenchmark(c.env.DB, existing.id, Date.now());
  return resourceResponse(serializeBenchmark(row as BenchmarkRow));
});

benchmarks.post("/:id/actions/withdraw", requireAuth, async (c) => {
  const existing = await loadOwned(c, c.req.param("id"));
  if (existing.status !== "PUBLISHED") {
    throw new ConflictError("Only a published benchmark can be withdrawn.");
  }
  const attrs = await readAttributes(c).catch(() => ({}) as Record<string, unknown>);
  const reason = optionalStringOrNull(attrs, "withdrawal_reason") ?? null;
  if (reason === null) {
    throw new BadRequestError(
      "withdrawal_reason is required.",
      { pointer: "/data/attributes/withdrawal_reason" },
    );
  }
  const row = await withdrawBenchmark(c.env.DB, existing.id, Date.now(), reason);
  return resourceResponse(serializeBenchmark(row as BenchmarkRow));
});
