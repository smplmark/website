// Domain row types (as stored in D1; snake_case columns) and the sample_schema shape.
// These are the shared vocabulary the whole codebase speaks.

export type Visibility = "published" | "private";

export interface AccountRow {
  id: string;
  key: string;
  name: string;
  /** Publisher blurb — who they are. Nullable. */
  description: string | null;
  /** Publisher homepage URL. Nullable. */
  url: string | null;
  created_at: number;
}

export interface BenchmarkRow {
  id: string;
  account_id: string;
  key: string;
  name: string;
  description: string | null;
  visibility: Visibility;
  /** Longer-form overview of what the benchmark measures. Nullable. */
  about: string | null;
  /** How the data is produced and how metrics are computed. Nullable. */
  methodology: string | null;
  /** JSON string of a SampleSchema. */
  sample_schema: string;
  created_at: number;
  updated_at: number;
}

export interface TargetRow {
  id: string;
  benchmark_id: string;
  key: string;
  name: string;
  /** JSON string or null. */
  details: string | null;
  /** Hash of the ingest secret. Never surfaced on the wire. */
  secret_hash: string | null;
  created_at: number;
  updated_at: number;
}

export interface RunRow {
  id: string;
  target_id: string;
  key: string;
  name: string | null;
  /** JSON string or null. */
  details: string | null;
  created_at: number;
  updated_at: number;
}

export interface SampleRow {
  /** rowid — database-assigned INTEGER; stringified on the wire. */
  id: number;
  run_id: string;
  created_at: number;
  /** JSON string or null (stored metrics only). */
  metrics: string | null;
  /** JSON string or null. */
  meta: string | null;
  /** From CF-Connecting-IP. Write-only: captured on ingest, never surfaced. */
  client_ip: string | null;
}

// ── sample_schema ──────────────────────────────────────────────────────────

/** A JSON Logic rule, e.g. `{ "minute_offset_ms": [{ "var": "created_at" }] }`. */
export type JsonLogicRule = unknown;

/** A stored numeric value a client supplies on write. */
export interface MetricDecl {
  name: string;
  type: string;
  unit?: string;
  /** Human-readable description, surfaced on the benchmark page. */
  description?: string;
}

/** A numeric value computed on read from a JSON Logic expression. */
export interface DerivedDecl {
  name: string;
  unit?: string;
  expr: JsonLogicRule;
  /** Human-readable description, surfaced on the benchmark page. */
  description?: string;
}

export interface SampleSchema {
  metrics: MetricDecl[];
  derived: DerivedDecl[];
}
