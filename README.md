# smplmark — website

> **This is the `website` repo** — the public marketing site and the **published-benchmark viewer**,
> served as a single Cloudflare Worker on **www.smplmark.org** (the apex redirects here). It holds no
> API and no database. The logged-in console, authentication, and the JSON:API live in the separate
> **[`app`](https://github.com/smplmark/app)** repo on **app.smplmark.org**; the viewer reads published
> data from that API cross-origin (the app answers CORS for this origin).

smplmark is a general-purpose, multi-tenant, publicly self-serve **benchmark host**. This site is its
public face: the marketing pages and the data-driven page for every published benchmark. The first
real benchmark is smplkit's own **scheduler-latency** (`skew_ms`, computed on read from a beacon
timestamp).

- **Stack:** Cloudflare Workers (static assets + a thin routing Worker), TypeScript,
  [uPlot](https://github.com/leeoniya/uPlot) (charts). No build step — the UI is plain HTML/CSS/JS
  under `public/`.

## What this Worker does

`src/index.ts` is a small shim in front of the static assets:

1. Redirects the apex (`smplmark.org`) to the canonical `www` host.
2. Serves the data-driven shell (`public/benchmark.html`) for every `/benchmarks/{key}`.
3. Falls through to static assets for everything else (marketing pages, viewer JS/CSS, images).

Pages: `/` (home), `/benchmarks` (list), `/benchmarks/{key}` (data-driven benchmark page), `/about`,
`/terms`, `/privacy`.

## Reading data from the app API

The viewer (`public/js/benchmark.js`, `public/js/benchmark-list.js`) fetches published benchmarks,
targets, runs, and observations from the app's public API. It resolves the API base at runtime
(`apiBase()`): on `www`/apex it uses `https://app.smplmark.org`; on `localhost` it defaults to the
local app Worker at `http://localhost:8788`; otherwise it falls back to same-origin. An explicit
`?api=<url>` query param (or `window.SM_API_BASE`) overrides all of that and stays sticky across
internal links — e.g. `?api=https://app.smplmark.org` browses the local site against production
data. Only world-visible (PUBLISHED / WITHDRAWN) data is reachable — these are unauthenticated
public reads.

## Local development

The full local loop is two Workers and a seeded local D1 — no deploys, no network:

```bash
# Terminal 1 — the app API on :8788 (in the app repo)
cd ../smplmark-app
npm run db:migrate:local              # once: apply migrations to the local D1
npm run db:seed:local                 # once: dev account + scheduler-latency
node ingestion/import.mjs             # optional: the full ingested dataset (offline, from the archive)
npm run dev                           # wrangler dev — http://localhost:8788

# Terminal 2 — this site on :8787
npm install
npm run dev                           # wrangler dev — http://localhost:8787 (marketing + viewer)
```

Open `http://localhost:8787/benchmarks` — the viewer talks to `:8788` automatically. Edits to
`public/` and `src/` hot-reload; re-run the importer any time to rebuild the local dataset (it
only ever touches the ingested scope).

## Testing

```bash
npm test          # vitest (the routing Worker, via @cloudflare/vitest-pool-workers)
npm run typecheck # tsc for the Worker + the node-context config
```

## Deployment

CI (`.github/workflows/deploy.yml`) deploys this Worker to **www.smplmark.org** + apex on every push
to `main`, gated on typecheck + tests. It needs one repo secret, `CLOUDFLARE_API_TOKEN` (account id is
pinned in `wrangler.jsonc`). There is no database step — the app repo owns D1.

> **Cutover note:** this Worker previously also served `app.smplmark.org` (console + auth + API). That
> surface moved to the `app` repo. The `app.smplmark.org` custom domain was dropped from
> `wrangler.jsonc` here so the app Worker can claim it — see the `app` repo's README for the ordered
> cutover.

## Project layout

```
public/
  index.html               marketing home (lists published benchmarks)
  about/ terms/ privacy/    marketing pages
  benchmark.html            the data-driven benchmark shell (served for /benchmarks/{key})
  benchmarks/index.html     the published-benchmark list
  js/benchmark.js           benchmark detail: fetches the app API, renders chart + attribution badge
  js/benchmark-list.js      the card grid on the home + list pages
  css/app.css               shared styles
  vendor/uPlot.*            chart library (vendored, no build step)
scripts/gen-brand.mjs       regenerates the brand PNGs under public/img
src/index.ts                the routing Worker (apex → www, /benchmarks/{key} shell, static fallthrough)
```
