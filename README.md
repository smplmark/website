# smplmark

A general-purpose benchmark host on Cloudflare Workers + D1. Publishers upload benchmark
data on a schedule; visitors review benchmarks from publishers they choose to trust.
smplmark does not validate the truth of the data, only its shape.

The v1 benchmark is **scheduler-latency**: each scheduler is a *target* that POSTs a
bare-timestamp beacon; `skew_ms` (how far past the top of the minute the beacon arrived) is
**computed on read** from the timestamp. See [design notes](#design-notes) for the full model.

- **Stack:** Cloudflare Workers + D1 (serverless SQLite), TypeScript, [Hono](https://hono.dev)
  for routing, [json-logic-js](https://github.com/jwadhams/json-logic-js) for derived metrics,
  [uPlot](https://github.com/leeoniya/uPlot) for the chart. No build step for the static UI.
- **API:** JSON:API (`application/vnd.api+json`), singular resource `type`, parent refs as
  bare id attributes (no `relationships`). `snake_case` paths and fields.

## Local development

```bash
npm install
npm run cf-typegen                 # generate worker-configuration.d.ts from wrangler.jsonc

npm run db:migrate:local           # apply migrations to the local D1
npm run db:seed:local              # seed the smplkit account + scheduler-latency benchmark + demo data

npm run dev                        # wrangler dev — http://localhost:8787
```

Then open:

- `http://localhost:8787/` — home
- `http://localhost:8787/benchmarks` — published benchmarks
- `http://localhost:8787/benchmarks/latency` — the skew chart (defaults to the seeded window,
  2026-07-01T09:30–12:30Z; adjust the date inputs for live-ingested data)

### Dev ingest secrets

The seed creates two targets with fixed **local-only** ingest secrets (never use these in
production — real secrets are generated server-side and returned once):

| scheduler   | ingest secret            | run id            |
| ----------- | ------------------------ | ----------------- |
| scheduler-a | `dev-secret-scheduler-a` | `run-scheduler-a` |
| scheduler-b | `dev-secret-scheduler-b` | `run-scheduler-b` |

Post a beacon (empty body — the server stamps `created_at`):

```bash
curl -X POST http://localhost:8787/api/v1/runs/run-scheduler-a/samples \
  -H "Authorization: Bearer dev-secret-scheduler-a"
```

Read it back (JSON, then CSV):

```bash
curl "http://localhost:8787/api/v1/samples?filter[created_at]=[2026-07-01T00:00:00Z,2026-07-02T00:00:00Z)&filter[target]=tgt-scheduler-a"
curl -H "Accept: text/csv" "http://localhost:8787/api/v1/samples?filter[created_at]=[2026-07-01T00:00:00Z,2026-07-02T00:00:00Z)&filter[target]=tgt-scheduler-a"
```

## Testing

```bash
npm test                 # vitest (unit + integration, via @cloudflare/vitest-pool-workers)
npm run test:coverage    # with coverage gates
npm run typecheck        # tsc for the worker + the node-context config
```

Coverage gates: **90%** global (lines/branches/functions/statements) with **100%** on the pure
modules (`src/query`, `src/logic`, `src/serialize`, `src/auth/secret.ts`).

## API

All under `/api/v1`. Config writes are gated by an admin-stub (`Authorization: Bearer $ADMIN_TOKEN`);
public reads expose only `published` benchmarks and their targets/runs/samples.

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST/GET/GET`{id}`/PATCH | `/benchmarks` | admin-stub / public | list is published-only; `filter[key]`, `filter[account]` |
| POST/GET/GET`{id}`/PATCH | `/targets` | admin-stub / public | POST returns the plaintext secret **once** in `meta.secret`; `filter[benchmark]`, `filter[key]` |
| POST/GET/GET`{id}`/PATCH | `/runs` | admin-stub / public | `filter[target]`, `filter[key]` |
| POST | `/runs/{id}/samples` | target secret | ingest; empty body OK; uniform 401 on any failure |
| GET | `/samples` | public | required `filter[created_at]` (max 30-day window); optional one of `filter[run]`/`filter[target]`/`filter[benchmark]`; `Accept: text/csv` for CSV |

## Deployment

This repo builds and tests entirely locally with no Cloudflare account. To deploy to
`www.smplmark.org`:

1. `npx wrangler login` (authenticate to the Cloudflare account).
2. `npx wrangler d1 create smplmark` — copy the returned `database_id` into `wrangler.jsonc`
   (it ships with a placeholder `00000000-…`).
3. `npx wrangler d1 migrations apply smplmark --remote`.
4. Seed production structural data (an account + benchmark + targets). Do **not** ship the dev
   secrets; create targets via `POST /api/v1/targets` and capture each returned secret once.
5. `npx wrangler deploy`.
6. Point `www.smplmark.org` DNS / a custom domain at the Worker in the Cloudflare dashboard.

`ADMIN_TOKEN` is a plaintext stub var in `wrangler.jsonc`. For a real boundary, move it out with
`npx wrangler secret put ADMIN_TOKEN`.

## Project layout

```
migrations/0001_init.sql   D1 schema (5 tables + indexes)
scripts/seed.sql           local dev seed (generated)
public/                    static UI (served by the Worker; uPlot vendored under vendor/)
src/
  index.ts app.ts          worker entry + Hono app (routes + static-asset fallthrough)
  types.ts errors.ts       domain row types + JSON:API error mapping
  http/                    envelope, error rendering, body parsing, content negotiation, admin mw
  query/                   range grammar, 30-day window, pagination, SQL predicates (pure)
  logic/                   json-logic evaluator + minute_offset_ms + compute-on-read merge (pure)
  schema/                  sample_schema validation/parsing (pure)
  serialize/               row -> JSON:API resource, samples -> CSV (pure)
  data/                    D1 access (the only layer touching env.DB)
  auth/                    secret gen/hash + L1 ingest cache
  routes/                  benchmarks, targets, runs (+ ingest), samples
```

## Design notes

- **Compute-on-read is the rule.** Raw samples store only what was given; `skew_ms` and every
  other derived value are computed when the sample is read, from `sample_schema.derived`
  expressions. The stored row commits to no interpretation.
- **Uniform 401.** Every ingest-auth failure (missing/malformed/unknown secret, run/target
  mismatch) returns a byte-identical 401, to avoid leaking that a secret's shape was valid.
- **Hot path.** Ingest never calls out; a warm isolate authenticates from an in-memory
  positives-only cache of `secret_hash → target`, falling back to one indexed D1 read.
- **Deliberately deferred (v1):** account signup / real tenant auth, private-read auth, windowed
  aggregation (coverage / percentiles / downsampling), secret rotation, `DELETE` on config
  resources. The data model already carries the multi-tenant hooks (`account_id`, `visibility`).
