// Pure helpers for the shareable-image endpoint (/embed/{publisher}/{key}.png). The Worker
// screenshots the ?embed=1 benchmark page with Browser Rendering and caches the PNG in R2 — these
// functions decide the canonical params, the R2 object key, the page URL, and request validity, all
// offline-testable.

// Bump when the embed visual changes so old cached PNGs aren't served under the new template.
// v2: pinned light palette + light-background logo (was rendering the near-white logo on a light bg).
// v3: publisher/key path scheme + vertically-centered chart frame (margins above/below).
// v4: honor the leaderboard statistic + sort direction (stat/dir) and the caller's theme (light/dark).
export const EMBED_TEMPLATE_VERSION = 4;

export const EMBED_WIDTH = 1200;
export const EMBED_HEIGHT = 630;

// Generated images are deterministic (params fully define them), so they cache forever. If ingested
// data is re-imported, bump EMBED_TEMPLATE_VERSION to invalidate.
export const EMBED_CACHE_CONTROL = "public, max-age=31536000, immutable";

// The viewer params that affect the image. Anything else (embed, api, junk) is dropped, so the
// cache-key space stays bounded and can't be inflated by cache-busting query strings.
const SCALAR_PARAM_KEYS = ["from", "to", "range", "subjects", "metrics", "view", "sort", "stat", "dir", "theme", "q", "page"];

function isEmbedParamKey(k: string): boolean {
  return SCALAR_PARAM_KEYS.includes(k) || k.startsWith("facet.");
}

/** A canonical, stable query string (sorted, view-params only) — the basis of the cache key. */
export function canonicalEmbedQuery(params: URLSearchParams): string {
  const kept: [string, string][] = [];
  for (const [k, v] of params) {
    if (isEmbedParamKey(k) && v !== "") kept.push([k, v]);
  }
  kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const out = new URLSearchParams();
  for (const [k, v] of kept) out.append(k, v);
  return out.toString();
}

/** The R2 object key: versioned, namespaced by publisher + benchmark key, with the params hash. */
export function embedObjectKey(publisher: string, benchmarkKey: string, paramsHashHex: string): string {
  return `v${EMBED_TEMPLATE_VERSION}/${publisher}/${benchmarkKey}/${paramsHashHex}.png`;
}

/** The page Browser Rendering loads and screenshots. Same host as the /embed endpoint. */
export function embedPageUrl(
  siteOrigin: string,
  publisher: string,
  benchmarkKey: string,
  canonicalQuery: string,
): string {
  const q = canonicalQuery ? canonicalQuery + "&embed=1" : "embed=1";
  return `${siteOrigin}/benchmarks/${encodeURIComponent(publisher)}/${encodeURIComponent(benchmarkKey)}?${q}#data`;
}

/** The public image URL (used for og:image and the Share menu). */
export function embedImageUrl(siteOrigin: string, publisher: string, benchmarkKey: string): string {
  return `${siteOrigin}/embed/${encodeURIComponent(publisher)}/${encodeURIComponent(benchmarkKey)}.png`;
}

export function isTimeChart(chartXKind: unknown): boolean {
  return chartXKind === "TIME";
}

/**
 * TIME charts must carry a bounded window (both `from` and `to`) so the image is deterministic and
 * safe to cache forever — an open-ended "as of now" range would drift. Returns an error string or
 * null when the request is valid.
 */
export function validateEmbedParams(chartXKind: unknown, params: URLSearchParams): string | null {
  if (isTimeChart(chartXKind) && (!params.get("from") || !params.get("to"))) {
    return "A time-series image requires a bounded range: both `from` and `to` must be set.";
  }
  return null;
}

/**
 * Parse the publisher + benchmark key out of an /embed/{publisher}/{key}.png path, or null if it
 * doesn't match (e.g. the legacy single-segment form, which the Worker redirects instead).
 */
export function refFromEmbedPath(pathname: string): { publisher: string; key: string } | null {
  const m = /^\/embed\/([^/]+)\/([^/]+)\.png$/.exec(pathname);
  return m ? { publisher: decodeURIComponent(m[1]), key: decodeURIComponent(m[2]) } : null;
}

/** Parse the key out of a legacy /embed/{key}.png path (single segment), for the redirect. */
export function legacyKeyFromEmbedPath(pathname: string): string | null {
  const m = /^\/embed\/([^/]+)\.png$/.exec(pathname);
  return m ? decodeURIComponent(m[1]) : null;
}
