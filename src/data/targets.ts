import { ConflictError, NotFoundError } from "../errors";
import type { TargetRow } from "../types";
import { isUniqueViolation, jsonOrNull } from "./d1";

/** The minimal target shape the ingest hot path needs: identity + the benchmark's schema. */
export interface IngestTarget {
  id: string;
  benchmark_id: string;
  sample_schema: string;
}

export interface CreateTargetInput {
  benchmark_id: string;
  key: string;
  name: string;
  details: unknown | null;
  /** Already-hashed ingest secret, or null for a bulk-only target. */
  secret_hash: string | null;
}

export async function createTarget(
  db: D1Database,
  input: CreateTargetInput,
): Promise<TargetRow> {
  const now = Date.now();
  const row: TargetRow = {
    id: crypto.randomUUID(),
    benchmark_id: input.benchmark_id,
    key: input.key,
    name: input.name,
    details: jsonOrNull(input.details),
    secret_hash: input.secret_hash,
    created_at: now,
    updated_at: now,
  };
  try {
    await db
      .prepare(
        "INSERT INTO target (id, benchmark_id, key, name, details, secret_hash, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .bind(
        row.id,
        row.benchmark_id,
        row.key,
        row.name,
        row.details,
        row.secret_hash,
        row.created_at,
        row.updated_at,
      )
      .run();
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new ConflictError(
        `A target with key ${JSON.stringify(input.key)} already exists for this benchmark.`,
      );
    }
    throw e;
  }
  return row;
}

export async function getTargetById(
  db: D1Database,
  id: string,
  opts: { publishedOnly: boolean },
): Promise<TargetRow | null> {
  if (opts.publishedOnly) {
    return (
      (await db
        .prepare(
          "SELECT target.* FROM target JOIN benchmark ON benchmark.id = target.benchmark_id WHERE target.id = ? AND benchmark.visibility = 'published'",
        )
        .bind(id)
        .first<TargetRow>()) ?? null
    );
  }
  return (
    (await db
      .prepare("SELECT * FROM target WHERE id = ?")
      .bind(id)
      .first<TargetRow>()) ?? null
  );
}

/** Ingest lookup: resolve a secret hash to the target + its benchmark's sample_schema (one read). */
export async function getIngestTargetBySecretHash(
  db: D1Database,
  secretHash: string,
): Promise<IngestTarget | null> {
  return (
    (await db
      .prepare(
        "SELECT target.id AS id, target.benchmark_id AS benchmark_id, benchmark.sample_schema AS sample_schema FROM target JOIN benchmark ON benchmark.id = target.benchmark_id WHERE target.secret_hash = ?",
      )
      .bind(secretHash)
      .first<IngestTarget>()) ?? null
  );
}

export interface ListTargetsInput {
  filterBenchmark?: string;
  filterKey?: string;
  publishedOnly: boolean;
  limit: number;
  offset: number;
  includeTotal: boolean;
}

export async function listTargets(
  db: D1Database,
  input: ListTargetsInput,
): Promise<{ rows: TargetRow[]; total?: number }> {
  const join = input.publishedOnly
    ? " JOIN benchmark ON benchmark.id = target.benchmark_id"
    : "";
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (input.publishedOnly) clauses.push("benchmark.visibility = 'published'");
  if (input.filterBenchmark !== undefined) {
    clauses.push("target.benchmark_id = ?");
    binds.push(input.filterBenchmark);
  }
  if (input.filterKey !== undefined) {
    clauses.push("target.key = ?");
    binds.push(input.filterKey);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const rows = (
    await db
      .prepare(
        `SELECT target.* FROM target${join} ${where} ORDER BY target.created_at, target.id LIMIT ? OFFSET ?`,
      )
      .bind(...binds, input.limit, input.offset)
      .all<TargetRow>()
  ).results;

  let total: number | undefined;
  if (input.includeTotal) {
    const r = await db
      .prepare(`SELECT COUNT(*) AS n FROM target${join} ${where}`)
      .bind(...binds)
      .first<{ n: number }>();
    total = r?.n ?? 0;
  }
  return { rows, total };
}

export interface UpdateTargetPatch {
  name?: string;
  details?: unknown | null;
}

export async function updateTarget(
  db: D1Database,
  id: string,
  patch: UpdateTargetPatch,
): Promise<TargetRow> {
  const existing = await getTargetById(db, id, { publishedOnly: false });
  if (!existing) {
    throw new NotFoundError(`Target ${JSON.stringify(id)} not found.`);
  }
  const updated: TargetRow = {
    ...existing,
    name: patch.name ?? existing.name,
    details:
      patch.details !== undefined ? jsonOrNull(patch.details) : existing.details,
    updated_at: Date.now(),
  };
  await db
    .prepare("UPDATE target SET name=?, details=?, updated_at=? WHERE id=?")
    .bind(updated.name, updated.details, updated.updated_at, id)
    .run();
  return updated;
}
