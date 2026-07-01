import type { DateRange } from "../query/daterange";
import { dateRangePredicate } from "../query/predicates";

export interface InsertSampleInput {
  run_id: string;
  created_at: number;
  metrics: string | null;
  meta: string | null;
  client_ip: string | null;
}

/** Insert a sample; returns the database-assigned rowid. */
export async function insertSample(
  db: D1Database,
  input: InsertSampleInput,
): Promise<number> {
  const res = await db
    .prepare(
      "INSERT INTO sample (run_id, created_at, metrics, meta, client_ip) VALUES (?,?,?,?,?)",
    )
    .bind(
      input.run_id,
      input.created_at,
      input.metrics,
      input.meta,
      input.client_ip,
    )
    .run();
  return res.meta.last_row_id;
}

/** A sample row for reads, carrying its benchmark's sample_schema for compute-on-read. */
export interface SampleListRow {
  id: number;
  run_id: string;
  created_at: number;
  metrics: string | null;
  meta: string | null;
  sample_schema: string;
}

export interface SampleScope {
  run?: string;
  target?: string;
  benchmark?: string;
}

export interface ListSamplesInput {
  range: DateRange;
  scope: SampleScope;
  publishedOnly: boolean;
  limit: number;
  offset: number;
  includeTotal: boolean;
}

const JOINS =
  "FROM sample" +
  " JOIN run ON run.id = sample.run_id" +
  " JOIN target ON target.id = run.target_id" +
  " JOIN benchmark ON benchmark.id = target.benchmark_id";

function buildWhere(input: ListSamplesInput): { sql: string; binds: unknown[] } {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (input.publishedOnly) clauses.push("benchmark.visibility = 'published'");

  const pred = dateRangePredicate("sample.created_at", input.range);
  if (pred.sql) {
    clauses.push(pred.sql);
    binds.push(...pred.binds);
  }

  if (input.scope.run !== undefined) {
    clauses.push("sample.run_id = ?");
    binds.push(input.scope.run);
  } else if (input.scope.target !== undefined) {
    clauses.push("target.id = ?");
    binds.push(input.scope.target);
  } else if (input.scope.benchmark !== undefined) {
    clauses.push("benchmark.id = ?");
    binds.push(input.scope.benchmark);
  }

  return {
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    binds,
  };
}

export async function listSamples(
  db: D1Database,
  input: ListSamplesInput,
): Promise<{ rows: SampleListRow[]; total?: number }> {
  const where = buildWhere(input);

  const rows = (
    await db
      .prepare(
        `SELECT sample.id AS id, sample.run_id AS run_id, sample.created_at AS created_at,` +
          ` sample.metrics AS metrics, sample.meta AS meta, benchmark.sample_schema AS sample_schema` +
          ` ${JOINS} ${where.sql}` +
          ` ORDER BY sample.created_at, sample.id LIMIT ? OFFSET ?`,
      )
      .bind(...where.binds, input.limit, input.offset)
      .all<SampleListRow>()
  ).results;

  let total: number | undefined;
  if (input.includeTotal) {
    const r = await db
      .prepare(`SELECT COUNT(*) AS n ${JOINS} ${where.sql}`)
      .bind(...where.binds)
      .first<{ n: number }>();
    total = r?.n ?? 0;
  }
  return { rows, total };
}
