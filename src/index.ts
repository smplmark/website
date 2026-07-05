// smplmark website Worker — the marketing site and the published-benchmark viewer, served on
// www.smplmark.org (the apex redirects here). It holds no API and no database: the viewer reads
// published data from the app's public API (app.smplmark.org) client-side (see public/js/benchmark.js).
//
// Responsibilities:
//   1. Redirect the apex (smplmark.org) to the canonical www host.
//   2. Redirect app pages (/login, /signup, /account, …) and /api/* to the app host — the console +
//      auth + API live there now (the `app` repo). Marketing links to /login etc. resolve this way.
//   3. Serve the data-driven benchmark shell for every /benchmarks/{key}, server-side-rendering the
//      SEO-critical content (title, meta, Open Graph, JSON-LD, a crawlable body block) so search
//      engines index real content, not a "Loading…" shell. The viewer hydrates on top.
//   4. Serve /robots.txt and a dynamic /sitemap.xml built from the published-benchmark list.
//   5. Fall through to static assets (marketing pages, viewer JS/CSS, images) for everything else.

import {
  PROD_API_ORIGIN,
  benchmarkHeadExtras,
  benchmarkSitemapEntries,
  benchmarkSsrBody,
  marketingSitemapEntries,
  notFoundHeadExtras,
  pageTitle,
  robotsTxt,
  sitemapXml,
  str,
  type BenchmarkResource,
  type TargetResource,
} from "./seo";

const APEX_HOST = "smplmark.org";
const WWW_HOST = "www.smplmark.org";
const APP_HOST = "app.smplmark.org";

// Server-side, the app API is reachable at the prod host (no CORS, no auth — it's a public GET). In
// the local loop DEV_APP_ORIGIN points at the local app Worker (:8788).
function apiOrigin(env: Env): string {
  return env.DEV_APP_ORIGIN || PROD_API_ORIGIN;
}

// SEO enrichment is best-effort: the page must render even if the API is slow or down, so bound the
// server-side fetches and never let a failure break the response.
const SSR_FETCH_TIMEOUT_MS = 2500;

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.api+json" },
    signal: AbortSignal.timeout(SSR_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function dataArray(doc: unknown): Record<string, unknown>[] {
  const data = (doc as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

/** /benchmarks/{key} — a single path segment after /benchmarks (not /benchmarks itself, which is the
 *  static index listing). */
function isBenchmarkDetail(pathname: string): boolean {
  return /^\/benchmarks\/[^/]+\/?$/.test(pathname);
}

/** Paths whose canonical home is the app host (console + auth). */
function isAppPage(p: string): boolean {
  const roots = ["/login", "/signup", "/account", "/auth", "/verify-email", "/accept-invitation"];
  if (p === "/api-reference") return true;
  return roots.some((r) => p === r || p.startsWith(`${r}/`));
}

function isApiPath(p: string): boolean {
  return p === "/api" || p.startsWith("/api/");
}

function keyFromDetailPath(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean); // ["benchmarks", "{key}"]
  return decodeURIComponent(parts[1] ?? "");
}

/** Fetch the shell asset (benchmark.html) for a benchmark-detail request. */
function fetchShell(request: Request, env: Env): Promise<Response> {
  const shell = new URL(request.url);
  shell.pathname = "/benchmark.html";
  return env.ASSETS.fetch(new Request(shell, { method: "GET", headers: request.headers }));
}

/**
 * Serve /benchmarks/{key}: fetch the benchmark server-side and inject the SEO-critical content into
 * the shell (title, meta, Open Graph, JSON-LD, a crawlable body block). Resilient by design:
 *   • API unreachable / slow  → serve the plain shell (200); the viewer hydrates as before.
 *   • benchmark not found      → serve the shell as a real 404 with a noindex tag (no soft-404).
 *   • benchmark found          → inject and serve 200.
 */
async function serveBenchmarkPage(request: Request, env: Env): Promise<Response> {
  const key = keyFromDetailPath(new URL(request.url).pathname);
  const origin = apiOrigin(env);

  let benchmark: BenchmarkResource | null = null;
  let reachedApi = false;
  try {
    const doc = await fetchJson(
      `${origin}/api/v1/benchmarks?filter[key]=${encodeURIComponent(key)}`,
    );
    reachedApi = true;
    const row = dataArray(doc)[0];
    if (row && typeof row.id === "string") {
      benchmark = { id: row.id, attributes: (row.attributes ?? {}) as BenchmarkResource["attributes"] };
    }
  } catch {
    reachedApi = false;
  }

  const shell = await fetchShell(request, env);

  // API down (or timed out): serve the shell untouched; the client will fetch and render.
  if (!reachedApi) return htmlResponse(shell, 200);

  // Definitive miss: a real 404, kept out of the search index.
  if (!benchmark) {
    const rewriter = new HTMLRewriter()
      .on("title", { element(e) { e.setInnerContent("Benchmark not found — smplmark"); } })
      .on("head", { element(e) { e.append(`\n  ${notFoundHeadExtras()}\n`, { html: true }); } });
    return htmlResponse(rewriter.transform(shell), 404);
  }

  const found = benchmark; // const alias so the rewriter closures see a non-null value

  // Targets feed the crawlable body block; best-effort (the head metadata doesn't need them). Fetch
  // only a sample for the visible list plus the true total, so a 5,000-target benchmark stays cheap.
  let targets: TargetResource[] = [];
  let targetTotal: number | undefined;
  try {
    const doc = await fetchJson(
      `${origin}/api/v1/targets?filter[benchmark]=${encodeURIComponent(found.id)}&page[size]=50&meta[total]=true`,
    );
    targets = dataArray(doc).flatMap((row) =>
      typeof row.id === "string"
        ? [{ id: row.id, attributes: (row.attributes ?? {}) as TargetResource["attributes"] }]
        : [],
    );
    const total = (doc as { meta?: { pagination?: { total?: unknown } } } | null)?.meta?.pagination?.total;
    if (typeof total === "number") targetTotal = total;
  } catch {
    targets = [];
  }

  const headExtras = benchmarkHeadExtras(found, { apiOrigin: origin });
  const body = benchmarkSsrBody(found, targets, targetTotal);
  const rewriter = new HTMLRewriter()
    .on("title", { element(e) { e.setInnerContent(pageTitle(found.attributes)); } })
    .on("head", { element(e) { e.append(`\n  ${headExtras}\n`, { html: true }); } })
    .on("#bm-name", { element(e) { e.setInnerContent(str(found.attributes.name)); } })
    .on("#bm-tagline", { element(e) { e.setInnerContent(str(found.attributes.description)); } })
    .on("#ssr-content", { element(e) { e.setInnerContent(body, { html: true }); } });

  // Edge-cacheable for a few minutes so steady traffic doesn't hit the API on every crawl/visit; a
  // freshly published benchmark still appears within the window (see the deploy note in README).
  return htmlResponse(rewriter.transform(shell), 200, "public, max-age=300, stale-while-revalidate=600");
}

/** Rebuild the asset response with our own status + cache headers (the asset ETag no longer applies). */
function htmlResponse(source: Response, status: number, cacheControl = "public, max-age=0, must-revalidate"): Response {
  const headers = new Headers(source.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", cacheControl);
  headers.delete("ETag");
  return new Response(source.body, { status, headers });
}

/** Dynamic /sitemap.xml: the marketing pages plus every published benchmark. */
async function serveSitemap(env: Env): Promise<Response> {
  const origin = apiOrigin(env);
  const benchmarks: BenchmarkResource[] = [];
  // Walk pages until a short one, bounded so a large catalog can't wedge the request.
  const PAGE_SIZE = 1000;
  const MAX_PAGES = 50; // sitemap protocol ceiling is 50,000 URLs
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const doc = await fetchJson(
        `${origin}/api/v1/benchmarks?sort=-published_at&page[size]=${PAGE_SIZE}&page[number]=${page}`,
      );
      const rows = dataArray(doc);
      for (const row of rows) {
        if (typeof row.id === "string") {
          benchmarks.push({ id: row.id, attributes: (row.attributes ?? {}) as BenchmarkResource["attributes"] });
        }
      }
      if (rows.length < PAGE_SIZE) break;
    }
  } catch {
    // API unreachable: still emit a valid sitemap with the static marketing URLs.
  }

  const xml = sitemapXml([...marketingSitemapEntries(), ...benchmarkSitemapEntries(benchmarks)]);
  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

function serveRobots(): Response {
  return new Response(robotsTxt(), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Domain-verification files (e.g. the Microsoft publisher-domain association) must be reachable at
    // the exact host a verifier requests, so serve /.well-known/* directly — no apex→www redirect.
    if (url.pathname.startsWith("/.well-known/")) {
      return env.ASSETS.fetch(request);
    }

    // Crawler entry points: served on any host (they emit canonical www URLs regardless), so a
    // crawler hitting either host gets them without chasing the apex→www redirect first.
    if (url.pathname === "/robots.txt") {
      return serveRobots();
    }
    if (url.pathname === "/sitemap.xml") {
      return serveSitemap(env);
    }

    // Apex → www (single canonical marketing host).
    if (url.hostname === APEX_HOST) {
      url.protocol = "https:";
      url.hostname = WWW_HOST;
      return Response.redirect(url.toString(), 301);
    }

    // App pages + API live on the app host. Redirect there so marketing "Sign in" links (and any
    // stray console/API URL or old bookmark) resolve. /api/* uses 308 to preserve method + body.
    // In the local loop the app host is the local app Worker: DEV_APP_ORIGIN comes from .dev.vars,
    // which wrangler loads only for `wrangler dev` — it does not exist in production. (Hostname
    // sniffing can't work here: wrangler dev presents requests as the configured custom domain.)
    const toAppHost = (u: URL) =>
      env.DEV_APP_ORIGIN
        ? new URL(u.pathname + u.search, env.DEV_APP_ORIGIN).toString()
        : (() => {
            u.protocol = "https:";
            u.hostname = APP_HOST;
            return u.toString();
          })();
    if (isApiPath(url.pathname)) {
      return Response.redirect(toAppHost(url), 308);
    }
    if (isAppPage(url.pathname)) {
      return Response.redirect(toAppHost(url), 301);
    }

    // Data-driven benchmark page: SEO-critical content is server-side-rendered into the shell (see
    // serveBenchmarkPage); the viewer then hydrates the interactive version on top.
    if (isBenchmarkDetail(url.pathname)) {
      return serveBenchmarkPage(request, env);
    }

    // Marketing pages, viewer assets, images, favicons.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
