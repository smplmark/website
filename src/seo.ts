// SEO enrichment for the website Worker: server-side-rendered metadata + content for the
// data-driven benchmark pages, plus the sitemap and robots.txt. Everything here is PURE — it
// takes already-fetched API data and produces strings — so the network/orchestration in index.ts
// stays thin and this logic is fully unit-testable offline.
//
// Why SSR at all: the viewer (public/js/benchmark.js) fetches and renders every benchmark's content
// client-side, so a crawler that doesn't run JS sees only a "Loading…" shell. Here the Worker fetches
// the benchmark at request time and injects the crawlable pieces — <title>, meta description, Open
// Graph/Twitter cards, JSON-LD Dataset markup (for Google Dataset Search), and a plain-HTML content
// block — before returning the shell. The interactive viewer then hydrates on top, replacing the
// injected block with the live, filterable version.

import { embedImageUrl } from "./embed";

export const SITE_ORIGIN = "https://www.smplmark.org";
export const PROD_API_ORIGIN = "https://app.smplmark.org";
const OG_IMAGE = `${SITE_ORIGIN}/img/logo-dark.png`;

const CATEGORY_LABELS: Record<string, string> = {
  HARDWARE: "Hardware",
  DATABASE: "Database",
  ML_AI: "ML & AI",
  STORAGE: "Storage",
  NETWORK: "Network",
  OTHER: "Other",
};

// Cap the SSR subject list so a 5,000-subject benchmark can't bloat the page; the interactive viewer
// shows them all. The head-line metadata already carries the count.
const SSR_SUBJECT_LIMIT = 50;

// ── The minimal API shapes we read (the app's JSON:API responses) ────────────

interface MetricDecl {
  name?: unknown;
  unit?: unknown;
}

interface MeasurementSchema {
  metrics?: MetricDecl[];
  derived?: MetricDecl[];
  chart?: { x_kind?: unknown };
}

interface PublishedAs {
  kind?: unknown;
  name?: unknown;
  source_name?: unknown;
  source_url?: unknown;
  license?: unknown;
  display_name?: unknown;
  verified_domains?: unknown;
  domain?: unknown; // ORGANIZATION publishes: the verified domain is the identity
  icon?: unknown; // "monogram" | "favicon"
}

export interface BenchmarkAttributes {
  key?: unknown;
  publisher_slug?: unknown;
  name?: unknown;
  description?: unknown;
  about?: unknown;
  methodology?: unknown;
  category?: unknown;
  tags?: unknown;
  status?: unknown;
  published_at?: unknown;
  updated_at?: unknown;
  measurement_schema?: MeasurementSchema;
  published_as?: PublishedAs;
}

export interface BenchmarkResource {
  id: string;
  attributes: BenchmarkAttributes;
}

export interface SubjectResource {
  id: string;
  attributes: { key?: unknown; name?: unknown };
}

// ── Small pure helpers ───────────────────────────────────────────────────────

export function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] as string,
  );
}

// JSON embedded in a <script> must not let a "</script>" (or an HTML comment opener) end the block.
function escapeJsonForScript(json: string): string {
  return json.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function tagList(tags: unknown): string[] {
  return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string" && t.length > 0) : [];
}

function metricNames(schema: MeasurementSchema | undefined): string[] {
  const all = [...(schema?.metrics ?? []), ...(schema?.derived ?? [])];
  return all.map((m) => str(m?.name)).filter((n) => n.length > 0);
}

/** Collapse to a single line and clip to a snippet-friendly length on a word boundary. */
function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

/** The meta/OG description: the tagline, else an excerpt of the overview, else a generic line. */
export function metaDescription(a: BenchmarkAttributes): string {
  const description = str(a.description).trim();
  if (description) return clip(description, 200);
  const about = str(a.about).trim();
  if (about) return clip(about, 200);
  return clip(`${str(a.name) || "A benchmark"} — a benchmark published on smplmark.`, 200);
}

export function pageTitle(a: BenchmarkAttributes): string {
  const name = str(a.name).trim() || "Benchmark";
  return `${name} — smplmark`;
}

export function canonicalUrl(publisher: string, key: string, siteOrigin = SITE_ORIGIN): string {
  return `${siteOrigin}/benchmarks/${encodeURIComponent(publisher)}/${encodeURIComponent(key)}`;
}

function publisherName(pa: PublishedAs | undefined): string {
  if (!pa) return "";
  // ORGANIZATION publishes carry only the verified domain as their identity (no separate name).
  return str(pa.source_name) || str(pa.name) || str(pa.display_name) || str(pa.domain);
}

// ── JSON-LD Dataset (Google Dataset Search) ──────────────────────────────────

// Canonical URLs for the license identifiers our ingested sources carry, so schema.org's
// Dataset.license (which wants a URL or a CreativeWork — never a bare identifier) can point at the
// real license text. Anything not listed still emits as a name-only CreativeWork (a valid object
// type), which is what keeps Google's "Invalid object type for field license" report clean.
const LICENSE_URLS: Record<string, string> = {
  "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
  "CC-BY-4.0": "https://creativecommons.org/licenses/by/4.0/",
  "CC-BY-SA-4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
  "CC-BY-ND-4.0": "https://creativecommons.org/licenses/by-nd/4.0/",
  "CC-BY-NC-4.0": "https://creativecommons.org/licenses/by-nc/4.0/",
  "CC-BY-NC-SA-4.0": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
  "CC-BY-NC-ND-4.0": "https://creativecommons.org/licenses/by-nc-nd/4.0/",
};

export function datasetJsonLd(
  b: BenchmarkResource,
  opts: { siteOrigin?: string; apiOrigin: string },
): Record<string, unknown> {
  const a = b.attributes;
  const key = str(a.key);
  const publisher = str(a.publisher_slug);
  const pa = a.published_as;
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: str(a.name),
    description: metaDescription(a),
    url: canonicalUrl(publisher, key, opts.siteOrigin),
    identifier: key,
    isAccessibleForFree: true,
  };

  const keywords = [...tagList(a.tags)];
  const categoryLabel = CATEGORY_LABELS[str(a.category)];
  if (categoryLabel && str(a.category) !== "OTHER") keywords.push(categoryLabel);
  if (keywords.length) ld.keywords = keywords;

  if (str(a.published_at)) ld.datePublished = str(a.published_at);
  if (str(a.updated_at)) ld.dateModified = str(a.updated_at);

  const metrics = metricNames(a.measurement_schema);
  if (metrics.length) ld.variableMeasured = metrics;

  const name = publisherName(pa);
  if (name) {
    const kind = str(pa?.kind);
    const creator: Record<string, unknown> = {
      "@type": kind === "PERSONAL" ? "Person" : "Organization",
      name,
    };
    const sourceUrl = str(pa?.source_url);
    if (sourceUrl) creator.url = sourceUrl;
    ld.creator = creator;
  }

  if (pa && str(pa.kind) === "INGESTED") {
    const license = str(pa.license);
    if (license) {
      // A CreativeWork (never a bare identifier string), with the canonical license URL when known.
      const work: Record<string, unknown> = { "@type": "CreativeWork", name: license };
      const licenseUrl = LICENSE_URLS[license];
      if (licenseUrl) work.url = licenseUrl;
      ld.license = work;
    }
    const sourceUrl = str(pa.source_url);
    if (sourceUrl) ld.isBasedOn = sourceUrl;
  }

  // The raw data is fetchable as JSON straight from the public API.
  ld.distribution = [
    {
      "@type": "DataDownload",
      encodingFormat: "application/json",
      contentUrl: `${opts.apiOrigin}/api/v1/measurements?filter[benchmark]=${encodeURIComponent(b.id)}`,
    },
  ];

  return ld;
}

// ── <head> injection ─────────────────────────────────────────────────────────

/** Meta/link/JSON-LD tags appended to <head> for a found benchmark. The <title> is set separately. */
export function benchmarkHeadExtras(
  b: BenchmarkResource,
  opts: { siteOrigin?: string; apiOrigin: string },
): string {
  const a = b.attributes;
  const key = str(a.key);
  const publisher = str(a.publisher_slug);
  const title = pageTitle(a);
  const description = metaDescription(a);
  const canonical = canonicalUrl(publisher, key, opts.siteOrigin);
  const jsonLd = escapeJsonForScript(JSON.stringify(datasetJsonLd(b, opts)));

  // Social card: for chart/table benchmarks, unfurl the actual chart (a generated 1200×630 image);
  // for TIME series we'd need a bounded window we don't have at page level, so keep the logo. The
  // large-image Twitter card shows the chart prominently; the logo uses the plain summary card.
  const xKind = a.measurement_schema?.chart?.x_kind;
  const hasChartImage = xKind !== undefined && xKind !== "TIME";
  const image = hasChartImage
    ? embedImageUrl(opts.siteOrigin ?? SITE_ORIGIN, publisher, key)
    : OG_IMAGE;
  const twitterCard = hasChartImage ? "summary_large_image" : "summary";

  const meta: string[] = [
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    `<meta name="robots" content="index, follow" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="smplmark" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta name="twitter:card" content="${twitterCard}" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
    `<script type="application/ld+json">${jsonLd}</script>`,
  ];
  return meta.join("\n  ");
}

/** Head tags for a benchmark that doesn't exist — a real 404, kept out of the index. */
export function notFoundHeadExtras(): string {
  return [
    `<meta name="robots" content="noindex" />`,
    `<meta name="description" content="No published benchmark with this key." />`,
  ].join("\n  ");
}

// ── Visible SSR body content (removed by the viewer on hydration) ─────────────

// A small, XSS-safe Markdown → HTML renderer for publisher-authored prose (Overview / Methodology),
// mirroring the client viewer's renderer in public/js/benchmark.js so SSR and hydrated output match.
// Literal text is HTML-escaped FIRST, so nothing from the source reaches the DOM as markup — only the
// fixed tag set below is ever emitted, and link hrefs are restricted to http(s)/mailto. Emphasis uses
// asterisks only, so snake_case identifiers are left alone. A pragmatic CommonMark subset, not the spec.
function renderMarkdown(text: string): string {
  if (text == null || text.trim() === "") return "";
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  const linkHref = (u: string): string | null => {
    const t = u.trim();
    if (/^mailto:/i.test(t)) return t;
    try {
      const p = new URL(t);
      return p.protocol === "http:" || p.protocol === "https:" ? p.href : null;
    } catch {
      return null;
    }
  };
  const inline = (s: string): string => {
    let res = "";
    let rest = s;
    const re = /(`+)([\s\S]*?)\1|\[([^\]]+)\]\(([^)\s]+)\)|(\*\*)([\s\S]+?)\*\*|(\*)([\s\S]+?)\*/;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rest)) !== null) {
      res += escapeHtml(rest.slice(0, m.index));
      if (m[1] !== undefined) res += `<code>${escapeHtml(m[2])}</code>`;
      else if (m[3] !== undefined) {
        const href = linkHref(m[4]);
        res += href
          ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener nofollow">${inline(m[3])}</a>`
          : escapeHtml(m[0]);
      } else if (m[5] !== undefined) res += `<strong>${inline(m[6])}</strong>`;
      else res += `<em>${inline(m[8])}</em>`;
      rest = rest.slice(m.index + m[0].length);
    }
    return res + escapeHtml(rest);
  };

  const blank = (l: string) => /^\s*$/.test(l);
  const heading = (l: string) => /^#{1,6}\s+/.test(l);
  const quote = (l: string) => /^\s*>\s?/.test(l);
  const ul = (l: string) => /^\s*[-*+]\s+/.test(l);
  const ol = (l: string) => /^\s*\d+\.\s+/.test(l);
  const rule = (l: string) => /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
  const fence = (l: string) => /^\s*```/.test(l);

  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) { i++; continue; }
    if (fence(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !fence(lines[i])) { code.push(lines[i]); i++; }
      i++; // closing fence
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    if (heading(line)) {
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) out.push(`<h${h[1].length}>${inline(h[2].trim())}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (rule(line)) { out.push("<hr />"); i++; continue; }
    if (quote(line)) {
      const q: string[] = [];
      while (i < lines.length && quote(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
      out.push(`<blockquote>${renderMarkdown(q.join("\n"))}</blockquote>`);
      continue;
    }
    if (ul(line)) {
      const items: string[] = [];
      while (i < lines.length && ul(lines[i])) { items.push(lines[i].replace(/^\s*[-*+]\s+/, "")); i++; }
      out.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</ul>`);
      continue;
    }
    if (ol(line)) {
      const items: string[] = [];
      while (i < lines.length && ol(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, "")); i++; }
      out.push(`<ol>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</ol>`);
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length && !blank(lines[i]) && !fence(lines[i]) && !heading(lines[i]) &&
      !rule(lines[i]) && !quote(lines[i]) && !ul(lines[i]) && !ol(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${para.map((l) => inline(l)).join("<br />")}</p>`);
  }
  return out.join("");
}

/**
 * The crawlable content block injected into #ssr-content: overview, metrics, subjects, methodology,
 * and publisher — all as plain HTML. The viewer removes this the moment it has the live data, so
 * there is no duplication for JS visitors and no cloaking (same content either way).
 *
 * `subjects` is a sample for the visible list (we fetch only the first page); `subjectTotal` is the
 * true count (from the API's meta), so the heading is accurate even when we listed only a slice.
 */
export function benchmarkSsrBody(
  b: BenchmarkResource,
  subjects: SubjectResource[],
  subjectTotal?: number,
): string {
  const a = b.attributes;
  const parts: string[] = [];

  const overview = str(a.about) || str(a.description);
  if (overview) parts.push(renderMarkdown(overview));

  const metrics = metricNames(a.measurement_schema);
  if (metrics.length) {
    parts.push(
      `<h2>Metrics</h2><ul>${metrics.map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ul>`,
    );
  }

  const names = subjects
    .map((t) => str(t.attributes?.name) || str(t.attributes?.key))
    .filter((n) => n.length > 0);
  if (names.length) {
    const shown = names.slice(0, SSR_SUBJECT_LIMIT);
    const total = typeof subjectTotal === "number" && subjectTotal >= names.length ? subjectTotal : names.length;
    const more = total - shown.length;
    parts.push(
      `<h2>Subjects (${total})</h2><ul>${shown.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>` +
        (more > 0 ? `<p>…and ${more} more.</p>` : ""),
    );
  }

  const methodology = str(a.methodology);
  if (methodology) parts.push(`<h2>Methodology</h2>${renderMarkdown(methodology)}`);

  const publisher = publisherName(a.published_as);
  if (publisher) parts.push(`<p>Published by ${escapeHtml(publisher)}.</p>`);

  return parts.join("\n");
}

// ── Sitemap + robots ─────────────────────────────────────────────────────────

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

/** The always-present marketing URLs (paths that resolve on the website host, not app redirects). */
export function marketingSitemapEntries(siteOrigin = SITE_ORIGIN): SitemapEntry[] {
  return ["/", "/benchmarks", "/about", "/sources", "/terms", "/privacy"].map((p) => ({
    loc: p === "/" ? `${siteOrigin}/` : `${siteOrigin}${p}`,
  }));
}

/** Turn the published-benchmark list into sitemap entries (lastmod from updated_at when present). */
export function benchmarkSitemapEntries(
  benchmarks: BenchmarkResource[],
  siteOrigin = SITE_ORIGIN,
): SitemapEntry[] {
  return benchmarks
    .map((b) => {
      const key = str(b.attributes.key);
      const publisher = str(b.attributes.publisher_slug);
      if (!key || !publisher) return null;
      const entry: SitemapEntry = { loc: canonicalUrl(publisher, key, siteOrigin) };
      const lastmod = str(b.attributes.updated_at);
      if (lastmod) entry.lastmod = lastmod;
      return entry;
    })
    .filter((e): e is SitemapEntry => e !== null);
}

export function sitemapXml(entries: SitemapEntry[]): string {
  const urls = entries
    .map((e) => {
      const lastmod = e.lastmod ? `<lastmod>${escapeXml(e.lastmod)}</lastmod>` : "";
      return `<url><loc>${escapeXml(e.loc)}</loc>${lastmod}</url>`;
    })
    .join("\n  ");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  ${urls}\n</urlset>\n`
  );
}

export function robotsTxt(siteOrigin = SITE_ORIGIN): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${siteOrigin}/sitemap.xml\n`;
}
