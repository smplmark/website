import { ConflictError, NotFoundError } from "../errors";
import type { BenchmarkRow, SampleSchema, Visibility } from "../types";
import { isUniqueViolation } from "./d1";

export interface CreateBenchmarkInput {
  account_id: string;
  key: string;
  name: string;
  description: string | null;
  visibility: Visibility;
  sample_schema: SampleSchema;
}

export async function createBenchmark(
  db: D1Database,
  input: CreateBenchmarkInput,
): Promise<BenchmarkRow> {
  const now = Date.now();
  const row: BenchmarkRow = {
    id: crypto.randomUUID(),
    account_id: input.account_id,
    key: input.key,
    name: input.name,
    description: input.description,
    visibility: input.visibility,
    sample_schema: JSON.stringify(input.sample_schema),
    created_at: now,
    updated_at: now,
  };
  try {
    await db
      .prepare(
        "INSERT INTO benchmark (id, account_id, key, name, description, visibility, sample_schema, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        row.id,
        row.account_id,
        row.key,
        row.name,
        row.description,
        row.visibility,
        row.sample_schema,
        row.created_at,
        row.updated_at,
      )
      .run();
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new ConflictError(
        `A benchmark with key ${JSON.stringify(input.key)} already exists for this account.`,
      );
    }
    throw e;
  }
  return row;
}

export async function getBenchmarkById(
  db: D1Database,
  id: string,
  opts: { publishedOnly: boolean },
): Promise<BenchmarkRow | null> {
  const sql =
    "SELECT * FROM benchmark WHERE id = ?" +
    (opts.publishedOnly ? " AND visibility = 'published'" : "");
  return (await db.prepare(sql).bind(id).first<BenchmarkRow>()) ?? null;
}

export interface ListBenchmarksInput {
  filterKey?: string;
  filterAccount?: string;
  publishedOnly: boolean;
  limit: number;
  offset: number;
  includeTotal: boolean;
}

export async function listBenchmarks(
  db: D1Database,
  input: ListBenchmarksInput,
): Promise<{ rows: BenchmarkRow[]; total?: number }> {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (input.publishedOnly) clauses.push("visibility = 'published'");
  if (input.filterKey !== undefined) {
    clauses.push("key = ?");
    binds.push(input.filterKey);
  }
  if (input.filterAccount !== undefined) {
    clauses.push("account_id = ?");
    binds.push(input.filterAccount);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const rows = (
    await db
      .prepare(
        `SELECT * FROM benchmark ${where} ORDER BY created_at, id LIMIT ? OFFSET ?`,
      )
      .bind(...binds, input.limit, input.offset)
      .all<BenchmarkRow>()
  ).results;

  let total: number | undefined;
  if (input.includeTotal) {
    const r = await db
      .prepare(`SELECT COUNT(*) AS n FROM benchmark ${where}`)
      .bind(...binds)
      .first<{ n: number }>();
    total = r?.n ?? 0;
  }
  return { rows, total };
}

export interface UpdateBenchmarkPatch {
  name?: string;
  description?: string | null;
  visibility?: Visibility;
  sample_schema?: SampleSchema;
}

export async function updateBenchmark(
  db: D1Database,
  id: string,
  patch: UpdateBenchmarkPatch,
): Promise<BenchmarkRow> {
  const existing = await getBenchmarkById(db, id, { publishedOnly: false });
  if (!existing) {
    throw new NotFoundError(`Benchmark ${JSON.stringify(id)} not found.`);
  }
  const updated: BenchmarkRow = {
    ...existing,
    name: patch.name ?? existing.name,
    description:
      patch.description !== undefined ? patch.description : existing.description,
    visibility: patch.visibility ?? existing.visibility,
    sample_schema:
      patch.sample_schema !== undefined
        ? JSON.stringify(patch.sample_schema)
        : existing.sample_schema,
    updated_at: Date.now(),
  };
  await db
    .prepare(
      "UPDATE benchmark SET name=?, description=?, visibility=?, sample_schema=?, updated_at=? WHERE id=?",
    )
    .bind(
      updated.name,
      updated.description,
      updated.visibility,
      updated.sample_schema,
      updated.updated_at,
      id,
    )
    .run();
  return updated;
}
