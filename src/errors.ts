// Domain error classes and their JSON:API error-document mapping. Pure — no Response/Hono
// coupling — so the query/ and schema/ modules can throw these without pulling in the web layer.

export interface JsonApiErrorObject {
  status: string;
  title: string;
  detail?: string;
  source?: { pointer: string };
}

export interface JsonApiErrorDocument {
  errors: JsonApiErrorObject[];
}

export class AppError extends Error {
  readonly status: number;
  readonly title: string;
  readonly detail?: string;
  readonly source?: { pointer: string };

  constructor(
    status: number,
    title: string,
    detail?: string,
    source?: { pointer: string },
  ) {
    super(detail ?? title);
    this.name = title;
    this.status = status;
    this.title = title;
    this.detail = detail;
    this.source = source;
  }
}

export class BadRequestError extends AppError {
  constructor(detail?: string, source?: { pointer: string }) {
    super(400, "Bad Request", detail, source);
  }
}

export class NotFoundError extends AppError {
  constructor(detail?: string) {
    super(404, "Not Found", detail);
  }
}

export class ConflictError extends AppError {
  constructor(detail?: string, source?: { pointer: string }) {
    super(409, "Conflict", detail, source);
  }
}

/**
 * A single, fixed 401. The ingest path funnels every auth failure — missing, malformed,
 * unrecognized, run/target mismatch — through this so the response is byte-identical and
 * leaks nothing about which check failed (spec §6: uniform 401, never 403).
 */
export class UnauthorizedError extends AppError {
  constructor() {
    super(401, "Unauthorized", "Authentication failed.");
  }
}

/** Render any error into a JSON:API error document (pure). */
export function toErrorDocument(err: unknown): {
  status: number;
  document: JsonApiErrorDocument;
} {
  if (err instanceof AppError) {
    const obj: JsonApiErrorObject = { status: String(err.status), title: err.title };
    if (err.detail !== undefined) obj.detail = err.detail;
    if (err.source !== undefined) obj.source = err.source;
    return { status: err.status, document: { errors: [obj] } };
  }
  return {
    status: 500,
    document: {
      errors: [{ status: "500", title: "Internal Server Error" }],
    },
  };
}
