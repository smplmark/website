"use strict";

// Data-driven benchmark page. Everything shown is pulled from the API for the {key} in the URL.
// The chart renders one of three modes declared in measurement_schema.chart:
//   TIME     x = created_at        → time-series (scheduler-latency)
//   NUMBER   x = a numeric metric  → numeric-x overlay (aligns disjoint runs, e.g. elapsed_ms)
//   CATEGORY x = null              → one bar per subject (a scalar per subject)
// Credibility (§8) is surfaced, never hidden: a WITHDRAWN benchmark keeps a banner; invalidated
// runs are listed and flagged; live runs show a "still recording" indicator.

const COLORS = ["#4f8cff", "#f78166", "#3fb950", "#d2a8ff", "#ffa657", "#79c0ff"];
const RANGE_SECONDS = { all: null, "24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400 };

const el = (id) => document.getElementById(id);
const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

function apiFetchHint() {
  const h = location.hostname;
  return h === "localhost" || h === "127.0.0.1"
    ? " Is the app Worker running? Start it with `npm run dev` in the app repo (or the \u201Capi\u201D server in the preview panel) \u2014 it serves the local API on :8788."
    : "";
}

function safeHttpUrl(u) {
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:" ? p.href : null;
  } catch (_) {
    return null;
  }
}

function checkIcon() {
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
  );
}

function gravatarUrl(hash, size) {
  // gravatar_hash is a SHA-256 of the lowercased email (Gravatar accepts SHA-256 or MD5).
  if (!/^[0-9a-f]{32,64}$/i.test(hash || "")) return null;
  return "https://www.gravatar.com/avatar/" + hash + "?s=" + size + "&d=mp";
}

// The publisher's own external URL (opened from the byline). For the smplmark view of the publisher,
// visitors use the Publisher tab instead. Null when we have no external URL for them.
function publisherUrl(pa) {
  if (!pa) return null;
  if (pa.kind === "INGESTED") return safeHttpUrl(pa.source_url);
  if (pa.kind === "ORGANIZATION") {
    return pa.domain ? "https://" + String(pa.domain) : null;
  }
  return null; // PERSONAL: no external site
}

// Build the frozen attribution badge from a benchmark's published_as snapshot. When nameHref is
// given the name is a link; an external (http) href opens in a new tab.
function attributionMarkup(pa, nameHref) {
  if (!pa) return "";
  const label = esc(pa.source_name || pa.name || pa.display_name || "");
  const external = nameHref && /^https?:/i.test(nameHref);
  const nameEl = nameHref
    ? '<a href="' + esc(nameHref) + '" class="attribution-name" id="byline-link"' +
      (external ? ' target="_blank" rel="noopener"' : "") + ">" + label + "</a>"
    : '<span class="attribution-name">' + label + "</span>";
  if (pa.kind === "ORGANIZATION") {
    // An organization publish IS its verified domain — show the domain, its favicon (or a monogram
    // fallback), and a verified check. The API sends { kind, domain, icon }.
    const domain = String(pa.domain || "");
    if (!domain) return '<span class="attribution"><span class="who">' + nameEl + "</span></span>";
    const iconEl =
      '<span class="attribution-icon"><span class="attribution-mono" aria-hidden="true">' +
      esc(domain.charAt(0).toUpperCase()) + "</span>" +
      (pa.icon === "favicon" ? '<img class="attribution-favicon" alt="" data-fav-domain="' + esc(domain) + '" />' : "") +
      "</span>";
    const domHref = nameHref || "https://" + domain;
    const domName =
      '<a href="' + esc(domHref) + '" class="attribution-name" id="byline-link" target="_blank" rel="noopener">' +
      esc(domain) + "</a>";
    // Verification is shown by the caller's own pill (verifiedPill / publisher-kind), so the badge
    // itself is just the icon + domain — no duplicate "verified" chip here.
    return '<span class="attribution"><span class="who">' + iconEl + domName + "</span></span>";
  }
  if (pa.kind === "INGESTED") {
    // The badge is simply the source's name; license and attribution details live on /about.
    return '<span class="attribution"><span class="who">' + nameEl + "</span></span>";
  }
  // PERSONAL
  const g = gravatarUrl(pa.gravatar_hash, 44);
  const avatar = g ? '<img class="attribution-avatar" src="' + esc(g) + '" alt="" />' : "";
  return '<span class="attribution"><span class="who">' + avatar + nameEl + "</span></span>";
}

const CATEGORY_LABELS = {
  HARDWARE: "Hardware",
  DATABASE: "Database",
  ML_AI: "ML & AI",
  STORAGE: "Storage",
  NETWORK: "Network",
  OTHER: "Other",
};

// Category + tag chips. The category chip links to the filtered browse page, tags likewise.
function chipsMarkup(a) {
  const chips = [];
  if (a.category && a.category !== "OTHER") {
    chips.push(
      '<a class="pill category" href="' + esc(withApi('/benchmarks?category=' + encodeURIComponent(a.category))) + '">' +
        esc(CATEGORY_LABELS[a.category] || a.category) + "</a>",
    );
  }
  for (const t of Array.isArray(a.tags) ? a.tags : []) {
    chips.push('<a class="pill tag" href="' + esc(withApi('/benchmarks?tag=' + encodeURIComponent(t))) + '">' + esc(t) + "</a>");
  }
  return chips.join("");
}

// Drop a badge image that fails to load (missing logo / gravatar 404) rather than showing a broken icon.
function wireBadgeImages(container) {
  if (!container) return;
  container.querySelectorAll(".attribution-logo, .attribution-avatar").forEach((img) => {
    img.addEventListener("error", () => img.remove());
  });
}

// Resolve an organization's favicon: sites keep their icon at different conventional paths (many have
// no /favicon.ico — they declare an SVG/PNG via <link>, which we can't read cross-origin). Probe the
// common paths in order; the first that loads as an image wins. If none do, drop the <img> so the
// monogram underneath shows through.
var FAVICON_PATHS = ["/favicon.ico", "/favicon.svg", "/apple-touch-icon.png", "/favicon.png"];
function wirePublisherFavicons(container) {
  if (!container) return;
  container.querySelectorAll("img.attribution-favicon[data-fav-domain]").forEach((img) => {
    const domain = String(img.getAttribute("data-fav-domain") || "").trim();
    const urls = domain ? FAVICON_PATHS.map((p) => "https://" + domain + p) : [];
    let i = 0;
    const tryNext = () => {
      if (i >= urls.length) { img.remove(); return; } // reveal the monogram
      img.src = urls[i++];
    };
    img.addEventListener("error", tryNext);
    img.addEventListener("load", () => { if (img.naturalWidth > 0) img.style.opacity = "1"; else tryNext(); });
    tryNext();
  });
}

// /benchmarks/{publisher}/{key} — the publisher slug and benchmark key from the address bar. The
// two together identify the benchmark (keys are unique only within a publisher).
function refFromPath() {
  const parts = location.pathname.split("/").filter(Boolean); // ["benchmarks", pub, key]
  return {
    publisher: decodeURIComponent(parts[1] || ""),
    key: decodeURIComponent(parts[2] || ""),
  };
}

// The API lives on the app host (app.smplmark.org) — a different origin from this site — so every
// request below is cross-origin (the app answers CORS for our origin). Local dev: append
// ?api=http://localhost:8788 (or set window.SM_API_BASE) to point at a locally-running app Worker.
function apiBase() {
  try {
    const override = new URLSearchParams(location.search).get("api");
    if (override) return override.replace(/\/+$/, "");
  } catch (_) {}
  if (window.SM_API_BASE) return String(window.SM_API_BASE).replace(/\/+$/, "");
  const h = location.hostname;
  if (h === "www.smplmark.org" || h === "smplmark.org") return "https://app.smplmark.org";
  // Local-loop convention: website on :8787, app API on :8788 (README "Local development").
  if (h === "localhost" || h === "127.0.0.1") return "http://localhost:8788";
  return ""; // same-origin fallback (e.g. a combined preview deployment)
}

// Keep an explicit ?api= override sticky across internal navigation (dev tool: lets the local
// site browse any API host without losing the override on every click).
function withApi(path) {
  try {
    const override = new URLSearchParams(location.search).get("api");
    if (override) {
      return path + (path.includes("?") ? "&" : "?") + "api=" + encodeURIComponent(override);
    }
  } catch (_) {}
  return path;
}
const API = apiBase();

// The canonical URL to share/cite: the current address (which the deep-link params keep in sync
// with the on-screen view) minus the dev-only ?api= override, so a shared link is never local.
function shareUrl() {
  try {
    const u = new URL(location.href);
    u.searchParams.delete("api");
    return u.toString();
  } catch (_) {
    return location.href;
  }
}

// The shareable PNG for the current view: /embed/{key}.png carrying the same view params (no hash,
// no ?api=/embed). Served by the Worker (generated once, cached). For a TIME benchmark the endpoint
// needs a bounded from/to; for everything else any view works.
function embedImageUrl() {
  try {
    const u = new URL(shareUrl());
    u.searchParams.delete("embed");
    u.hash = "";
    const qs = u.searchParams.toString();
    const ref = refFromPath();
    return (
      u.origin +
      "/embed/" +
      encodeURIComponent(ref.publisher) +
      "/" +
      encodeURIComponent(ref.key) +
      ".png" +
      (qs ? "?" + qs : "")
    );
  } catch (_) {
    return "";
  }
}

async function errorDetail(res) {
  try {
    const doc = await res.json();
    if (doc.errors && doc.errors[0] && doc.errors[0].detail) return doc.errors[0].detail;
  } catch (_) {}
  return "HTTP " + res.status;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/vnd.api+json" } });
  if (!res.ok) throw new Error(await errorDetail(res));
  return res.json();
}

// Never assume a collection fits one page: walk page[number] until a short page, bounded by a
// hard client ceiling so a huge benchmark can't wedge the tab. Callers surface `truncated`.
const PAGE_SIZE = 1000;
// The 5,000-row ceiling is gone: we deliberately pull the WHOLE collection into memory (the "fetch
// everything, render client-side" model) to feel the real cost. MAX_PAGES is only a runaway backstop
// (1,000,000 rows) so a pathological benchmark can't wedge the tab forever.
const MAX_PAGES = 1000;
// Offset pagination needs a stable total order or pages can skip/duplicate rows. created_at is
// allowed on every collection and the server always appends an `id` tiebreaker, so it's fully stable.
const STABLE_SORT = "created_at";
async function fetchAllPages(url) {
  const data = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const sep = url.includes("?") ? "&" : "?";
    const doc = await fetchJson(
      url + sep + "sort=" + STABLE_SORT + "&page[number]=" + page + "&page[size]=" + PAGE_SIZE,
    );
    data.push(...doc.data);
    if (doc.data.length < PAGE_SIZE) return { data: data, truncated: false };
  }
  return { data: data, truncated: true };
}

function paragraphs(text) {
  if (!text) return '<p class="muted">Not provided.</p>';
  return String(text)
    .split(/\n\s*\n/)
    .map((p) => `<p>${esc(p.trim())}</p>`)
    .join("");
}

function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

let benchmark = null;
let publisher = null;
let subjects = [];
let subjectsTruncated = false;
let runs = []; // benchmark-wide; each carries attributes incl subject + live + invalidated
let runsTruncated = false;
let metricList = [];
let chartDecl = null;
let chartMode = "TIME";
let chart = null;
let chartDrawn = false;
let chartView = "bars"; // CATEGORY visualization: "bars" | "table"
// Filter model — every value is CHECKED (shown) by default. Per field, the state is one of:
//   • ALL — no `filters` entry: every value checked/shown (the default).
//   • { mode:"IN", set } — INCLUDE: only the listed values are checked/shown ("only"/compare-a-few).
//   • { mode:"EX", set } — EXCLUDE: every value EXCEPT the listed ones is checked/shown (uncheck-to-hide).
// SUBJECT_FIELD keys the subject selection; detail fields key the derived facets. Select-all / Clear
// return a field (or all fields) to ALL, i.e. all boxes checked.
let filters = {}; // field → { mode:"IN"|"EX", set:Set<string> }
let metricSelection = []; // checked metric names, in schema order
// The time window behind filter[created_at]: a preset ({preset} — "last N as of now") or
// absolute UTC bounds ({from,to} in ms, either side null ⇒ open). URL from/to seeds the latter.
let rangeState = { preset: "all" };
let preZoomRange = null; // rangeState before the first drag-zoom; restored on double-click reset
let lastDrawnRange = null; // the filter[created_at] value the drawn chart was fetched with

// Embed mode (?embed=1): render ONLY the chart/table at a fixed size, no chrome, for the server-side
// image generator (Browser Rendering screenshots this page — see the /embed/{key}.png Worker route).
// Signals window.__EMBED_READY once the data has drawn so the screenshotter knows when to capture.
const embedMode = (() => {
  try { return new URLSearchParams(location.search).get("embed") === "1"; } catch (_) { return false; }
})();
const EMBED_ROWS = 12; // top-N bars/rows shown in an image (a table/bars image can't scroll)

function markEmbedReady() {
  window.__EMBED_READY = true;
  document.body.setAttribute("data-embed-ready", "1");
}

// A short caption line for an embed image: source · plotted metric · (date range, for TIME).
function embedSummary(a) {
  const parts = [];
  const pa = a.published_as;
  const src = pa && (pa.source_name || pa.name || pa.display_name);
  if (src) parts.push(src);
  // The metric the image actually shows (the user's choice), not the benchmark's default headline.
  const y = currentY();
  if (y) parts.push(titleCase(y));
  if (chartMode === "TIME" && rangeState.from != null && rangeState.to != null) {
    parts.push(fmtDate(new Date(rangeState.from).toISOString()) + " – " + fmtDate(new Date(rangeState.to).toISOString()));
  }
  return parts.join(" · ");
}

// Wrap the (chrome-stripped) data panel in a branded title bar + caption so the image is a
// self-contained, citable graphic: benchmark name + smplmark wordmark on top, source/metric/range
// and the canonical URL along the bottom.
function renderEmbedChrome() {
  document.body.classList.add("embed");
  const a = benchmark.attributes;
  const wrap = document.querySelector("main .wrap");

  const title = document.createElement("div");
  title.className = "embed-title";
  title.innerHTML =
    '<span class="embed-name">' + esc(a.name) + "</span>" +
    // The embed frame is pinned to the light palette, so use the dark-ink logo (logo-light.png).
    '<img class="embed-brand" src="/img/logo-light.png" alt="smplmark" height="22" />';

  const caption = document.createElement("div");
  caption.className = "embed-caption";
  caption.innerHTML =
    '<span class="embed-summary">' + esc(embedSummary(a)) + "</span>" +
    '<span class="embed-url">smplmark.org/benchmarks/' + esc(a.publisher_slug) + "/" + esc(a.key) + "</span>";

  wrap.insertBefore(title, wrap.firstChild);
  wrap.appendChild(caption);
}

async function init() {
  const crumb = el("crumb-back");
  if (crumb) crumb.href = withApi("/benchmarks");
  const ref = refFromPath();
  try {
    const doc = await fetchJson(
      API +
        "/api/v1/benchmarks?filter[publisher]=" +
        encodeURIComponent(ref.publisher) +
        "&filter[key]=" +
        encodeURIComponent(ref.key),
    );
    benchmark = doc.data[0];
  } catch (err) {
    el("bm-name").textContent = "Error";
    el("load-status").className = "status error";
    el("load-status").textContent = "Failed to load benchmark: " + err.message + "." + apiFetchHint();
    return;
  }
  if (!benchmark) {
    el("bm-name").textContent = "Benchmark not found";
    el("load-status").textContent =
      "No published benchmark at “" + ref.publisher + "/" + ref.key + "”.";
    return;
  }

  // The server-rendered SEO block (if any) is now superseded by the live interactive render — drop
  // it so there's no duplicate content. Left in place when load fails, as a readable fallback.
  const ssr = el("ssr-content");
  if (ssr) ssr.remove();

  const a = benchmark.attributes;
  document.title = a.name + " — smplmark";

  // Popularity beacon: fire-and-forget, once per page load. Skipped for embeds — a server-side
  // image render isn't a human view. Failure is invisible by design.
  if (!embedMode) {
    fetch(API + "/api/v1/benchmarks/" + encodeURIComponent(benchmark.id) + "/actions/view", {
      method: "POST",
    }).catch(() => {});
  }

  try {
    publisher = (await fetchJson(API + "/api/v1/accounts/" + encodeURIComponent(a.account))).data;
  } catch (_) {
    publisher = null;
  }
  const schema = a.measurement_schema || { metrics: [], derived: [] };
  metricList = [...(schema.metrics || []), ...(schema.derived || [])];
  chartDecl = schema.chart || inferChart(metricList);
  chartMode = chartDecl ? chartDecl.x_kind || inferKind(chartDecl.x) : "TIME";

  // One model for every benchmark, large or small (no server-side ranking endpoint): pull the WHOLE
  // benchmark into the browser — all subjects, all runs, and (lazily, on first draw) all measurements —
  // then sort/filter/render entirely client-side. fetchAllPages walks every page with no row ceiling,
  // so the real cost of the "fetch everything" model is felt directly.
  try {
    const res = await fetchAllPages(API + "/api/v1/subjects?filter[benchmark]=" + encodeURIComponent(benchmark.id));
    subjects = res.data;
    subjectsTruncated = res.truncated;
  } catch (_) {
    subjects = [];
  }
  // Runs: one benchmark-wide request (not one per subject), for live + invalidation surfacing. A run
  // is a benchmark child (it spans subjects); the chart groups by each measurement's own subject, so no
  // run→subject map is needed. Best-effort.
  runs = [];
  try {
    const res = await fetchAllPages(API + "/api/v1/runs?filter[benchmark]=" + encodeURIComponent(benchmark.id));
    runs = res.data;
    runsTruncated = res.truncated;
  } catch (_) {}

  // Embed mode: render only the data panel (branded), await the draw, and signal ready for the
  // screenshotter — no tabs, no chrome, no other panels.
  if (embedMode) {
    readViewParams();
    setupChartControls();
    renderEmbedChrome();
    // The data panel must be visible (not display:none) so uPlot can measure it and draw.
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === "data"));
    el("tabs-wrap").hidden = false;
    try {
      chartDrawn = true;
      await drawChart();
    } catch (_) {}
    markEmbedReady();
    return;
  }

  renderHead();
  renderBanners();
  renderOverview();
  renderMetrics();
  renderMethodology();
  renderPublisher();
  // Before setupTabs: an initial #data hash (or a deep link) draws the chart immediately, and
  // that first draw must already see the URL-seeded range/subjects/metrics/view/sort.
  readViewParams();
  // Build the data-panel controls BEFORE setupTabs, because landing on the Data tab (now the default)
  // draws the chart immediately, which needs the controls already in place.
  setupChartControls();
  setupTabs();

  el("tabs-wrap").hidden = false;

  // Every public benchmark (published or withdrawn) carries the quiet takedown-request affordance.
  const takedown = el("takedown-line");
  if (takedown) {
    takedown.hidden = false;
    el("takedown-link").addEventListener("click", openTakedownModal);
  }
}

function inferChart(metrics) {
  const y = metrics[0] ? metrics[0].name : null;
  return y ? { x: "created_at", y: y, x_kind: "TIME" } : null;
}
function inferKind(x) {
  if (x === null || x === undefined) return "CATEGORY";
  return x === "created_at" ? "TIME" : "NUMBER";
}

function renderHead() {
  const a = benchmark.attributes;
  el("bm-name").innerHTML =
    esc(a.name) +
    (a.status === "WITHDRAWN"
      ? ' <span class="pill withdrawn">withdrawn</span>'
      : !a.closed
        ? ' <span class="pill live" title="This benchmark is live — the publisher is still adding data.">live</span>'
        : "");
  el("bm-tagline").textContent = a.description || "";
  const chipsBox = el("bm-chips");
  if (chipsBox) chipsBox.innerHTML = chipsMarkup(a);
  // Byline: the publisher at a glance — name + verification tier, from the frozen published_as
  // snapshot. The name links to the publisher's own site (new tab); the Publisher tab holds
  // smplmark's view of them. The 5px gap before the pill is CSS (.byline .publisher-kind).
  const pa = a.published_as;
  if (pa) {
    el("bm-byline").innerHTML = attributionMarkup(pa, publisherUrl(pa)) + verifiedPill(pa);
    wireBadgeImages(el("bm-byline"));
    wirePublisherFavicons(el("bm-byline"));
  } else {
    el("bm-byline").textContent = "";
  }
}

/** ORGANIZATION (domain-proven) and INGESTED (pulled directly from the source) are Verified. */
function verifiedPill(pa) {
  const verified = pa.kind === "ORGANIZATION" || pa.kind === "INGESTED";
  return (
    '<span class="publisher-kind' + (verified ? " verified" : "") + '">' +
    (verified ? checkIcon() + "Verified" : "Unverified") + "</span>"
  );
}

function renderBanners() {
  const box = el("banners");
  const a = benchmark.attributes;
  let html = "";
  if (a.status === "WITHDRAWN") {
    html +=
      '<div class="banner withdrawn"><strong>This benchmark was withdrawn' +
      (a.withdrawn_at ? " on " + esc(fmtDate(a.withdrawn_at)) : "") +
      ".</strong> " +
      esc(a.withdrawal_reason || "") +
      " The data below is kept public for the record.</div>";
  }
  const invalid = runs.filter((r) => r.attributes.invalidated);
  if (invalid.length) {
    const names = invalid.map((r) => esc(r.attributes.name || r.attributes.key)).join(", ");
    html +=
      '<div class="banner invalidated"><strong>Invalidated run' +
      (invalid.length > 1 ? "s" : "") +
      ":</strong> " +
      names +
      ". These runs remain visible and are plotted with the rest, flagged as invalid.</div>";
  }
  const live = runs.filter((r) => r.attributes.live);
  if (live.length) {
    html += '<div class="banner live"><span class="dot"></span>' + live.length + " live run" + (live.length > 1 ? "s" : "") + " — still recording.</div>";
  }
  if (subjectsTruncated || runsTruncated) {
    html +=
      '<div class="banner"><strong>Large benchmark:</strong> showing the first ' +
      (subjectsTruncated ? subjects.length + " subjects" : runs.length + " runs") +
      ". Narrow the view with the subject picker on the Data tab.</div>";
  }
  box.innerHTML = html;
}

function renderOverview() {
  el("overview-about").innerHTML = paragraphs(benchmark.attributes.about || benchmark.attributes.description);
}

// Metrics live in their own tab, as a table: name · unit · description (unit is em-dash when absent).
function renderMetrics() {
  const box = el("metrics-body");
  if (!box) return;
  if (!metricList.length) {
    box.innerHTML = '<p class="muted">This benchmark declares no metrics.</p>';
    return;
  }
  box.innerHTML =
    '<table class="metrics-table"><thead><tr>' +
    "<th>Metric</th><th>Unit</th><th>Description</th></tr></thead><tbody>" +
    [...metricList]
      .sort((a, z) => a.name.localeCompare(z.name, undefined, { numeric: true, sensitivity: "base" }))
      .map(
        (m) =>
          "<tr><td class=\"metric-name\">" + esc(m.name) + "</td>" +
          '<td class="metric-unit">' + (m.unit ? esc(m.unit) : "—") + "</td>" +
          '<td class="metric-desc">' + (m.description ? esc(m.description) : "") + "</td></tr>",
      )
      .join("") +
    "</tbody></table>";
}

function renderMethodology() {
  const a = benchmark.attributes;
  if (a.methodology) {
    el("methodology-body").innerHTML = paragraphs(a.methodology);
    return;
  }
  const pa = a.published_as;
  const src = pa && pa.kind === "INGESTED" ? safeHttpUrl(pa.source_url) : null;
  el("methodology-body").innerHTML =
    '<p class="muted">No published methodology.</p>' +
    (src
      ? '<p class="muted">See <a class="site" href="' + esc(src) + '" target="_blank" rel="noopener">' +
        esc(pa.source_name || "the source") + "</a> for how these results were produced.</p>"
      : "");
}

function renderPublisher() {
  const box = el("publisher-body");
  const pa = benchmark.attributes.published_as;
  let html = "";
  if (pa && pa.kind === "INGESTED") {
    // Who published the data (the source), that they're verified (we pulled it from them
    // directly), the URL it came from — visible at a glance — and freshness. License details
    // live on /sources.
    const src = safeHttpUrl(pa.source_url);
    html +=
      '<div class="publisher-badge"><span class="attribution"><span class="who">' +
      '<span class="attribution-name">' + esc(pa.source_name || "") + "</span></span></span>" +
      '<span class="publisher-kind verified">' + checkIcon() + "Verified</span></div>";
    if (src) {
      html += '<a class="site" href="' + esc(src) + '" target="_blank" rel="noopener">' + esc(src) + "</a>";
    }
    if (pa.retrieved_at) {
      html += '<p class="since">Last refreshed ' + esc(fmtDate(pa.retrieved_at)) + ".</p>";
    }
    box.innerHTML = html;
    return;
  }
  if (pa) {
    // ORGANIZATION publishes require a verified domain, so the kind decides the tier.
    const verified = pa.kind === "ORGANIZATION";
    html +=
      '<div class="publisher-badge">' + attributionMarkup(pa) +
      '<span class="publisher-kind' + (verified ? " verified" : "") + '">' +
      (verified ? checkIcon() + "Verified" : "Unverified") + "</span></div>";
  }
  if (publisher) {
    const p = publisher.attributes;
    const since = p.created_at
      ? new Date(p.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long" })
      : null;
    const link = safeHttpUrl(p.url);
    html +=
      (since ? `<p class="since">Publishing on smplmark since ${esc(since)}</p>` : "") +
      (p.description ? `<p>${esc(p.description)}</p>` : "") +
      (link ? `<a class="site" href="${esc(link)}" target="_blank" rel="noopener">${esc(link)}</a>` : "");
  }
  if (!html) {
    box.innerHTML = '<p class="muted">Publisher information is unavailable.</p>';
    return;
  }
  box.innerHTML = html;
  wireBadgeImages(box);
  wirePublisherFavicons(box);
}

// ── Stats tab — the benchmark's shape and provenance dates at a glance. Counts come from cheap
// one-row `meta[total]` probes (cheap regardless of benchmark size), fetched lazily
// the first time the tab is opened. ──
let statsLoaded = false;

async function fetchTotal(scope) {
  try {
    const doc = await fetchJson(
      API + "/api/v1/" + scope + "?filter[benchmark]=" + encodeURIComponent(benchmark.id) +
        "&page[size]=1&meta[total]=true",
    );
    const t = doc && doc.meta && doc.meta.pagination && doc.meta.pagination.total;
    return typeof t === "number" ? t : null;
  } catch (_) {
    return null;
  }
}

function statsRow(label, valueHtml) {
  return '<tr><td class="stat-label">' + esc(label) + '</td><td class="stat-value">' + valueHtml + "</td></tr>";
}

// A per-parent average, rendered as a whole number when it divides evenly (the common "exactly one
// run per subject" case) and one decimal otherwise — a quick read on uniformity.
function perParent(total, parents) {
  if (typeof total !== "number" || typeof parents !== "number" || parents <= 0) return "—";
  const avg = total / parents;
  return Number.isInteger(avg) ? String(avg) : avg.toFixed(1);
}

async function renderStats() {
  const box = el("stats-body");
  if (!box) return;
  const a = benchmark.attributes;
  box.innerHTML = '<p class="muted">Loading…</p>';

  const [nSubjects, nRuns, nMeas] = await Promise.all([
    fetchTotal("subjects"),
    fetchTotal("runs"),
    fetchTotal("measurements"),
  ]);

  const dateOrDash = (iso) => (iso ? esc(fmtDate(iso)) : "—");
  const num = (n) => (typeof n === "number" ? esc(n.toLocaleString()) : "—");
  const status = a.closed
    ? "Closed" + (a.closed_at ? " · " + esc(fmtDate(a.closed_at)) : "")
    : '<span class="pill live" title="This benchmark is live — the publisher is still adding data.">live</span>';

  box.innerHTML =
    '<table class="stats-table"><tbody>' +
    statsRow("Published", dateOrDash(a.published_at)) +
    statsRow("Created", dateOrDash(a.created_at)) +
    statsRow("Last updated", dateOrDash(a.updated_at)) +
    statsRow("Status", status) +
    statsRow("Subjects", num(nSubjects)) +
    statsRow("Runs", num(nRuns)) +
    statsRow("Measurements", num(nMeas)) +
    statsRow("Measurements per subject", perParent(nMeas, nSubjects)) +
    statsRow("Measurements per run", perParent(nMeas, nRuns)) +
    "</tbody></table>";
}

// ── History tab — the benchmark's public change record (§8 credibility: every post-publish edit,
// correction, withdrawal, or removal is on the record). Fetched lazily on first open, like Stats. ──
let historyLoaded = false;

// Short human labels for the audit event types; an unknown type falls back to the raw string.
const HISTORY_EVENT_LABELS = {
  "benchmark.published": "Published",
  "benchmark.edited": "Edited",
  "benchmark.closed": "Closed to new data",
  "benchmark.reopened": "Reopened to new data",
  "benchmark.withdrawn": "Withdrawn",
  "benchmark.taken_down": "Removed by operators",
  "run.created": "Run created",
  "run.ended": "Run ended",
  "run.reopened": "Run reopened",
  "run.appended": "Run appended",
  "run.invalidated": "Run invalidated",
  "run.edited": "Run edited",
  "measurement.created": "Measurement created",
  "measurement.corrected": "Measurement corrected",
};

function historyRow(e) {
  const at = e.attributes || {};
  const label = HISTORY_EVENT_LABELS[at.event_type] || at.event_type || "";
  const semantic = at.semantic_core
    ? ' <span class="pill semantic" title="This change affects the meaning of the published results.">semantic change</span>'
    : "";
  const actor = at.actor && at.actor.label ? at.actor.label : "";
  return (
    '<tr><td class="history-date" title="' + esc(at.occurred_at || "") + '">' + esc(fmtDate(at.occurred_at)) + "</td>" +
    '<td class="history-event">' + esc(label) + semantic + "</td>" +
    '<td class="history-desc">' + esc(at.description || "") + "</td>" +
    '<td class="history-actor">' + esc(actor) + "</td></tr>"
  );
}

async function renderHistory() {
  const box = el("history-body");
  if (!box) return;
  box.innerHTML = '<p class="history-note">Loading…</p>';
  let events;
  try {
    const doc = await fetchJson(API + "/api/v1/benchmarks/" + encodeURIComponent(benchmark.id) + "/history");
    events = Array.isArray(doc.data) ? doc.data : [];
  } catch (_) {
    // Covers 503 (audit store temporarily unavailable) and any fetch failure — a muted line, never
    // a broken page.
    box.innerHTML = '<p class="history-note">History is temporarily unavailable.</p>';
    return;
  }
  if (!events.length) {
    box.innerHTML = '<p class="history-note">No public history recorded for this benchmark.</p>';
    return;
  }
  // Events arrive newest first — render them in that order.
  box.innerHTML =
    '<table class="history-table"><thead><tr>' +
    "<th>Date</th><th>Event</th><th>Description</th><th>By</th></tr></thead><tbody>" +
    events.map(historyRow).join("") +
    "</tbody></table>";
}

// ── Tabs — hash-routed (#overview/#data/#metrics/#methodology/#publisher/#stats/#history) so
// refresh restores the tab and the back button walks tab history. ──
const TAB_NAMES = ["overview", "data", "metrics", "methodology", "stats", "history", "publisher"];
function activateTab(name, updateHash = true) {
  for (const t of document.querySelectorAll(".tab")) t.classList.toggle("active", t.dataset.tab === name);
  for (const p of document.querySelectorAll(".tab-panel")) p.classList.toggle("active", p.dataset.panel === name);
  if (name === "data") {
    if (!chartDrawn) drawChart();
  } else if (name === "stats" && !statsLoaded) {
    statsLoaded = true;
    renderStats();
  } else if (name === "history" && !historyLoaded) {
    historyLoaded = true;
    renderHistory();
  }
  if (updateHash && location.hash !== "#" + name) location.hash = name;
}
function setupTabs() {
  for (const t of document.querySelectorAll(".tab")) t.addEventListener("click", () => activateTab(t.dataset.tab));
  window.addEventListener("hashchange", () => {
    const name = location.hash.slice(1);
    if (TAB_NAMES.includes(name)) activateTab(name, false);
  });
  const initial = location.hash.slice(1);
  // Data is what visitors come to a benchmark to see, so it's the default landing tab; an explicit
  // hash (#overview/#metrics/…) still overrides it.
  if (TAB_NAMES.includes(initial)) activateTab(initial, false);
  else activateTab("data", false);
  window.addEventListener("resize", () => {
    if (chart) chart.setSize({ width: el("chart").clientWidth || 900, height: 420 });
  });
}

// ── Deep links — the query string carries the data view (from/to/range/subjects/metrics/view/
// sort); the hash keeps sole ownership of the tab. Every param is optional and validated
// against loaded data: a bad value is dropped, never allowed to break rendering. ?api= and any
// unrecognized params pass through every rewrite untouched. ──
const VIEW_PARAM_KEYS = ["from", "to", "range", "subjects", "metrics", "view", "sort"];
const DAY_MS = 86400000;

function searchParams() {
  try {
    return new URLSearchParams(location.search);
  } catch (_) {
    return new URLSearchParams();
  }
}

function hasViewParams() {
  const params = searchParams();
  if (VIEW_PARAM_KEYS.some((k) => params.has(k))) return true;
  // Faceted-browse params (large CATEGORY benchmarks) also mean "land on the Data tab".
  if (params.has("q") || params.has("page")) return true;
  for (const k of params.keys()) if (k.startsWith("facet.")) return true;
  return false;
}

// Accept full ISO-8601 or bare YYYY-MM-DD — from ⇒ midnight UTC, to ⇒ EXCLUSIVE next midnight,
// so ?from=2026-06-01&to=2026-06-15 covers the 15th. Invalid ⇒ null (dropped).
function parseDateParam(v, endExclusive) {
  if (!v) return null;
  const s = String(v).trim();
  let ms;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    ms = Date.parse(s + "T00:00:00Z");
    if (!isNaN(ms) && endExclusive) ms += DAY_MS;
  } else {
    ms = Date.parse(s);
  }
  return isNaN(ms) ? null : ms;
}

function isoDay(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate());
}

// Serialize a bound: exact-midnight values write back as bare dates (`to` shown inclusive, its
// stored value stays the exclusive next midnight); drag-zoom windows get the full ISO instant.
function dateParamValue(ms, endExclusive) {
  if (ms % DAY_MS === 0) return isoDay(endExclusive ? ms - DAY_MS : ms);
  return new Date(ms).toISOString();
}

// Keep the #range select honest: an active from/to window gets a dynamically-added "Custom"
// option; picking any preset removes it again (via the change listener → syncRangeSelect).
function syncRangeSelect() {
  const select = el("range");
  if (!select) return;
  const existing = select.querySelector('option[value="custom"]');
  if (rangeState.preset !== undefined) {
    if (existing) existing.remove();
    select.value = rangeState.preset;
    return;
  }
  const fromLabel = rangeState.from == null ? "…" : isoDay(rangeState.from);
  const toLabel =
    rangeState.to == null
      ? "…"
      : isoDay(rangeState.to % DAY_MS === 0 ? rangeState.to - DAY_MS : rangeState.to);
  const opt = existing || document.createElement("option");
  opt.value = "custom";
  opt.textContent = "Custom (" + fromLabel + " – " + toLabel + ")";
  if (!existing) select.appendChild(opt);
  select.value = "custom";
}

// Seed the view state from the URL. Runs once, after subjects/metricList load (keys and names
// validate against real data) and before anything can draw.
function readViewParams() {
  const params = searchParams();

  // from/to (absolute) beat range (preset mirror). Time bounds only mean anything in TIME mode.
  if (chartMode === "TIME") {
    const from = parseDateParam(params.get("from"), false);
    const to = parseDateParam(params.get("to"), true);
    if (from !== null || to !== null) {
      rangeState = { from: from, to: to };
    } else {
      const preset = params.get("range");
      if (preset && Object.prototype.hasOwnProperty.call(RANGE_SECONDS, preset)) {
        rangeState = { preset: preset };
      }
    }
    syncRangeSelect();
  }

  // subjects: comma-separated subject KEYS → ids. Unknown keys drop silently; all dropped (or the
  // list naming every subject) means the same as omitted — all subjects. A present-but-empty
  // "subjects=" round-trips a none-selected view. (Comma is the delimiter, so a key that itself
  // contains a comma can't round-trip — keys are meant to be URL-safe identifiers.)
  const subjectsParam = params.get("subjects");
  if (subjectsParam !== null) {
    const idByKey = new Map(subjects.map((t) => [t.attributes.key, t.id]));
    let raw = subjectsParam, mode = "IN";
    if (raw.charAt(0) === "~") { mode = "EX"; raw = raw.slice(1); } // "~keys" ⇒ hide these, show the rest
    const fragments = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const set = new Set();
    for (const k of fragments) { const id = idByKey.get(k); if (id) set.add(id); }
    if (mode === "EX") {
      if (set.size) filters[SUBJECT_FIELD] = { mode: "EX", set };
    } else if (fragments.length === 0) {
      filters[SUBJECT_FIELD] = { mode: "IN", set: new Set() }; // explicit none-shown
    } else if (set.size && set.size < subjects.length) {
      filters[SUBJECT_FIELD] = { mode: "IN", set };
    }
  }

  // metrics: validated against the schema, normalized to schema order (the picker's rule).
  const metricsParam = params.get("metrics");
  if (metricsParam) {
    const wanted = new Set(metricsParam.split(",").map((s) => s.trim()));
    const picked = metricList.map((m) => m.name).filter((n) => wanted.has(n));
    if (picked.length) metricSelection = picked;
  }

  const view = params.get("view");
  if (view === "bars" || view === "table") chartView = view;

  // sort: JSON:API style — "-metric" desc, "metric" asc; must name a declared metric.
  const sort = params.get("sort");
  if (sort) {
    const desc = sort.charAt(0) === "-";
    const name = desc ? sort.slice(1) : sort;
    if (metricList.some((m) => m.name === name)) tableSort = { key: name, desc: desc };
  }

  // Drawer filters: facet.<field>=v1,v2 (values aren't validated against the derived facets — a
  // facet the data doesn't have simply matches nothing) and the name search q. This makes a shared
  // or embedded filtered view reproduce exactly.
  for (const [k, v] of params) {
    if (k.startsWith("facet.") && v) {
      let raw = v, mode = "IN";
      if (raw.charAt(0) === "~") { mode = "EX"; raw = raw.slice(1); }
      const set = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
      if (set.size) filters[k.slice(6)] = { mode, set }; // "facet.".length === 6
    }
  }
}

// Single writer for the deep-link params: rewrite only our own keys, keep everything else
// (notably ?api=), re-append the tab hash. Defaults serialize as absence.
let syncViewTimer = null;
function syncViewParams() {
  clearTimeout(syncViewTimer);
  const params = searchParams();
  for (const k of VIEW_PARAM_KEYS) params.delete(k);
  // The facet.<field> filters live outside VIEW_PARAM_KEYS — clear them too before rewriting.
  for (const k of [...params.keys()]) if (k.startsWith("facet.")) params.delete(k);

  if (chartMode === "TIME") {
    if (rangeState.preset !== undefined) {
      if (rangeState.preset !== "all") params.set("range", rangeState.preset);
    } else {
      if (rangeState.from != null) params.set("from", dateParamValue(rangeState.from, false));
      if (rangeState.to != null) params.set("to", dateParamValue(rangeState.to, true));
    }
  }

  const tf = filters[SUBJECT_FIELD];
  if (tf) {
    // IN → the shown keys; EX → "~" + the hidden keys. Absence means all subjects (ALL, all checked).
    const keys = subjects.filter((t) => tf.set.has(t.id)).map((t) => t.attributes.key);
    params.set("subjects", (tf.mode === "EX" ? "~" : "") + keys.join(","));
  }

  if (barsSingle()) {
    // Bars carry a single metric; keep the URL clean when it's the default headline metric.
    if (metricSelection.length === 1 && metricSelection[0] !== defaultBarsMetric()) {
      params.set("metrics", metricSelection[0]);
    }
  } else if (metricSelection.length && metricSelection.join(",") !== defaultMetricSelection().join(",")) {
    params.set("metrics", metricSelection.join(","));
  }

  if (chartMode === "CATEGORY" && chartView === "table") {
    params.set("view", "table");
    if (tableSort.key) params.set("sort", (tableSort.desc ? "-" : "") + tableSort.key);
  }

  // Drawer filters → URL (so "Copy link"/"Copy image link" reproduce the filtered view; the embed
  // image cache already keys on facet.*/q, so each distinct filter yields its own cached image).
  for (const field of Object.keys(filters)) {
    if (field === SUBJECT_FIELD) continue;
    const f = filters[field];
    const vals = [...f.set];
    if (vals.length) params.set("facet." + field, (f.mode === "EX" ? "~" : "") + vals.join(","));
  }

  const qs = params.toString();
  history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
}

// Live drag-zoom fires per gesture; coalesce the URL rewrites.
function scheduleSyncViewParams() {
  clearTimeout(syncViewTimer);
  syncViewTimer = setTimeout(syncViewParams, 250);
}

// ── Chart ──
function currentY() {
  // The primary metric: the chart's declared default when it's checked, else the first checked.
  if (metricSelection.length > 0) {
    if (chartDecl && metricSelection.includes(chartDecl.y)) return chartDecl.y;
    return metricSelection[0];
  }
  return chartDecl ? chartDecl.y : metricList.length ? metricList[0].name : null;
}
function currentRange() {
  // The half-open "[iso,iso)" interval for filter[created_at], derived from rangeState — the
  // observation cache key and the download scope follow along for free.
  if (rangeState.preset !== undefined) {
    const secs = RANGE_SECONDS[rangeState.preset];
    if (!secs) return null; // all time → no filter
    const now = Date.now();
    return "[" + new Date(now - secs * 1000).toISOString() + "," + new Date(now).toISOString() + ")";
  }
  const from = rangeState.from != null ? new Date(rangeState.from).toISOString() : "";
  const to = rangeState.to != null ? new Date(rangeState.to).toISOString() : "";
  if (!from && !to) return null;
  // The API's range grammar spells an open bound "*" — an empty token is a 400.
  return "[" + (from || "*") + "," + (to || "*") + ")";
}

function measurementsUrl(scopeParam, scopeId, range) {
  let url = API + "/api/v1/measurements?filter[" + scopeParam + "]=" + encodeURIComponent(scopeId);
  if (range) url += "&filter[created_at]=" + encodeURIComponent(range);
  return url;
}

// One benchmark-wide measurements fetch per range (cached), grouped by each measurement's own subject
// (a measurement names its subject directly) — instead of one request per subject.
const observationCache = new Map(); // range key → { bySubject: Map<subjectId, measurement[]>, truncated }
async function observationsBySubject(range) {
  const cacheKey = range || "all";
  if (observationCache.has(cacheKey)) return observationCache.get(cacheKey);
  const res = await fetchAllPages(measurementsUrl("benchmark", benchmark.id, range));
  const bySubject = new Map();
  for (const s of res.data) {
    const subjectId = s.attributes.subject;
    if (subjectId === undefined) continue;
    let list = bySubject.get(subjectId);
    if (!list) { list = []; bySubject.set(subjectId, list); }
    list.push(s);
  }
  const entry = { bySubject: bySubject, truncated: res.truncated };
  observationCache.set(cacheKey, entry);
  return entry;
}

const AXIS = { stroke: "#9aa7b4", grid: { stroke: "#2a3140", width: 1 }, ticks: { stroke: "#2a3140", width: 1 } };
function utcTicks(u, splits) {
  return splits.map((s) => {
    const d = new Date(s * 1000);
    const p = (n) => String(n).padStart(2, "0");
    return p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes());
  });
}
function destroyChart() {
  if (chart) { chart.destroy(); chart = null; }
  // Every render path calls destroyChart first, so this is where the bars' scroll/resize windowing
  // listener gets torn down — including paths that never re-arm it (empty bars, line charts).
  teardownIncremental();
}

function metricUnit(name) {
  const m = metricList.find((x) => x.name === name);
  return m && m.unit ? m.unit : "";
}

// Build [{x,y}] points for a subject's observations for the active mode.
function pointsFor(list, yKey, xKey) {
  const pts = [];
  for (const s of list) {
    const m = s.attributes.metrics || {};
    const y = typeof m[yKey] === "number" ? m[yKey] : null;
    if (y === null) continue;
    let x;
    if (xKey === "created_at") x = Math.round(Date.parse(s.attributes.created_at) / 1000);
    else x = typeof m[xKey] === "number" ? m[xKey] : null;
    if (x === null || x === undefined) continue;
    pts.push({ x: x, y: y });
  }
  pts.sort((a, b) => a.x - b.x);
  return pts;
}

function renderXY(seriesSubjects, perSubjectPoints, yKey, timeX) {
  const xset = new Set();
  perSubjectPoints.forEach((pts) => pts.forEach((p) => xset.add(p.x)));
  const xs = [...xset].sort((a, b) => a - b);
  if (!xs.length) { destroyChart(); el("empty").hidden = false; return; }
  el("empty").hidden = true;
  const idx = new Map(xs.map((x, i) => [x, i]));
  const data = [xs];
  perSubjectPoints.forEach((pts) => {
    const y = new Array(xs.length).fill(null);
    pts.forEach((p) => { y[idx.get(p.x)] = p.y; });
    data.push(y);
  });
  const unit = metricUnit(yKey);
  const xLabel = timeX ? null : (chartDecl.x + (metricUnit(chartDecl.x) ? " (" + metricUnit(chartDecl.x) + ")" : ""));
  const opts = {
    width: el("chart").clientWidth || 900,
    height: 420,
    scales: { x: { time: !!timeX } },
    series: [
      timeX ? {} : { label: xLabel || "x" },
      ...seriesSubjects.map((t, i) => ({
        label: t.attributes.name,
        stroke: COLORS[i % COLORS.length],
        width: 1.5,
        spanGaps: true,
        points: { show: xs.length < 200 },
      })),
    ],
    axes: [
      timeX ? Object.assign({ values: utcTicks }, AXIS) : Object.assign({ label: xLabel, labelSize: 30 }, AXIS),
      // Size the value gutter to the widest tick label so large (6–7 digit) values don't overrun
      // the rotated axis label. uPlot's default measure sticks to the first draw's magnitudes; this
      // re-derives it from the current ticks (~7px/char + gap/tick padding).
      Object.assign(
        {
          label: yKey + (unit ? " (" + unit + ")" : ""),
          labelSize: 34,
          size: (_u, vals) =>
            (vals || []).reduce((m, v) => Math.max(m, String(v == null ? "" : v).length), 3) * 7 + 18,
        },
        AXIS,
      ),
    ],
  };
  if (timeX) {
    // Drag-zoom → URL: setSelect fires on user drag only (uPlot's internal hide passes
    // fireHooks=false), so mirroring the window here can't feed back into a redraw. uPlot's
    // default zoom still applies — no refetch while zooming live.
    opts.hooks = {
      setSelect: [
        (u) => {
          if (!u.select || u.select.width <= 0) return;
          if (preZoomRange === null) preZoomRange = rangeState;
          rangeState = {
            from: Math.round(u.posToVal(u.select.left, "x") * 1000),
            to: Math.round(u.posToVal(u.select.left + u.select.width, "x") * 1000),
          };
          syncRangeSelect();
          scheduleSyncViewParams();
        },
      ],
    };
  }
  destroyChart();
  chart = new uPlot(opts, data, el("chart"));
  if (timeX) {
    // uPlot's own dblclick listener (bound first) resets the zoom; ours restores the URL state.
    chart.over.addEventListener("dblclick", () => {
      if (preZoomRange === null) return;
      rangeState = preZoomRange;
      preZoomRange = null;
      syncRangeSelect();
      // If anything redrew while zoomed, the chart holds only the zoom window's data — refetch.
      if (currentRange() !== lastDrawnRange) drawChart();
      else scheduleSyncViewParams();
    });
  }
}

// ── Incremental rendering: build the first RENDER_CHUNK rows, then append the next chunk whenever
// the user scrolls near the end (IntersectionObserver on a sentinel). Keeps an 11k-row benchmark
// from materializing 11k DOM nodes up front — we build ~60 and grow on demand, no library. ──
const RENDER_CHUNK = 60;
let incScrollHandler = null;

function teardownIncremental() {
  if (incScrollHandler) {
    window.removeEventListener("scroll", incScrollHandler);
    window.removeEventListener("resize", incScrollHandler);
    incScrollHandler = null;
  }
}

function renderIncremental(listEl, items, renderRow) {
  teardownIncremental(); // drop the previous view's listener before wiring this one
  let n = 0;
  const isRow = listEl.tagName === "TBODY"; // a table body needs a <tr> sentinel, not a <div>
  const sentinel = document.createElement(isRow ? "tr" : "div");
  sentinel.className = "scroll-sentinel";
  if (isRow) sentinel.innerHTML = "<td></td>";
  listEl.appendChild(sentinel);
  function appendChunk() {
    const end = Math.min(n + RENDER_CHUNK, items.length);
    let html = "";
    for (let i = n; i < end; i++) html += renderRow(items[i], i);
    sentinel.insertAdjacentHTML("beforebegin", html);
    n = end;
  }
  function fill() {
    // Append while the sentinel sits within ~a screen of the viewport, so the visible area is always
    // full; stop once it's parked below the fold and wait for the next scroll.
    while (n < items.length && sentinel.getBoundingClientRect().top <= window.innerHeight + 600) {
      appendChunk();
    }
    if (n >= items.length) teardownIncremental();
  }
  // Call fill() directly on scroll — it's a single getBoundingClientRect read unless we're near the
  // end, so it's cheap, and unlike requestAnimationFrame it still runs when the tab is backgrounded.
  incScrollHandler = fill;
  window.addEventListener("scroll", incScrollHandler, { passive: true });
  window.addEventListener("resize", incScrollHandler);
  fill(); // first chunks to fill the initial screen
}

// ── Category bars: one ranked bar per subject for the chosen metric. A header over the value column
// names the plotted metric (a picker when there's more than one) and toggles the sort direction, so
// it's always clear WHAT the bars show. ──
let barsDesc = true;

// base_score → "Base Score", mmlu_pro → "Mmlu Pro". Used for the big metric title over the bars.
function titleCase(s) {
  return String(s == null ? "" : s).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderBars(seriesSubjects, perSubjectPoints, yKey) {
  destroyChart();
  const rows = seriesSubjects.map((t, i) => {
    const pts = perSubjectPoints[i];
    const mean = pts.length ? pts.reduce((s, p) => s + p.y, 0) / pts.length : null;
    return { name: t.attributes.name, value: mean };
  });
  // Rank by value in the chosen direction, but keep null-valued subjects last either way (a missing
  // measurement shouldn't jump to the top of an ascending sort).
  rows.sort((a, z) => {
    if (a.value == null && z.value == null) return 0;
    if (a.value == null) return 1;
    if (z.value == null) return -1;
    return barsDesc ? z.value - a.value : a.value - z.value;
  });
  const max = Math.max(1, ...rows.map((r) => (r.value == null ? 0 : Math.abs(r.value))));
  const hasData = rows.some((r) => r.value != null);
  // Above the bars: the plotted metric, title-cased in a large font (chosen in the filter bar), plus
  // how many bars match the current filter out of the benchmark's total.
  const unitSuffix = metricUnit(yKey) ? ' <span class="bars-metric-unit">(' + esc(metricUnit(yKey)) + ")</span>" : "";
  const count = seriesSubjects.length, total = subjects.length;
  const countText = count === total
    ? count.toLocaleString() + (count === 1 ? " subject" : " subjects")
    : count.toLocaleString() + " of " + total.toLocaleString() + " subjects";
  const title =
    '<div class="bars-title">' +
    '<h3 class="bars-metric-title">' + esc(titleCase(yKey)) + unitSuffix + "</h3>" +
    '<span class="bars-match-count">' + countText + "</span></div>";
  el("chart").innerHTML = title + '<div class="bars" id="bars-list"></div>';
  el("empty").hidden = hasData;
  if (!hasData) { el("bars-list").remove(); return; }
  const unit = metricUnit(yKey);
  const renderRow = (r, i) => {
    const w = r.value == null ? 0 : Math.round((Math.abs(r.value) / max) * 100);
    const val = r.value == null ? "—" : fmtCell(r.value) + (unit ? " " + unit : "");
    return (
      '<div class="bar-row"><div class="bar-label" title="' + esc(r.name) + '">' + esc(r.name) + "</div>" +
      '<div class="bar-track"><div class="bar-fill" style="width:' + w + "%;background:" + COLORS[i % COLORS.length] + '"></div></div>' +
      '<div class="bar-value">' + esc(val) + "</div></div>"
    );
  };
  if (embedMode) el("bars-list").innerHTML = rows.slice(0, EMBED_ROWS).map(renderRow).join("");
  else renderIncremental(el("bars-list"), rows, renderRow);
}

// ── Table view (CATEGORY benchmarks): a column per selected metric, sortable by header click; rows
// are windowed (first N, more on scroll) so a huge benchmark's table stays cheap. ──
let tableSort = { key: null, desc: true };

function fmtCell(v) {
  if (v == null) return "—";
  if (typeof v !== "number" || !isFinite(v)) return String(v);
  if (v === 0) return "0";
  if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString();
  // ~4 significant figures, trailing zeros trimmed — preserves the source precision the old
  // one-decimal rounding threw away (0.8234 vs 0.8251, not both "0.8").
  return parseFloat(v.toPrecision(4)).toString();
}

function renderTable(seriesSubjects, bySubject) {
  destroyChart();
  const metricNames = metricSelection.length ? metricSelection : metricList.map((m) => m.name);
  const rows = seriesSubjects.map((t) => {
    const obs = bySubject.get(t.id) || [];
    const cells = {};
    for (const name of metricNames) {
      let sum = 0, n = 0;
      for (const s of obs) {
        const v = (s.attributes.metrics || {})[name];
        if (typeof v === "number") { sum += v; n++; }
      }
      cells[name] = n ? sum / n : null;
    }
    return { name: t.attributes.name, cells };
  });
  const key = tableSort.key && metricNames.includes(tableSort.key) ? tableSort.key : currentY();
  rows.sort((a, z) => {
    const av = a.cells[key], zv = z.cells[key];
    const d = (zv == null ? -Infinity : zv) - (av == null ? -Infinity : av);
    return tableSort.desc ? d : -d;
  });
  el("empty").hidden = true;
  el("chart").innerHTML =
    '<div class="table-wrap"><table class="data-table"><thead><tr><th>Subject</th>' +
    metricNames
      .map(
        (name) =>
          '<th class="sortable" data-metric="' + esc(name) + '">' + esc(name) +
          (name === key ? (tableSort.desc ? " ↓" : " ↑") : "") + "</th>",
      )
      .join("") +
    '</tr></thead><tbody id="table-body"></tbody></table></div>';
  const renderRow = (r) =>
    '<tr><td title="' + esc(r.name) + '">' + esc(r.name) + "</td>" +
    metricNames.map((name) => "<td>" + esc(fmtCell(r.cells[name])) + "</td>").join("") + "</tr>";
  const body = el("table-body");
  if (embedMode) body.innerHTML = rows.slice(0, EMBED_ROWS).map(renderRow).join("");
  else renderIncremental(body, rows, renderRow);
  el("chart").querySelectorAll("th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const metric = th.dataset.metric;
      tableSort = { key: metric, desc: tableSort.key === metric ? !tableSort.desc : true };
      syncViewParams(); // re-render below skips drawChart, so the URL syncs here
      renderTable(seriesSubjects, bySubject);
    });
  });
}

// Line charts cap the series count — hundreds of overlaid lines are unreadable and slow.
const MAX_SERIES = 12;

async function drawChart() {
  chartDrawn = true;
  syncViewParams(); // every control change funnels through here — keep the URL shareable
  const yKey = currentY();
  const range = chartMode === "TIME" ? currentRange() : null;
  lastDrawnRange = range;
  if (!yKey) {
    el("chart-status").textContent = "This benchmark has no numeric metric to plot.";
    return;
  }
  let seriesSubjects = activeSubjects();
  if (!seriesSubjects.length) {
    destroyChart();
    el("chart").innerHTML = "";
    el("chart-status").textContent = "No subjects selected.";
    return;
  }
  el("chart-status").className = "status";
  el("chart-status").textContent = "Loading…";
  try {
    const { bySubject, truncated } = await observationsBySubject(range);
    let seriesNote = "";
    if (chartMode !== "CATEGORY" && seriesSubjects.length > MAX_SERIES) {
      seriesSubjects = seriesSubjects.slice(0, MAX_SERIES);
      seriesNote = " · first " + MAX_SERIES + " selected subjects plotted — narrow the subject list to focus";
    }
    const xKey = chartMode === "NUMBER" ? chartDecl.x : "created_at";
    const perSubjectPoints = seriesSubjects.map((t) => pointsFor(bySubject.get(t.id) || [], yKey, xKey));
    if (chartMode === "CATEGORY" && chartView === "table") renderTable(seriesSubjects, bySubject);
    else if (chartMode === "CATEGORY") renderBars(seriesSubjects, perSubjectPoints, yKey);
    else renderXY(seriesSubjects, perSubjectPoints, yKey, chartMode === "TIME");
    const total = perSubjectPoints.reduce((n, pts) => n + pts.length, 0);
    el("chart-status").textContent =
      total + " measurements · " + seriesSubjects.length + " subject(s) · metric “" + yKey + "” · " +
      chartMode.toLowerCase() + " chart" +
      (truncated ? " · large dataset — first " + MAX_PAGES * PAGE_SIZE + " measurements loaded" : "") +
      seriesNote + ".";
  } catch (err) {
    destroyChart();
    el("chart-status").className = "status error";
    el("chart-status").textContent = "Failed to load measurements: " + err.message;
  }
}

function currentScopeUrl(range) {
  const active = activeSubjects();
  return active.length === 1
    ? measurementsUrl("subject", active[0].id, range)
    : measurementsUrl("benchmark", benchmark.id, range);
}

// CSV and JSON behave identically: fetch the current scope, download as a file.
async function downloadObservations(accept, extension) {
  const range = chartMode === "TIME" ? currentRange() : null;
  try {
    const res = await fetch(currentScopeUrl(range), { headers: { Accept: accept } });
    if (!res.ok) throw new Error(await errorDetail(res));
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = benchmark.attributes.key + "." + extension;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    el("chart-status").className = "status error";
    el("chart-status").textContent = extension.toUpperCase() + " download failed: " + err.message;
  }
}

// ── Share + download ──
// Two sibling controls in the action bar. Share answers "spread this view": copy the shareable link
// or its image, or post to a social network (plain intent URLs — no SDKs, no tracking, matching our
// privacy stance). Download is its own button (data isn't sharing): the current scope as CSV/JSON.
// Both links always reflect the on-screen view because the deep-link params keep the URL in sync.
// Rendered into the Data tab's control bar.

// Inline glyphs (no external assets): brand marks for the social targets, plus action icons.
const ICONS = {
  link: '<svg class="share-ico" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M6.6 9.4l2.8-2.8M6.9 4.6l.9-.9a2.3 2.3 0 013.3 3.3l-.9.9M9.1 11.4l-.9.9a2.3 2.3 0 01-3.3-3.3l.9-.9" stroke-linecap="round"/></svg>',
  image: '<svg class="share-ico" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.5"/><circle cx="5.8" cy="6.4" r="1" fill="currentColor" stroke="none"/><path d="M2.6 11.6l3.3-3.2 2.4 2.3 2-1.9 3.1 2.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  x: '<svg class="share-ico" viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M9.4 6.9L14.2 1.4h-1.5L8.7 5.9 5.5 1.4H1.4l5 7-5 5.8h1.5l4.4-5.1 3.4 5.1h4.1l-5.2-7.3zm-1.6 1.8l-.5-.7L3.4 2.5h1.6l3.3 4.7.5.7 4.3 6h-1.6L7.8 8.7z"/></svg>',
  linkedin: '<svg class="share-ico" viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M3.4 4.5a1.15 1.15 0 100-2.3 1.15 1.15 0 000 2.3zM2.45 5.5h1.9v8.1h-1.9V5.5zm3.35 0h1.82v1.1h.03c.26-.48.9-1 1.85-1 1.98 0 2.35 1.28 2.35 2.96v5.05h-1.9V9.0c0-.98-.02-2.24-1.38-2.24-1.38 0-1.6 1.06-1.6 2.17v4.67H5.8V5.5z"/></svg>',
  facebook: '<svg class="share-ico" viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M15 8a7 7 0 10-8.1 6.9V10H5.1V8h1.8V6.5c0-1.77 1.05-2.75 2.67-2.75.77 0 1.58.14 1.58.14v1.74h-.89c-.88 0-1.15.54-1.15 1.1V8h1.96l-.31 2H9.08v4.9A7 7 0 0015 8z"/></svg>',
  email: '<svg class="share-ico" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="M2.6 4.6L8 8.8l5.4-4.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  file: '<svg class="share-ico" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M4 2h5l3 3v9H4V2z" stroke-linejoin="round"/><path d="M9 2v3h3M6 8.5h4M6 11h4" stroke-linecap="round"/></svg>',
  download: '<svg class="dl-ico" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 2.5v7m0 0L5.2 6.7M8 9.5l2.8-2.8M3 13h10" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  caret: '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  filter: '<svg class="share-ico" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M2 3.5h12L9.4 8.6v4L6.6 14V8.6L2 3.5z" stroke-linejoin="round"/></svg>',
  arrowDown: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 3v10M4.5 9.5 8 13l3.5-3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  arrowUp: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 13V3M4.5 6.5 8 3l3.5 3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  share: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="12" cy="3.5" r="1.8"/><circle cx="4" cy="8" r="1.8"/><circle cx="12" cy="12.5" r="1.8"/><path d="M5.6 7.1 10.4 4.4M5.6 8.9l4.8 2.7" stroke-linecap="round"/></svg>',
  chevronDown: '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevronRight: '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevronLeft: '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M8 2L4 6l4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function shareItem(tag, act, icon, label, extra) {
  return (
    "<" + tag + ' class="share-item" data-act="' + act + '" role="menuitem"' + (extra || "") + ">" +
    icon + '<span class="share-label">' + label + "</span></" + tag + ">"
  );
}

function shareMenuHtml() {
  return (
    '<div class="share">' +
    '<button type="button" class="btn share-btn" aria-haspopup="true" aria-expanded="false">Share' +
    ICONS.caret +
    "</button>" +
    '<div class="share-menu" hidden role="menu">' +
    shareItem("button", "copy", ICONS.link, "Copy link", ' type="button"') +
    shareItem("button", "copy-image", ICONS.image, "Copy image link", ' type="button"') +
    '<div class="share-sep" role="separator"></div>' +
    shareItem("a", "x", ICONS.x, "Share on X", ' target="_blank" rel="noopener"') +
    shareItem("a", "linkedin", ICONS.linkedin, "Share on LinkedIn", ' target="_blank" rel="noopener"') +
    shareItem("a", "facebook", ICONS.facebook, "Share on Facebook", ' target="_blank" rel="noopener"') +
    shareItem("a", "email", ICONS.email, "Email") +
    "</div></div>"
  );
}

// The download control: its own button, since exporting data isn't the same act as sharing a view.
function downloadMenuHtml() {
  return (
    '<div class="share dl">' +
    '<button type="button" class="btn share-btn dl-btn" aria-haspopup="true" aria-expanded="false" title="Download this view as a file">' +
    ICONS.download + "Download" + ICONS.caret +
    "</button>" +
    '<div class="share-menu" hidden role="menu">' +
    shareItem("button", "csv", ICONS.file, "CSV", ' type="button"') +
    shareItem("button", "json", ICONS.file, "JSON", ' type="button"') +
    "</div></div>"
  );
}

// Shared open/close plumbing for a .share dropdown (Escape + outside-click dismiss). onOpen runs
// just before the menu is shown (the share menu refreshes its live hrefs there).
function attachDropdown(wrap, onOpen) {
  const btn = wrap.querySelector(".share-btn");
  const menu = wrap.querySelector(".share-menu");
  let onDoc = null;
  function onKey(e) { if (e.key === "Escape") { close(); btn.focus(); } }
  function close() {
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    if (onDoc) {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
      onDoc = null;
    }
  }
  function open() {
    if (onOpen) onOpen();
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    onDoc = (e) => { if (!wrap.contains(e.target)) close(); };
    // Defer so the opening click doesn't immediately close it.
    setTimeout(() => {
      if (!menu.hidden) {
        document.addEventListener("click", onDoc);
        document.addEventListener("keydown", onKey);
      }
    }, 0);
  }
  btn.addEventListener("click", () => (menu.hidden ? open() : close()));
  return { close };
}

async function copyToClipboard(text, item) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (_) {}
    document.body.removeChild(ta);
  }
  // Flash "Copied!" in the label span only, so the icon survives the feedback.
  const label = item.querySelector(".share-label") || item;
  const prev = label.textContent;
  label.textContent = "Copied!";
  setTimeout(() => { label.textContent = prev; }, 1200);
}

// Wire a rendered Share control (copy link/image + social intents).
function wireShareMenu(root) {
  const wrap = root.querySelector(".share:not(.dl)");
  const { close } = attachDropdown(wrap, refreshLinks);

  // Social hrefs are refreshed every open, since the shareable URL changes as controls change.
  function refreshLinks() {
    const url = shareUrl();
    const title = (benchmark && benchmark.attributes.name) || "smplmark benchmark";
    const encUrl = encodeURIComponent(url);
    const encTitle = encodeURIComponent(title);
    wrap.querySelector('[data-act="x"]').href =
      "https://twitter.com/intent/tweet?url=" + encUrl + "&text=" + encTitle;
    wrap.querySelector('[data-act="linkedin"]').href =
      "https://www.linkedin.com/sharing/share-offsite/?url=" + encUrl;
    wrap.querySelector('[data-act="facebook"]').href =
      "https://www.facebook.com/sharer/sharer.php?u=" + encUrl;
    wrap.querySelector('[data-act="email"]').href =
      "mailto:?subject=" + encTitle + "&body=" + encodeURIComponent(title + "\n\n" + url);
  }

  wrap.querySelector('[data-act="copy"]').addEventListener("click", (e) =>
    copyToClipboard(shareUrl(), e.currentTarget));
  wrap.querySelector('[data-act="copy-image"]').addEventListener("click", (e) =>
    copyToClipboard(embedImageUrl(), e.currentTarget));

  // Social/email anchors navigate themselves (hrefs set on open); just close the menu after.
  wrap.querySelectorAll("a.share-item").forEach((a) => a.addEventListener("click", close));
}

// Wire a rendered Download control. `downloads` supplies the mode-specific CSV/JSON handlers.
function wireDownloadMenu(root, downloads) {
  const wrap = root.querySelector(".share.dl");
  const { close } = attachDropdown(wrap);
  wrap.querySelector('[data-act="csv"]').addEventListener("click", () => { close(); downloads.csv(); });
  wrap.querySelector('[data-act="json"]').addEventListener("click", () => { close(); downloads.json(); });
}

// ── Modal — a centered dialog for the Share / Download choices (replaces the old dropdown menus;
// the filter-bar buttons are now icon-only and pop this). ──
function closeModal() {
  const m = document.getElementById("app-modal");
  if (!m) return;
  if (m.__onKey) document.removeEventListener("keydown", m.__onKey);
  m.remove();
  document.body.classList.remove("modal-open");
}
function openModal(title, bodyHtml, onWire) {
  closeModal();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "app-modal";
  overlay.innerHTML =
    '<div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
    '<div class="modal-head"><span class="modal-title">' + esc(title) + "</span>" +
    '<button type="button" class="modal-close" aria-label="Close">✕</button></div>' +
    '<div class="modal-body">' + bodyHtml + "</div></div>";
  document.body.appendChild(overlay);
  document.body.classList.add("modal-open");
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
  overlay.querySelector(".modal-close").addEventListener("click", closeModal);
  const onKey = (e) => { if (e.key === "Escape") closeModal(); };
  document.addEventListener("keydown", onKey);
  overlay.__onKey = onKey;
  if (onWire) onWire(overlay.querySelector(".modal-body"));
}
function openShareModal() {
  const body =
    shareItem("button", "copy", ICONS.link, "Copy link", ' type="button"') +
    shareItem("button", "copy-image", ICONS.image, "Copy image link", ' type="button"') +
    '<div class="share-sep" role="separator"></div>' +
    shareItem("a", "x", ICONS.x, "Share on X", ' target="_blank" rel="noopener"') +
    shareItem("a", "linkedin", ICONS.linkedin, "Share on LinkedIn", ' target="_blank" rel="noopener"') +
    shareItem("a", "facebook", ICONS.facebook, "Share on Facebook", ' target="_blank" rel="noopener"') +
    shareItem("a", "email", ICONS.email, "Email");
  openModal("Share this view", body, (root) => {
    const url = shareUrl();
    const title = (benchmark && benchmark.attributes.name) || "smplmark benchmark";
    const encUrl = encodeURIComponent(url), encTitle = encodeURIComponent(title);
    root.querySelector('[data-act="x"]').href = "https://twitter.com/intent/tweet?url=" + encUrl + "&text=" + encTitle;
    root.querySelector('[data-act="linkedin"]').href = "https://www.linkedin.com/sharing/share-offsite/?url=" + encUrl;
    root.querySelector('[data-act="facebook"]').href = "https://www.facebook.com/sharer/sharer.php?u=" + encUrl;
    root.querySelector('[data-act="email"]').href = "mailto:?subject=" + encTitle + "&body=" + encodeURIComponent(title + "\n\n" + url);
    root.querySelector('[data-act="copy"]').addEventListener("click", (e) => copyToClipboard(shareUrl(), e.currentTarget));
    root.querySelector('[data-act="copy-image"]').addEventListener("click", (e) => copyToClipboard(embedImageUrl(), e.currentTarget));
    root.querySelectorAll("a.share-item").forEach((a) => a.addEventListener("click", closeModal));
  });
}
function openDownloadModal(downloads) {
  const body =
    shareItem("button", "csv", ICONS.file, "CSV", ' type="button"') +
    shareItem("button", "json", ICONS.file, "JSON", ' type="button"');
  openModal("Download data", body, (root) => {
    root.querySelector('[data-act="csv"]').addEventListener("click", () => { closeModal(); downloads.csv(); });
    root.querySelector('[data-act="json"]').addEventListener("click", () => { closeModal(); downloads.json(); });
  });
}

// ── Request takedown — files a request for smplmark operators to review; it deletes nothing by
// itself. Anonymous POST (rate-limited server-side), available on every public benchmark page
// (published and withdrawn alike). ──
function openTakedownModal() {
  const body =
    '<div class="takedown-form">' +
    '<p class="takedown-note">This sends a takedown request to smplmark operators for review. ' +
    "Nothing is removed until an operator acts on it.</p>" +
    '<label class="modal-field"><span>Name</span>' +
    '<input type="text" id="td-name" autocomplete="name"></label>' +
    '<label class="modal-field"><span>Email</span>' +
    '<input type="email" id="td-email" autocomplete="email"></label>' +
    '<label class="modal-field"><span>Reason</span>' +
    '<textarea id="td-reason" rows="4" placeholder="Why should this benchmark be taken down?"></textarea></label>' +
    '<p class="modal-error" id="td-error" hidden></p>' +
    '<button type="button" class="btn primary" id="td-submit">Submit request</button>' +
    "</div>";
  openModal("Request takedown", body, (root) => {
    const btn = root.querySelector("#td-submit");
    const errorLine = root.querySelector("#td-error");
    const showError = (msg) => { errorLine.textContent = msg; errorLine.hidden = false; };
    btn.addEventListener("click", async () => {
      const name = root.querySelector("#td-name").value.trim();
      const email = root.querySelector("#td-email").value.trim();
      const reason = root.querySelector("#td-reason").value.trim();
      if (!name || !email || !reason) {
        showError("Name, email, and reason are all required.");
        return;
      }
      errorLine.hidden = true;
      btn.disabled = true;
      btn.textContent = "Submitting…";
      try {
        const res = await fetch(API + "/api/v1/takedown_requests", {
          method: "POST",
          headers: {
            "Content-Type": "application/vnd.api+json",
            Accept: "application/vnd.api+json",
          },
          body: JSON.stringify({
            data: {
              type: "takedown_request",
              attributes: {
                benchmark: benchmark.id,
                requester_name: name,
                requester_email: email,
                reason: reason,
              },
            },
          }),
        });
        if (!res.ok) {
          const detail = await errorDetail(res);
          throw new Error(
            res.status === 429 && detail === "HTTP 429"
              ? "Too many requests — please try again later."
              : detail,
          );
        }
        root.innerHTML =
          '<p class="takedown-confirm">Request received. smplmark operators will review it.</p>';
      } catch (err) {
        showError(err.message);
        btn.disabled = false;
        btn.textContent = "Submit request";
      }
    });
  });
}

// ── Client-derived facets: aggregate every subject's open-ended `details` map. A field with ≥2
// distinct values becomes a facet; values rank by count. No server, no caps — every subject is
// already in memory — facets are derived client-side, not served. ──
let facetList = [];    // [{ field, values: [{value, count}] }]

function deriveFacets() {
  const byField = new Map();
  for (const t of subjects) {
    const d = t.attributes.details;
    if (!d || typeof d !== "object") continue;
    for (const k of Object.keys(d)) {
      const v = d[k];
      if (v == null || typeof v === "object") continue; // scalar detail values only
      const val = String(v);
      let vm = byField.get(k);
      if (!vm) { vm = new Map(); byField.set(k, vm); }
      vm.set(val, (vm.get(val) || 0) + 1);
    }
  }
  const facets = [];
  for (const [field, vm] of byField) {
    if (vm.size < 2) continue; // a single-value field can't filter anything
    const values = [...vm.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, z) => z.count - a.count || (a.value < z.value ? -1 : 1));
    facets.push({ field, values });
  }
  facets.sort((a, z) => z.values.length - a.values.length || (a.field < z.field ? -1 : 1));
  return facets;
}

function facetLabel(field) {
  return field.charAt(0).toUpperCase() + field.slice(1).replace(/_/g, " ");
}

// A subject is plotted when it clears every active facet (OR within a field, AND across fields) AND
// the explicit SUBJECT selection. `subjectsExcept` gives the set passing every filter but one — the
// basis for faceted counts (a facet's own selection is ignored when counting its own values).
// A value is checked (and shown) unless a filter says otherwise. IN → only the set is checked;
// EX → everything but the set is checked; ALL (no entry) → everything is checked.
function valueChecked(field, value) {
  const f = filters[field];
  if (!f) return true;
  return f.mode === "IN" ? f.set.has(value) : !f.set.has(value);
}
function fieldActive(field) { return filters[field] !== undefined; }

// Uncheck/check one value, transitioning ALL ⇄ EX ⇄ IN and collapsing back to ALL when nothing is
// hidden. Unchecking from ALL starts an EXCLUDE; "only" (elsewhere) starts an INCLUDE.
function setValueChecked(field, value, checked) {
  const f = filters[field];
  if (!f) {
    if (checked) return; // already checked (ALL)
    filters[field] = { mode: "EX", set: new Set([value]) };
    return;
  }
  if (f.mode === "EX") {
    if (checked) f.set.delete(value); else f.set.add(value);
    if (f.set.size === 0) delete filters[field]; // nothing hidden ⇒ ALL
    return;
  }
  // IN: checking widens the shown set; unchecking narrows it (an empty IN is a valid "none shown").
  if (checked) f.set.add(value); else f.set.delete(value);
}
function onlyValue(field, value) { filters[field] = { mode: "IN", set: new Set([value]) }; }
function clearField(field) { delete filters[field]; }

function passesFacets(t) {
  const d = t.attributes.details || {};
  for (const field of Object.keys(filters)) {
    if (field === SUBJECT_FIELD) continue;
    if (!valueChecked(field, String(d[field]))) return false;
  }
  return true;
}
function passesSubjectSel(t) { return valueChecked(SUBJECT_FIELD, t.id); }
function activeSubjects() {
  return subjects.filter((t) => passesFacets(t) && passesSubjectSel(t));
}
function subjectsExcept(exceptField) {
  return subjects.filter((t) => {
    const d = t.attributes.details || {};
    for (const field of Object.keys(filters)) {
      if (field === exceptField || field === SUBJECT_FIELD) continue;
      if (!valueChecked(field, String(d[field]))) return false;
    }
    return exceptField === SUBJECT_FIELD || valueChecked(SUBJECT_FIELD, t.id);
  });
}
function totalActiveFilters() { return Object.keys(filters).length; }

// ── Metric selection. Bars plot ONE metric (chosen in the bars header); the table shows a set of
// metric columns (the Columns picker), defaulting to as many as fit without horizontal scroll. ──
function defaultMetricSelection() {
  const names = metricList.map((m) => m.name);
  if (names.length <= 1) return names;
  const primary = chartDecl && names.includes(chartDecl.y) ? chartDecl.y : names[0];
  const ordered = [primary, ...names.filter((n) => n !== primary)];
  const main = document.querySelector(".data-main");
  const width = (main && main.clientWidth) || el("chart").clientWidth || 900;
  const fit = Math.max(1, Math.floor((width - 300) / 140));
  const kept = ordered.slice(0, Math.min(fit, ordered.length));
  return names.filter((n) => kept.includes(n)); // schema order
}
function barsSingle() { return chartMode === "CATEGORY" && chartView === "bars"; }
function defaultBarsMetric() {
  const names = metricList.map((m) => m.name);
  if (chartDecl && names.includes(chartDecl.y)) return chartDecl.y;
  return names.length ? names[0] : null;
}

// ── The collapsible left filter panel. SUBJECT is the first "facet", then every derived facet. Each
// section expands/collapses, lists its first 20 values alphabetically with Select all / only
// quick-picks and a "+N more" reveal, and — only when it has >20 values — a search box. Counts are
// live and faceted (a value's count reflects the other active filters). ──
const SUBJECT_FIELD = "__subject__";
const SECTION_VALUE_LIMIT = 10; // first N values shown per facet (no inner scroll) before "+N more"
const SECTION_SHOWALL_MAX = 400; // cap rows even when "+N more" is expanded (SUBJECT has 11.8k values)
let panelCollapsed = false;
let sectionState = {}; // field → { collapsed, search, showAll }
let subjectsByName = null;

function sectionSt(field) {
  if (!sectionState[field]) sectionState[field] = { collapsed: false, search: "", showAll: false };
  return sectionState[field];
}
function ensureSubjectsByName() {
  if (!subjectsByName) {
    subjectsByName = [...subjects].sort((a, z) =>
      a.attributes.name.localeCompare(z.attributes.name, undefined, { numeric: true, sensitivity: "base" }));
  }
  return subjectsByName;
}
function panelSections() {
  // Subject always first (it isn't really a facet); the real facets follow in alphabetical order.
  const facets = facetList
    .map((f) => ({ field: f.field, label: facetLabel(f.field), isSubject: false }))
    .sort((a, z) => a.label.localeCompare(z.label, undefined, { sensitivity: "base" }));
  return [{ field: SUBJECT_FIELD, label: "Subject", isSubject: true }, ...facets];
}

// A section's ordered candidate POOL. SUBJECT returns raw subject rows (pre-sorted once, then filtered)
// — no per-row object is built until the visible ≤20 slice is rendered, so an 11.8k-subject benchmark
// doesn't churn 11.8k allocations on every panel rebuild. Facets return the small {value,label,count}
// list, counted over the OTHER active filters (so counts stay meaningful).
function sectionPool(section) {
  if (section.isSubject) return ensureSubjectsByName().filter((t) => passesFacets(t));
  const counts = new Map();
  for (const t of subjectsExcept(section.field)) {
    const v = (t.attributes.details || {})[section.field];
    if (v == null) continue;
    const val = String(v);
    counts.set(val, (counts.get(val) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, z) => a.label.localeCompare(z.label, undefined, { numeric: true, sensitivity: "base" }));
}
// Read a pool item uniformly, whether it's a raw subject row (SUBJECT) or a facet-value object.
function itemValue(section, it) { return section.isSubject ? it.id : it.value; }
function itemLabel(section, it) { return section.isSubject ? it.attributes.name : it.label; }
function itemCount(section, it) { return section.isSubject ? null : it.count; }

// Section wrappers key the field-level model by section.field (SUBJECT_FIELD or a detail field).
function toggleSectionValue(section, value, on) { setValueChecked(section.field, value, on); }
function onlySectionValue(section, value) { onlyValue(section.field, value); }
function clearSectionFilter(section) { clearField(section.field); }

function renderFilterPanel() {
  const panel = el("filter-panel");
  if (!panel) return;
  applyPanelCollapse();
  // Content is always built (even while collapsed) so the slide animation has something to move; CSS
  // (.panel-collapsed on the layout) hides/animates it. Nothing here scrolls — the whole page does.
  const active = activeSubjects();
  // No collapse chevron — the filter icon in the toolbar opens/closes the panel. The match count
  // moves into the Subject section header (see buildSection). A "Clear all" appears only when active.
  // A persistent header ("Filters" left, "Clear all" right when active) so the panel never shifts
  // when Clear all appears/disappears.
  const head =
    '<div class="panel-head"><span class="panel-title">Filters</span>' +
    (totalActiveFilters() ? '<button type="button" class="panel-clear" id="panel-clear">Clear all</button>' : "") +
    "</div>";
  panel.innerHTML =
    '<div class="panel-inner">' +
    head +
    '<div class="panel-sections" id="panel-sections"></div>' +
    "</div>";
  const clear = el("panel-clear");
  if (clear) clear.addEventListener("click", () => { filters = {}; renderFilterPanel(); drawChart(); });
  const box = el("panel-sections");
  for (const section of panelSections()) box.appendChild(buildSection(section, active.length));
}

// Slide the panel in/out purely via a class on the layout, so the persistent .panel-inner element
// keeps its identity and CSS-transitions (rebuilding the DOM would skip the animation).
function applyPanelCollapse() {
  const layout = document.querySelector('.tab-panel[data-panel="data"] .data-layout');
  if (layout) layout.classList.toggle("panel-collapsed", panelCollapsed);
  syncFilterToggle();
}

// The filter-bar toggle mirrors panel state: "active" when open, badged with the live filter count.
function syncFilterToggle() {
  const btn = el("filter-toggle");
  if (!btn) return;
  const n = totalActiveFilters();
  btn.innerHTML = ICONS.filter + (n ? '<span class="filter-count">' + n + "</span>" : "");
  btn.classList.toggle("active", !panelCollapsed);
  btn.setAttribute("aria-pressed", String(!panelCollapsed));
}

function buildSection(section, activeCount) {
  const st = sectionSt(section.field);
  const wrap = document.createElement("div");
  wrap.className = "facet-section" + (st.collapsed ? " collapsed" : "");
  // The Subject section carries the "matching of total" count on the right (it replaces the old
  // panel-wide count line); other facets show a badge with how many values the filter touches, but
  // only while the facet is active (not all-checked).
  const f = section.isSubject ? null : filters[section.field];
  const right = section.isSubject
    ? '<span class="facet-header-count">' + Number(activeCount || 0).toLocaleString() + " of " + subjects.length.toLocaleString() + "</span>"
    : (f ? '<span class="facet-badge">' + f.set.size + "</span>" : "");
  wrap.innerHTML =
    '<button type="button" class="facet-header">' +
    '<span class="facet-chevron">' + (st.collapsed ? ICONS.chevronRight : ICONS.chevronDown) + "</span>" +
    '<span class="facet-title">' + esc(section.label) + "</span>" +
    right +
    "</button>" +
    '<div class="facet-body"></div>';
  wrap.querySelector(".facet-header").addEventListener("click", () => {
    st.collapsed = !st.collapsed;
    wrap.classList.toggle("collapsed", st.collapsed);
    wrap.querySelector(".facet-chevron").innerHTML = st.collapsed ? ICONS.chevronRight : ICONS.chevronDown;
    renderSectionBody(section, wrap);
  });
  if (!st.collapsed) renderSectionBody(section, wrap);
  return wrap;
}

function renderSectionBody(section, wrap) {
  const body = wrap.querySelector(".facet-body");
  const st = sectionSt(section.field);
  if (st.collapsed) { body.innerHTML = ""; return; }
  const pool = sectionPool(section);
  wrap.__pool = pool;
  const hasSearch = pool.length > SECTION_VALUE_LIMIT;
  let html = "";
  if (hasSearch) {
    html += '<input type="search" class="facet-search" placeholder="Search ' + esc(section.label.toLowerCase()) +
      '…" value="' + esc(st.search) + '" autocomplete="off">';
  }
  if (fieldActive(section.field)) {
    html += '<div class="facet-actions"><button type="button" class="facet-all">Select all</button></div>';
  }
  html += '<div class="facet-values"></div><button type="button" class="facet-more" hidden></button>';
  body.innerHTML = html;
  updateSectionValues(section, wrap);
  const search = body.querySelector(".facet-search");
  if (search) {
    let t = null;
    search.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        // A full panel rebuild (from a checkbox/only/clear anywhere) can fire this after our node is
        // detached — bail so we don't clobber st.search or write into an orphaned subtree.
        if (!body.isConnected) return;
        st.search = search.value; st.showAll = false; updateSectionValues(section, wrap);
      }, 150);
    });
  }
  const allBtn = body.querySelector(".facet-all");
  if (allBtn) allBtn.addEventListener("click", () => { clearSectionFilter(section); renderFilterPanel(); drawChart(); });
}

function updateSectionValues(section, wrap) {
  const body = wrap.querySelector(".facet-body");
  const st = sectionSt(section.field);
  const pool = wrap.__pool || sectionPool(section);
  const needle = st.search.trim().toLowerCase();
  const filtered = needle ? pool.filter((it) => itemLabel(section, it).toLowerCase().includes(needle)) : pool;
  // Build DOM only for the visible slice (≤20, or ≤SECTION_SHOWALL_MAX when expanded).
  const shown = filtered.slice(0, st.showAll ? SECTION_SHOWALL_MAX : SECTION_VALUE_LIMIT);
  const more = filtered.length - shown.length;
  const valsEl = body.querySelector(".facet-values");
  valsEl.innerHTML =
    shown
      .map((it) => {
        const value = itemValue(section, it), label = itemLabel(section, it), count = itemCount(section, it);
        const on = valueChecked(section.field, value);
        return '<label class="facet-row"><input type="checkbox" data-value="' + esc(value) + '"' + (on ? " checked" : "") + ">" +
          '<span class="facet-val" title="' + esc(label) + '">' + esc(label) + "</span>" +
          (count != null ? '<span class="facet-count">' + count.toLocaleString() + "</span>" : "") +
          '<button type="button" class="facet-only" data-value="' + esc(value) + '">only</button></label>';
      })
      .join("") + (shown.length ? "" : '<p class="facet-empty muted">No matches.</p>');
  const moreBtn = body.querySelector(".facet-more");
  if (more > 0) {
    // A big overflow (>99 hidden) isn't clickable — expanding would render hundreds of checkboxes;
    // point the user at the search box instead. A small overflow stays a click-to-reveal.
    const tooMany = more > 99;
    moreBtn.hidden = false;
    moreBtn.disabled = st.showAll || tooMany;
    moreBtn.textContent = (st.showAll || tooMany) ? more.toLocaleString() + " more — search to narrow" : "+" + more.toLocaleString() + " more";
  } else moreBtn.hidden = true;
  valsEl.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => { toggleSectionValue(section, cb.dataset.value, cb.checked); renderFilterPanel(); drawChart(); });
  });
  valsEl.querySelectorAll(".facet-only").forEach((b) => {
    b.addEventListener("click", (e) => { e.preventDefault(); onlySectionValue(section, b.dataset.value); renderFilterPanel(); drawChart(); });
  });
  if (moreBtn && !moreBtn.__wired) {
    moreBtn.__wired = true;
    moreBtn.addEventListener("click", () => { if (!moreBtn.disabled) { st.showAll = true; updateSectionValues(section, wrap); } });
  }
}

// ── The filter bar's per-view controls (into #bar-controls): bars get a metric picker + a
// sort-direction select; the table gets a which-columns picker. ──
let colsDocHandler = null; // the table Columns dropdown's outside-click closer (dedup'd each render)
function renderBarControls() {
  const box = el("bar-controls");
  if (!box) return;
  box.innerHTML = "";
  // Drop the previous Columns-dropdown document listener so it can't accumulate across re-renders.
  if (colsDocHandler) { document.removeEventListener("click", colsDocHandler); colsDocHandler = null; }
  if (chartMode !== "CATEGORY") return;
  if (chartView === "bars") {
    const metricSel =
      metricList.length > 1
        ? '<label class="field"><span class="vh">Metric</span><select id="metric-select" class="bar-select">' +
          metricList
            .map((m) => {
              const label = titleCase(m.name) + (metricUnit(m.name) ? " (" + metricUnit(m.name) + ")" : "");
              return '<option value="' + esc(m.name) + '"' + (m.name === currentY() ? " selected" : "") + ">" + esc(label) + "</option>";
            })
            .join("") + "</select></label>"
        : "";
    const sortSel =
      '<label class="field"><span class="vh">Sort direction</span><select id="sort-select" class="bar-select">' +
      '<option value="desc"' + (barsDesc ? " selected" : "") + ">Descending</option>" +
      '<option value="asc"' + (!barsDesc ? " selected" : "") + ">Ascending</option></select></label>";
    box.innerHTML = metricSel + sortSel;
    const ms = el("metric-select");
    if (ms) ms.addEventListener("change", () => { metricSelection = [ms.value]; drawChart(); });
    el("sort-select").addEventListener("change", (e) => { barsDesc = e.target.value === "desc"; drawChart(); });
    return;
  }
  // Table: a Columns checkbox dropdown (which metric columns to show).
  if (metricList.length <= 1) return;
  box.innerHTML =
    '<div class="field"><div class="dropdown" id="cols-dd">' +
    '<button type="button" class="dropdown-toggle" id="cols-toggle"></button>' +
    '<div class="dropdown-panel" id="cols-panel" hidden></div></div></div>';
  const dd = el("cols-dd"), toggle = el("cols-toggle"), panel = el("cols-panel");
  toggle.addEventListener("click", () => { panel.hidden = !panel.hidden; });
  colsDocHandler = (e) => { if (!dd.contains(e.target)) panel.hidden = true; };
  document.addEventListener("click", colsDocHandler);
  const paint = () => {
    toggle.textContent = "Columns · " + metricSelection.length + "/" + metricList.length;
    panel.innerHTML =
      '<div class="facet-actions"><button type="button" class="facet-all" data-cols-all="1">Select all</button></div>' +
      metricList
        .map((m) => {
          const on = metricSelection.includes(m.name);
          return '<label class="rail-row"><input type="checkbox" data-metric="' + esc(m.name) + '"' + (on ? " checked" : "") + " />" +
            '<span class="rail-name" title="' + esc(m.name) + '">' + esc(m.name) + "</span>" +
            '<button type="button" class="facet-only" data-cols-only="' + esc(m.name) + '">only</button></label>';
        })
        .join("");
  };
  panel.addEventListener("change", (e) => {
    const name = e.target.dataset && e.target.dataset.metric;
    if (!name) return;
    const set = new Set(metricSelection);
    if (e.target.checked) set.add(name); else if (set.size > 1) set.delete(name); // never zero
    metricSelection = metricList.map((m) => m.name).filter((n) => set.has(n));
    paint(); drawChart();
  });
  // Select all / per-column "only" (mirrors the facet quick-picks).
  panel.addEventListener("click", (e) => {
    const only = e.target.closest && e.target.closest("[data-cols-only]");
    const all = e.target.closest && e.target.closest("[data-cols-all]");
    if (!only && !all) return;
    e.preventDefault();
    metricSelection = only ? [only.dataset.colsOnly] : metricList.map((m) => m.name);
    paint(); drawChart();
  });
  paint();
}

function setupChartControls() {
  facetList = deriveFacets();

  // Range only applies to time-series charts.
  if (chartMode !== "TIME" && el("range-field")) el("range-field").hidden = true;

  // The filters live in the collapsible left panel; the filter-bar toggle shows/hides it (and, when
  // collapsed, is the only filter affordance — the panel takes zero width).
  const filterToggle = el("filter-toggle");
  if (filterToggle) {
    filterToggle.hidden = false;
    filterToggle.addEventListener("click", () => { panelCollapsed = !panelCollapsed; applyPanelCollapse(); });
  }
  renderFilterPanel();

  if (chartMode === "CATEGORY") {
    if (chartView === "bars" && metricSelection.length !== 1) metricSelection = [currentY()];
    if (chartView === "table" && !metricSelection.length) metricSelection = defaultMetricSelection();
    // View picker (Bars | Table) — no "View" label, slid to the right (before Share/Download).
    const view = el("view-controls");
    view.innerHTML =
      '<div class="segmented" role="radiogroup" aria-label="View">' +
      '<button type="button" class="seg-option' + (chartView === "bars" ? " active" : "") + '" data-view="bars" role="radio" aria-checked="' + (chartView === "bars") + '">Bars</button>' +
      '<button type="button" class="seg-option' + (chartView === "table" ? " active" : "") + '" data-view="table" role="radio" aria-checked="' + (chartView === "table") + '">Table</button>' +
      "</div>";
    view.querySelectorAll(".seg-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.view === chartView) return;
        chartView = btn.dataset.view;
        view.querySelectorAll(".seg-option").forEach((b) => {
          const on = b === btn;
          b.classList.toggle("active", on);
          b.setAttribute("aria-checked", String(on));
        });
        // Bars ⇒ one metric; Table ⇒ the fitting column set (or a carried-over multi-selection).
        if (chartView === "table") metricSelection = metricSelection.length > 1 ? metricSelection : defaultMetricSelection();
        else metricSelection = [currentY()];
        tableSort = { key: null, desc: true };
        renderBarControls();
        drawChart();
      });
    });
    renderBarControls();
  }

  if (el("range")) {
    el("range").addEventListener("change", () => {
      const v = el("range").value;
      if (v === "custom") return; // the Custom option mirrors a from/to window; it isn't an action
      rangeState = { preset: v };
      preZoomRange = null;
      syncRangeSelect(); // drops the Custom option now that a preset owns the window
      drawChart();
    });
  }

  // Share / Download are icon-only buttons that pop a modal of choices.
  const actions = el("chart-actions");
  actions.innerHTML =
    '<button type="button" class="btn icon-btn" id="share-btn" title="Share this view" aria-label="Share this view">' + ICONS.share + "</button>" +
    '<button type="button" class="btn icon-btn" id="download-btn" title="Download data" aria-label="Download data">' + ICONS.download + "</button>";
  el("share-btn").addEventListener("click", openShareModal);
  el("download-btn").addEventListener("click", () =>
    openDownloadModal({
      csv: () => downloadObservations("text/csv", "csv"),
      json: () => downloadObservations("application/vnd.api+json", "json"),
    }),
  );
}

init();
