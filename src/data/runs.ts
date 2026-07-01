import { ConflictError, NotFoundError } from "../errors";
import type { RunRow } from "../types";
import { isUniqueViolation, jsonOrNull } from "./d1";

const PUBLISHED_JOIN =
  " JOIN target ON target.id = run.target_id JOIN benchmark ON benchmark.id = target.benchmark_id";

export interface CreateRunInput {
  target_id: string;
  key: string;
  name: string | null;
  details: unknown | null;
}

export async function createRun(
  db: D1Database,
  input: CreateRunInput,
): Promise<RunRow> {
  const now = Date.now();
  const row: RunRow = {
    id: crypto.randomUUID(),
    target_id: input.target_id,
    key: input.key,
    name: input.name,
    details: jsonOrNull(input.details),
    created_at: now,
    updated_at: now,
  };
  try {
    await db
      .prepare(
        "INSERT INTO run (id, target_id, key, name, details, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      )
      .bind(
        row.id,
        row.target_id,
        row.key,
        row.name,
        row.details,
        row.created_at,
        row.updated_at,
      )
      .run();
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new ConflictError(
        `A run with key ${JSON.stringify(input.key)} already exists for this target.`,
      );
    }
    throw e;
  }
  return row;
}

export async function getRunById(
  db: D1Database,
  id: string,
  opts: { publishedOnly: boolean },
): Promise<RunRow | null> {
  if (opts.publishedOnly) {
    return (
      (await db
        .prepare(
          `SELECT run.* FROM run${PUBLISHED_JOIN} WHERE run.id = ? AND benchmark.visibility = 'published'`,
        )
        .bind(id)
        .first<RunRow>()) ?? null
    );
  }
  return (
    (await db
      .prepare("SELECT * FROM run WHERE id = ?")
      .bind(id)
      .first<RunRow>()) ?? null
  );
}

/** Ingest ownership check: the target_id of a run, or null if the run doesn't exist. */
export async function getRunTargetId(
  db: D1Database,
  runId: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT target_id FROM run WHERE id = ?")
    .bind(runId)
    .first<{ target_id: string }>();
  return row?.target_id ?? null;
}

export interface ListRunsInput {
  filterTarget?: string;
  filterKey?: string;
  publishedOnly: boolean;
  limit: number;
  offset: number;
  includeTotal: boolean;
}

export async function listRuns(
  db: D1Database,
  input: ListRunsInput,
): Promise<{ rows: RunRow[]; total?: number }> {
  const join = input.publishedOnly ? PUBLISHED_JOIN : "";
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (input.publishedOnly) clauses.push("benchmark.visibility = 'published'");
  if (input.filterTarget !== undefined) {
    clauses.push("run.target_id = ?");
    binds.push(input.filterTarget);
  }
  if (input.filterKey !== undefined) {
    clauses.push("run.key = ?");
    binds.push(input.filterKey);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const rows = (
    await db
      .prepare(
        `SELECT run.* FROM run${join} ${where} ORDER BY run.created_at, run.id LIMIT ? OFFSET ?`,
      )
      .bind(...binds, input.limit, input.offset)
      .all<RunRow>()
  ).results;

  let total: number | undefined;
  if (input.includeTotal) {
    const r = await db
      .prepare(`SELECT COUNT(*) AS n FROM run${join} ${where}`)
      .bind(...binds)
      .first<{ n: number }>();
    total = r?.n ?? 0;
  }
  return { rows, total };
}

export interface UpdateRunPatch {
  name?: string | null;
  details?: unknown | null;
}

export async function updateRun(
  db: D1Database,
  id: string,
  patch: UpdateRunPatch,
): Promise<RunRow> {
  const existing = await getRunById(db, id, { publishedOnly: false });
  if (!existing) {
    throw new NotFoundError(`Run ${JSON.stringify(id)} not found.`);
  }
  const updated: RunRow = {
    ...existing,
    name: patch.name !== undefined ? patch.name : existing.name,
    details:
      patch.details !== undefined ? jsonOrNull(patch.details) : existing.details,
    updated_at: Date.now(),
  };
  await db
    .prepare("UPDATE run SET name=?, details=?, updated_at=? WHERE id=?")
    .bind(updated.name, updated.details, updated.updated_at, id)
    .run();
  return updated;
}
