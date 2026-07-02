// Row → JSON:API resource object. Explicit per-resource serializers (clearer than a reflection
// engine) that enforce the spec's rules: singular `type`, NO relationships (parent refs are bare
// id attributes), epoch-ms → ISO-8601, write-only columns (secret_hash, client_ip) never emitted.
import type { ResourceObject } from "../http/jsonapi";
import { computeMetrics } from "../logic/derived";
import { parseSampleSchema } from "../schema/sample_schema";
import type {
  AccountRow,
  BenchmarkRow,
  RunRow,
  SampleRow,
  SampleSchema,
  TargetRow,
} from "../types";

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function parseJsonOrNull(s: string | null): unknown {
  return s === null ? null : JSON.parse(s);
}

export function serializeAccount(row: AccountRow): ResourceObject {
  return {
    type: "account",
    id: row.id,
    attributes: {
      key: row.key,
      name: row.name,
      description: row.description,
      url: row.url,
      created_at: iso(row.created_at),
    },
  };
}

export function serializeBenchmark(row: BenchmarkRow): ResourceObject {
  return {
    type: "benchmark",
    id: row.id,
    attributes: {
      account: row.account_id,
      key: row.key,
      name: row.name,
      description: row.description,
      about: row.about,
      methodology: row.methodology,
      visibility: row.visibility,
      sample_schema: parseSampleSchema(row.sample_schema),
      created_at: iso(row.created_at),
      updated_at: iso(row.updated_at),
    },
  };
}

export function serializeTarget(row: TargetRow): ResourceObject {
  // secret_hash is never surfaced.
  return {
    type: "target",
    id: row.id,
    attributes: {
      benchmark: row.benchmark_id,
      key: row.key,
      name: row.name,
      details: parseJsonOrNull(row.details),
      created_at: iso(row.created_at),
      updated_at: iso(row.updated_at),
    },
  };
}

export function serializeRun(row: RunRow): ResourceObject {
  return {
    type: "run",
    id: row.id,
    attributes: {
      target: row.target_id,
      key: row.key,
      name: row.name,
      details: parseJsonOrNull(row.details),
      created_at: iso(row.created_at),
      updated_at: iso(row.updated_at),
    },
  };
}

export function serializeSample(
  row: SampleRow,
  schema: SampleSchema,
): ResourceObject {
  // client_ip is never surfaced. id (rowid INTEGER) is stringified on the wire.
  const attributes: Record<string, unknown> = {
    created_at: iso(row.created_at),
    run: row.run_id,
  };
  const metrics = computeMetrics(row.metrics, schema, row.created_at);
  if (metrics !== null) attributes.metrics = metrics;

  const meta = parseJsonOrNull(row.meta);
  if (
    meta !== null &&
    typeof meta === "object" &&
    !Array.isArray(meta) &&
    Object.keys(meta).length > 0
  ) {
    attributes.meta = meta;
  }

  return { type: "sample", id: String(row.id), attributes };
}
