"use strict";

// Data-driven benchmark page. Everything shown is pulled from the API for the {key} in the URL.
// The chart renders one of three modes declared in observation_schema.chart:
//   TIME     x = created_at        → time-series (scheduler-latency)
//   NUMBER   x = a numeric metric  → numeric-x overlay (aligns disjoint runs, e.g. elapsed_ms)
//   CATEGORY x = null              → one bar per target (a scalar per target)
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
    const domains = Array.isArray(pa.verified_domains) ? pa.verified_domains : [];
    return domains.length ? "https://" + domains[0] : null;
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
    const logo = safeHttpUrl(pa.logo_url);
    const logoImg = logo ? '<img class="attribution-logo" src="' + esc(logo) + '" alt="" />' : "";
    const domains = Array.isArray(pa.verified_domains) ? pa.verified_domains : [];
    let verified = "";
    if (domains.length) {
      const extra = domains.length > 1 ? " +" + (domains.length - 1) : "";
      verified =
        '<span class="attribution-verified" title="Verified domain: ' + esc(domains.join(", ")) + '">' +
        checkIcon() + esc(domains[0]) + extra + "</span>";
    }
    return '<span class="attribution"><span class="who">' + logoImg + nameEl + "</span>" + verified + "</span>";
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

function keyFromPath() {
  const parts = location.pathname.split("/").filter(Boolean);
  return decodeURIComponent(parts[1] || "");
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
    return u.origin + "/embed/" + encodeURIComponent(keyFromPath()) + ".png" + (qs ? "?" + qs : "");
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
const MAX_PAGES = 5; // ceiling: 5,000 rows per collection
async function fetchAllPages(url) {
  const data = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const sep = url.includes("?") ? "&" : "?";
    const doc = await fetchJson(url + sep + "page[number]=" + page + "&page[size]=" + PAGE_SIZE);
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
let targets = [];
let targetsTruncated = false;
let runs = []; // benchmark-wide; each carries attributes incl target + live + invalidated
let runsTruncated = false;
let metricList = [];
let chartDecl = null;
let chartMode = "TIME";
let chart = null;
let chartDrawn = false;
let chartView = "bars"; // CATEGORY visualization: "bars" | "table"
let selectedTargetIds = null; // Set of target ids, or null ⇒ all targets
let metricSelection = []; // checked metric names, in schema order
let railFilter = "";
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

// A short caption line for an embed image: source · primary metric · (date range, for TIME).
function embedSummary(a) {
  const parts = [];
  const pa = a.published_as;
  const src = pa && (pa.source_name || pa.name || pa.display_name);
  if (src) parts.push(src);
  const y = (chartDecl && chartDecl.y) || (metricList[0] && metricList[0].name);
  if (y) parts.push(y);
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
    '<span class="embed-url">smplmark.org/benchmarks/' + esc(a.key) + "</span>";

  wrap.insertBefore(title, wrap.firstChild);
  wrap.appendChild(caption);
}

// Leaderboard mode: a high-cardinality CATEGORY benchmark (e.g. SPEC CPU2017's ~11.8k systems) is
// browsed through the server-driven leaderboard — sort/search/facets/paging server-side — instead
// of loading every target into the page. See setupLeaderboard(). Small benchmarks keep the
// client-side chart/table/rail above.
const LEADERBOARD_THRESHOLD = 300;
const LB_PAGE_SIZE = 100;
let leaderboardMode = false;
let lbDrawn = false;
let lbTotal = 0;
let lbFacets = [];
let lbRows = [];
let lbState = { sort: null, desc: true, search: "", facets: {}, page: 1 }; // facets: field → Set(values)

async function init() {
  const crumb = el("crumb-back");
  if (crumb) crumb.href = withApi("/benchmarks");
  const key = keyFromPath();
  try {
    const doc = await fetchJson(API + "/api/v1/benchmarks?filter[key]=" + encodeURIComponent(key));
    benchmark = doc.data[0];
  } catch (err) {
    el("bm-name").textContent = "Error";
    el("load-status").className = "status error";
    el("load-status").textContent = "Failed to load benchmark: " + err.message + "." + apiFetchHint();
    return;
  }
  if (!benchmark) {
    el("bm-name").textContent = "Benchmark not found";
    el("load-status").textContent = "No published benchmark with key “" + key + "”.";
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
  const schema = a.observation_schema || { metrics: [], derived: [] };
  metricList = [...(schema.metrics || []), ...(schema.derived || [])];
  chartDecl = schema.chart || inferChart(metricList);
  chartMode = chartDecl ? chartDecl.x_kind || inferKind(chartDecl.x) : "TIME";

  // Probe the target count cheaply (one row) and switch a large CATEGORY benchmark into leaderboard
  // mode before loading anything else — the eager target/run fetch below is skipped for those.
  if (chartMode === "CATEGORY") {
    try {
      const probe = await fetchJson(leaderboardUrl({ size: 1, total: true }));
      lbTotal = (probe.meta && probe.meta.pagination && probe.meta.pagination.total) || 0;
      leaderboardMode = lbTotal > LEADERBOARD_THRESHOLD;
    } catch (_) {}
  }

  if (!leaderboardMode) {
    try {
      const res = await fetchAllPages(API + "/api/v1/targets?filter[benchmark]=" + encodeURIComponent(benchmark.id));
      targets = res.data;
      targetsTruncated = res.truncated;
    } catch (_) {
      targets = [];
    }
    // Runs: one benchmark-wide request (not one per target), for live + invalidation surfacing and
    // the run→target mapping the chart grouping needs. Best-effort.
    runs = [];
    try {
      const res = await fetchAllPages(API + "/api/v1/runs?filter[benchmark]=" + encodeURIComponent(benchmark.id));
      runs = res.data.map((r) => ({ ...r, targetId: r.attributes.target }));
      runsTruncated = res.truncated;
    } catch (_) {}
  }

  // Embed mode: render only the data panel (branded), await the draw, and signal ready for the
  // screenshotter — no tabs, no chrome, no other panels.
  if (embedMode) {
    readViewParams();
    if (leaderboardMode) setupLeaderboard();
    else setupChartControls();
    renderEmbedChrome();
    // The data panel must be visible (not display:none) so uPlot can measure it and draw.
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === "data"));
    el("tabs-wrap").hidden = false;
    try {
      if (leaderboardMode) { lbDrawn = true; await loadLeaderboard(); }
      else { chartDrawn = true; await drawChart(); }
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
  // that first draw must already see the URL-seeded range/targets/metrics/view/sort.
  readViewParams();
  // Build the data-panel controls (leaderboard shell or the client chart controls) BEFORE setupTabs,
  // because an initial #data hash makes setupTabs activate the tab, which draws into that shell.
  if (leaderboardMode) setupLeaderboard();
  else setupChartControls();
  setupTabs();

  el("tabs-wrap").hidden = false;
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
  if (targetsTruncated || runsTruncated) {
    html +=
      '<div class="banner"><strong>Large benchmark:</strong> showing the first ' +
      (targetsTruncated ? targets.length + " targets" : runs.length + " runs") +
      ". Narrow the view with the target picker on the Data tab.</div>";
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
    metricList
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
}

// ── Tabs — hash-routed (#overview/#data/#methodology/#publisher) so refresh restores the tab
// and the back button walks tab history. ──
const TAB_NAMES = ["overview", "data", "metrics", "methodology", "publisher"];
function activateTab(name, updateHash = true) {
  for (const t of document.querySelectorAll(".tab")) t.classList.toggle("active", t.dataset.tab === name);
  for (const p of document.querySelectorAll(".tab-panel")) p.classList.toggle("active", p.dataset.panel === name);
  if (name === "data") {
    if (leaderboardMode) {
      if (!lbDrawn) { lbDrawn = true; loadLeaderboard(); }
    } else if (!chartDrawn) {
      drawChart();
    }
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
  if (TAB_NAMES.includes(initial) && initial !== "overview") activateTab(initial, false);
  // A deep link that pins the data view but names no tab should land on the chart, not Overview.
  else if (!TAB_NAMES.includes(initial) && hasViewParams()) activateTab("data", false);
  window.addEventListener("resize", () => {
    if (chart) chart.setSize({ width: el("chart").clientWidth || 900, height: 420 });
  });
}

// ── Deep links — the query string carries the data view (from/to/range/targets/metrics/view/
// sort); the hash keeps sole ownership of the tab. Every param is optional and validated
// against loaded data: a bad value is dropped, never allowed to break rendering. ?api= and any
// unrecognized params pass through every rewrite untouched. ──
const VIEW_PARAM_KEYS = ["from", "to", "range", "targets", "metrics", "view", "sort"];
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
  // Leaderboard-mode params (large CATEGORY benchmarks) also mean "land on the Data tab".
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

// Seed the view state from the URL. Runs once, after targets/metricList load (keys and names
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

  // targets: comma-separated target KEYS → ids. Unknown keys drop silently; all dropped (or the
  // list naming every target) means the same as omitted — all targets. A present-but-empty
  // "targets=" round-trips a none-selected view. (Comma is the delimiter, so a key that itself
  // contains a comma can't round-trip — keys are meant to be URL-safe identifiers.)
  const targetsParam = params.get("targets");
  if (targetsParam !== null) {
    const idByKey = new Map(targets.map((t) => [t.attributes.key, t.id]));
    const fragments = targetsParam.split(",").map((s) => s.trim()).filter(Boolean);
    const ids = new Set();
    for (const k of fragments) {
      const id = idByKey.get(k);
      if (id) ids.add(id);
    }
    if (fragments.length === 0) selectedTargetIds = new Set();
    else if (ids.size && ids.size < targets.length) selectedTargetIds = ids;
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
}

// Single writer for the deep-link params: rewrite only our own keys, keep everything else
// (notably ?api=), re-append the tab hash. Defaults serialize as absence.
let syncViewTimer = null;
function syncViewParams() {
  clearTimeout(syncViewTimer);
  const params = searchParams();
  for (const k of VIEW_PARAM_KEYS) params.delete(k);

  if (chartMode === "TIME") {
    if (rangeState.preset !== undefined) {
      if (rangeState.preset !== "all") params.set("range", rangeState.preset);
    } else {
      if (rangeState.from != null) params.set("from", dateParamValue(rangeState.from, false));
      if (rangeState.to != null) params.set("to", dateParamValue(rangeState.to, true));
    }
  }

  if (selectedTargetIds !== null) {
    // Empty selection serializes as an explicit "targets=" — absence means all targets.
    const keys = targets.filter((t) => selectedTargetIds.has(t.id)).map((t) => t.attributes.key);
    params.set("targets", keys.join(","));
  }

  if (metricSelection.length && metricSelection.join(",") !== defaultMetricSelection().join(",")) {
    params.set("metrics", metricSelection.join(","));
  }

  if (chartMode === "CATEGORY" && chartView === "table") {
    params.set("view", "table");
    if (tableSort.key) params.set("sort", (tableSort.desc ? "-" : "") + tableSort.key);
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

function observationsUrl(scopeParam, scopeId, range) {
  let url = API + "/api/v1/observations?filter[" + scopeParam + "]=" + encodeURIComponent(scopeId);
  if (range) url += "&filter[created_at]=" + encodeURIComponent(range);
  return url;
}

// One benchmark-wide observations fetch per range (cached), grouped per target via the runs map —
// instead of one request per target.
const observationCache = new Map(); // range key → { byTarget: Map<targetId, obs[]>, truncated }
async function observationsByTarget(range) {
  const cacheKey = range || "all";
  if (observationCache.has(cacheKey)) return observationCache.get(cacheKey);
  const targetByRun = new Map(runs.map((r) => [r.id, r.targetId]));
  const res = await fetchAllPages(observationsUrl("benchmark", benchmark.id, range));
  const byTarget = new Map();
  for (const s of res.data) {
    const targetId = targetByRun.get(s.attributes.run);
    if (targetId === undefined) continue; // run beyond the runs page ceiling
    let list = byTarget.get(targetId);
    if (!list) { list = []; byTarget.set(targetId, list); }
    list.push(s);
  }
  const entry = { byTarget: byTarget, truncated: res.truncated };
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
}

function metricUnit(name) {
  const m = metricList.find((x) => x.name === name);
  return m && m.unit ? m.unit : "";
}

// Build [{x,y}] points for a target's observations for the active mode.
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

function renderXY(seriesTargets, perTargetPoints, yKey, timeX) {
  const xset = new Set();
  perTargetPoints.forEach((pts) => pts.forEach((p) => xset.add(p.x)));
  const xs = [...xset].sort((a, b) => a - b);
  if (!xs.length) { destroyChart(); el("empty").hidden = false; return; }
  el("empty").hidden = true;
  const idx = new Map(xs.map((x, i) => [x, i]));
  const data = [xs];
  perTargetPoints.forEach((pts) => {
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
      ...seriesTargets.map((t, i) => ({
        label: t.attributes.name,
        stroke: COLORS[i % COLORS.length],
        width: 1.5,
        spanGaps: true,
        points: { show: xs.length < 200 },
      })),
    ],
    axes: [
      timeX ? Object.assign({ values: utcTicks }, AXIS) : Object.assign({ label: xLabel, labelSize: 30 }, AXIS),
      Object.assign({ label: yKey + (unit ? " (" + unit + ")" : ""), labelSize: 34 }, AXIS),
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

function renderBars(seriesTargets, perTargetPoints, yKey) {
  // CATEGORY: reduce each target's observations to a single value (mean of y), ranked best-first.
  // Every row renders — the data is already in the browser, and scrolling beats clicking.
  destroyChart();
  const rows = seriesTargets.map((t, i) => {
    const pts = perTargetPoints[i];
    const mean = pts.length ? pts.reduce((s, p) => s + p.y, 0) / pts.length : null;
    return { name: t.attributes.name, value: mean };
  });
  rows.sort((a, z) => (z.value == null ? -Infinity : z.value) - (a.value == null ? -Infinity : a.value));
  const max = Math.max(1, ...rows.map((r) => (r.value == null ? 0 : Math.abs(r.value))));
  if (!rows.some((r) => r.value != null)) { el("empty").hidden = false; return; }
  el("empty").hidden = true;
  const unit = metricUnit(yKey);
  el("chart").innerHTML =
    '<div class="bars">' +
    (embedMode ? rows.slice(0, EMBED_ROWS) : rows)
      .map((r, i) => {
        const w = r.value == null ? 0 : Math.round((Math.abs(r.value) / max) * 100);
        const val = r.value == null ? "—" : fmtCell(r.value) + (unit ? " " + unit : "");
        return (
          '<div class="bar-row"><div class="bar-label" title="' + esc(r.name) + '">' + esc(r.name) + "</div>" +
          '<div class="bar-track"><div class="bar-fill" style="width:' + w + "%;background:" + COLORS[i % COLORS.length] + '"></div></div>' +
          '<div class="bar-value">' + esc(val) + "</div></div>"
        );
      })
      .join("") +
    "</div>";
}

// ── Table view (CATEGORY benchmarks): every metric per target, sortable by column ──
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

function renderTable(seriesTargets, byTarget) {
  destroyChart();
  const metricNames = metricSelection.length ? metricSelection : metricList.map((m) => m.name);
  const rows = seriesTargets.map((t) => {
    const obs = byTarget.get(t.id) || [];
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
    '<div class="table-wrap"><table class="data-table"><thead><tr><th>Target</th>' +
    metricNames
      .map(
        (name) =>
          '<th class="sortable" data-metric="' + esc(name) + '">' + esc(name) +
          (name === key ? (tableSort.desc ? " ↓" : " ↑") : "") + "</th>",
      )
      .join("") +
    "</tr></thead><tbody>" +
    (embedMode ? rows.slice(0, EMBED_ROWS) : rows)
      .map(
        (r) =>
          '<tr><td title="' + esc(r.name) + '">' + esc(r.name) + "</td>" +
          metricNames.map((name) => "<td>" + esc(fmtCell(r.cells[name])) + "</td>").join("") +
          "</tr>",
      )
      .join("") +
    "</tbody></table></div>";
  el("chart").querySelectorAll("th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const metric = th.dataset.metric;
      tableSort = { key: metric, desc: tableSort.key === metric ? !tableSort.desc : true };
      syncViewParams(); // re-render below skips drawChart, so the URL syncs here
      renderTable(seriesTargets, byTarget);
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
  let seriesTargets = activeTargets();
  if (!seriesTargets.length) {
    destroyChart();
    el("chart").innerHTML = "";
    el("chart-status").textContent = "No targets selected.";
    return;
  }
  el("chart-status").className = "status";
  el("chart-status").textContent = "Loading…";
  try {
    const { byTarget, truncated } = await observationsByTarget(range);
    let seriesNote = "";
    if (chartMode !== "CATEGORY" && seriesTargets.length > MAX_SERIES) {
      seriesTargets = seriesTargets.slice(0, MAX_SERIES);
      seriesNote = " · first " + MAX_SERIES + " selected targets plotted — narrow the target list to focus";
    }
    const xKey = chartMode === "NUMBER" ? chartDecl.x : "created_at";
    const perTargetPoints = seriesTargets.map((t) => pointsFor(byTarget.get(t.id) || [], yKey, xKey));
    if (chartMode === "CATEGORY" && chartView === "table") renderTable(seriesTargets, byTarget);
    else if (chartMode === "CATEGORY") renderBars(seriesTargets, perTargetPoints, yKey);
    else renderXY(seriesTargets, perTargetPoints, yKey, chartMode === "TIME");
    const total = perTargetPoints.reduce((n, pts) => n + pts.length, 0);
    el("chart-status").textContent =
      total + " observations · " + seriesTargets.length + " target(s) · metric “" + yKey + "” · " +
      chartMode.toLowerCase() + " chart" +
      (truncated ? " · large dataset — first " + MAX_PAGES * PAGE_SIZE + " observations loaded" : "") +
      seriesNote + ".";
  } catch (err) {
    destroyChart();
    el("chart-status").className = "status error";
    el("chart-status").textContent = "Failed to load observations: " + err.message;
  }
}

function currentScopeUrl(range) {
  const active = activeTargets();
  return active.length === 1
    ? observationsUrl("target", active[0].id, range)
    : observationsUrl("benchmark", benchmark.id, range);
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

// ── Share menu ──
// One button that answers "what do you want to do with this data?": copy the shareable link,
// post to a social network (plain intent URLs — no SDKs, no tracking, matching our privacy stance),
// email it, or download the current scope as CSV/JSON. The link always reflects the on-screen view
// because the deep-link params keep the URL in sync. Rendered into both the chart-mode and
// leaderboard-mode control bars; only one exists at a time (leaderboard replaces the panel).

function shareMenuHtml() {
  return (
    '<div class="share">' +
    '<button type="button" class="btn share-btn" aria-haspopup="true" aria-expanded="false">Share' +
    '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
    "</button>" +
    '<div class="share-menu" hidden role="menu">' +
    '<button type="button" class="share-item" data-act="copy" role="menuitem">Copy link</button>' +
    '<button type="button" class="share-item" data-act="copy-image" role="menuitem">Copy image link</button>' +
    '<a class="share-item" data-act="x" role="menuitem" target="_blank" rel="noopener">Share on X</a>' +
    '<a class="share-item" data-act="linkedin" role="menuitem" target="_blank" rel="noopener">Share on LinkedIn</a>' +
    '<a class="share-item" data-act="facebook" role="menuitem" target="_blank" rel="noopener">Share on Facebook</a>' +
    '<a class="share-item" data-act="email" role="menuitem">Email</a>' +
    '<div class="share-sep" role="separator"></div>' +
    '<button type="button" class="share-item" data-act="csv" role="menuitem">Download CSV</button>' +
    '<button type="button" class="share-item" data-act="json" role="menuitem">Download JSON</button>' +
    "</div></div>"
  );
}

// Wire a rendered share control. `downloads` supplies the mode-specific CSV/JSON handlers.
function wireShareMenu(root, downloads) {
  const wrap = root.querySelector(".share");
  const btn = wrap.querySelector(".share-btn");
  const menu = wrap.querySelector(".share-menu");
  const copyItem = wrap.querySelector('[data-act="copy"]');

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

  let onDoc = null;
  function close() {
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    if (onDoc) {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
      onDoc = null;
    }
  }
  function onKey(e) {
    if (e.key === "Escape") { close(); btn.focus(); }
  }
  function open() {
    refreshLinks();
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
    const prev = item.textContent;
    item.textContent = "Copied!";
    setTimeout(() => { item.textContent = prev; }, 1200);
  }
  copyItem.addEventListener("click", () => copyToClipboard(shareUrl(), copyItem));
  const copyImageItem = wrap.querySelector('[data-act="copy-image"]');
  copyImageItem.addEventListener("click", () => copyToClipboard(embedImageUrl(), copyImageItem));

  // Social/email anchors navigate themselves (hrefs set on open); just close the menu after.
  wrap.querySelectorAll('a.share-item').forEach((a) => a.addEventListener("click", close));

  wrap.querySelector('[data-act="csv"]').addEventListener("click", () => { close(); downloads.csv(); });
  wrap.querySelector('[data-act="json"]').addEventListener("click", () => { close(); downloads.json(); });
}

// ── Leaderboard mode (large CATEGORY benchmarks): server-driven sort / search / facets / paging.
// Takes over the Data panel entirely; the client-side chart/rail machinery above is untouched. ──

const FACET_LABELS = {
  vendor: "Vendor", sponsor: "Test sponsor", chips: "Sockets", cores: "Cores", copies: "Copies",
  threads_per_core: "Threads / core", nodes: "Nodes", ranks: "Ranks", threads: "Threads",
  jvm: "JVM", os: "OS", database: "Database", currency: "Currency", tpc_status: "Status",
};
const FACET_MAX_VALUES = 12; // values shown per facet before "+N more"

function facetLabel(field) {
  return FACET_LABELS[field] || field.charAt(0).toUpperCase() + field.slice(1).replace(/_/g, " ");
}
function metricByName(name) {
  return metricList.find((m) => m.name === name) || null;
}
function metricLabel(name) {
  const m = metricByName(name);
  return m && m.unit ? m.name + " (" + m.unit + ")" : name;
}
function anyLbFilter() {
  return Object.keys(lbState.facets).length > 0 || lbState.search.trim() !== "";
}
function lbSortField() {
  return lbState.sort || (chartDecl && chartDecl.y) || (metricList[0] && metricList[0].name) || null;
}

/** Build the leaderboard request URL from current sort/search/facets/page. */
function leaderboardUrl(opts) {
  opts = opts || {};
  const p = new URLSearchParams();
  const field = lbSortField();
  if (field) p.set("sort", (lbState.desc ? "-" : "") + field);
  p.set("page[size]", String(opts.size || LB_PAGE_SIZE));
  p.set("page[number]", String(opts.page || lbState.page || 1));
  if (opts.total) p.set("meta[total]", "true");
  if (lbState.search.trim()) p.set("filter[search]", lbState.search.trim());
  for (const f of Object.keys(lbState.facets)) {
    for (const v of lbState.facets[f]) p.append("filter[facet." + f + "]", v);
  }
  return API + "/api/v1/benchmarks/" + encodeURIComponent(benchmark.id) + "/leaderboard?" + p.toString();
}

// Leaderboard deep-linking: mirror lbState (view / sort / search / facets / page) into the URL so
// "Copy link" reproduces the exact filtered view, just as the chart mode does for small benchmarks.
// Leaderboard and chart mode never coexist for one benchmark, so `view`/`sort` are unambiguous.
const LB_PARAM_KEYS = ["view", "sort", "q", "page"]; // plus facet.<field> handled dynamically

function lbDefaultField() {
  return (chartDecl && chartDecl.y) || (metricList[0] && metricList[0].name) || null;
}

// State → URL. Serialize only departures from the default view (table, y-metric high→low, no
// filters), so a pristine leaderboard has a clean URL. Preserves the hash + ?api= + anything else.
function syncLbParams() {
  const params = searchParams();
  for (const k of [...params.keys()]) {
    if (LB_PARAM_KEYS.includes(k) || k.startsWith("facet.")) params.delete(k);
  }
  if (chartView === "bars") params.set("view", "bars"); // table is the leaderboard default
  const field = lbSortField();
  if (field && (field !== lbDefaultField() || !lbState.desc)) {
    params.set("sort", (lbState.desc ? "-" : "") + field);
  }
  if (lbState.search.trim()) params.set("q", lbState.search.trim());
  for (const f of Object.keys(lbState.facets)) {
    const vals = [...lbState.facets[f]];
    if (vals.length) params.set("facet." + f, vals.join(","));
  }
  if (lbState.page > 1) params.set("page", String(lbState.page));
  const qs = params.toString();
  history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
}

// URL → state. Runs once before the first load. Sort is validated against real metrics; facet
// values pass through (the server ignores unknown facets — we can't know them until data loads).
function readLbParams() {
  const params = searchParams();
  const sortParam = params.get("sort");
  if (sortParam) {
    const desc = sortParam.charAt(0) === "-";
    const name = desc ? sortParam.slice(1) : sortParam;
    if (metricList.some((m) => m.name === name)) { lbState.sort = name; lbState.desc = desc; }
  }
  const q = params.get("q");
  if (q) lbState.search = q;
  const facets = {};
  for (const [k, v] of params) {
    if (k.startsWith("facet.") && v) {
      const set = new Set(v.split(",").map((s) => s.trim()).filter(Boolean));
      if (set.size) facets[k.slice(6)] = set; // "facet.".length === 6
    }
  }
  if (Object.keys(facets).length) lbState.facets = facets;
  const page = parseInt(params.get("page") || "", 10);
  if (Number.isInteger(page) && page > 1) lbState.page = page;
}

/** Replace the Data panel with the leaderboard shell and wire its controls. */
function setupLeaderboard() {
  lbState.sort = lbSortField();
  // A ranked table (rank · system · vendor · scores) reads better than bars for thousands of rows,
  // so leaderboard mode defaults to the table — unless the deep link explicitly asked for bars.
  const viewParam = searchParams().get("view");
  chartView = viewParam === "bars" || viewParam === "table" ? viewParam : "table";
  readLbParams(); // seed sort / search / facets / page from the URL, overriding the defaults
  const panel = document.querySelector('.tab-panel[data-panel="data"]');
  const options = metricList.map((m) => '<option value="' + esc(m.name) + '">' + esc(metricLabel(m.name)) + "</option>").join("");
  panel.innerHTML =
    '<div class="data-layout">' +
    '<aside class="target-rail lb-facets" id="lb-facets"></aside>' +
    '<div class="data-main">' +
    '<div class="controls lb-controls">' +
    '<input id="lb-search" class="lb-search" type="search" placeholder="Search systems…" autocomplete="off">' +
    '<div class="field"><label for="lb-sort">Sort</label><select id="lb-sort">' + options + "</select></div>" +
    '<button type="button" class="btn lb-dir" id="lb-dir">High → low</button>' +
    '<div class="spacer"></div>' +
    '<div class="field"><label>View</label><div class="segmented" role="radiogroup" aria-label="View">' +
    '<button type="button" class="seg-option' + (chartView === "bars" ? " active" : "") + '" data-view="bars" role="radio" aria-checked="' + (chartView === "bars") + '">Bars</button>' +
    '<button type="button" class="seg-option' + (chartView === "table" ? " active" : "") + '" data-view="table" role="radio" aria-checked="' + (chartView === "table") + '">Table</button>' +
    "</div></div>" +
    '<div class="links" id="lb-actions">' + shareMenuHtml() + "</div>" +
    "</div>" +
    '<div id="lb-main"></div>' +
    '<div id="lb-status" class="status"></div>' +
    '<div id="lb-pager" class="lb-pager"></div>' +
    "</div></div>";

  if (lbState.sort) el("lb-sort").value = lbState.sort;
  el("lb-dir").textContent = lbState.desc ? "High → low" : "Low → high";
  el("lb-search").value = lbState.search;
  el("lb-sort").addEventListener("change", () => {
    lbState.sort = el("lb-sort").value;
    lbState.page = 1;
    loadLeaderboard();
  });
  el("lb-dir").addEventListener("click", () => {
    lbState.desc = !lbState.desc;
    el("lb-dir").textContent = lbState.desc ? "High → low" : "Low → high";
    lbState.page = 1;
    loadLeaderboard();
  });
  let searchTimer = null;
  el("lb-search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      lbState.search = el("lb-search").value;
      lbState.page = 1;
      loadLeaderboard();
    }, 300);
  });
  panel.querySelectorAll(".seg-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.view === chartView) return;
      chartView = btn.dataset.view;
      panel.querySelectorAll(".seg-option").forEach((b) => {
        const on = b === btn;
        b.classList.toggle("active", on);
        b.setAttribute("aria-checked", String(on));
      });
      syncLbParams(); // the view toggle doesn't reload, so sync the URL here
      renderLbMain();
    });
  });
  wireShareMenu(el("lb-actions"), {
    csv: () => downloadLeaderboard("csv"),
    json: () => downloadLeaderboard("json"),
  });
}

// Download the WHOLE current filter (server caps to the target limit) as CSV or JSON. CSV is driven
// by the Accept header; JSON by ?format=json — both hit the same filtered leaderboard URL.
async function downloadLeaderboard(ext) {
  const status = el("lb-status");
  try {
    const url = leaderboardUrl({}) + (ext === "json" ? "&format=json" : "");
    const accept = ext === "csv" ? "text/csv" : "application/json";
    const res = await fetch(url, { headers: { Accept: accept } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = benchmark.attributes.key + "-leaderboard." + ext;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    status.className = "status error";
    status.textContent = ext.toUpperCase() + " download failed: " + err.message;
  }
}

/** Fetch the current page + total + facets and redraw everything. */
async function loadLeaderboard() {
  syncLbParams(); // every data-affecting change funnels through here — keep the URL shareable
  const status = el("lb-status");
  status.className = "status";
  status.textContent = "Loading…";
  try {
    // An image can't scroll, so an embed fetches just the top rows.
    const doc = await fetchJson(leaderboardUrl({ total: true, size: embedMode ? EMBED_ROWS : undefined }));
    lbRows = doc.data || [];
    lbTotal = (doc.meta && doc.meta.pagination && doc.meta.pagination.total) || lbRows.length;
    lbFacets = (doc.meta && doc.meta.facets) || [];
    renderLbFacets();
    renderLbMain();
    renderLbPager();
    status.className = "status";
    status.textContent = lbStatusLine();
  } catch (err) {
    status.className = "status error";
    status.textContent = "Failed to load leaderboard: " + err.message;
  }
}

function lbStatusLine() {
  if (lbTotal === 0) return "No systems match these filters.";
  const start = (lbState.page - 1) * LB_PAGE_SIZE + 1;
  const end = Math.min(lbState.page * LB_PAGE_SIZE, lbTotal);
  return (
    lbTotal.toLocaleString() + (anyLbFilter() ? " matching" : "") + " system" + (lbTotal === 1 ? "" : "s") +
    " · showing " + start.toLocaleString() + "–" + end.toLocaleString() +
    " · sorted by " + (lbState.sort || "") + (lbState.desc ? " (high→low)" : " (low→high)")
  );
}

function renderLbFacets() {
  const box = el("lb-facets");
  if (!lbFacets.length) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  let html =
    '<div class="rail-head"><span class="rail-title">Filter</span>' +
    (anyLbFilter() ? '<button type="button" class="rail-all" id="lb-clear">Clear</button>' : "") +
    "</div>";
  for (const f of lbFacets) {
    const active = lbState.facets[f.field] || new Set();
    html += '<div class="facet"><div class="facet-name">' + esc(facetLabel(f.field)) + "</div>";
    for (const v of f.values.slice(0, FACET_MAX_VALUES)) {
      html +=
        '<label class="facet-row"><input type="checkbox" data-field="' + esc(f.field) + '" data-value="' + esc(v.value) + '"' +
        (active.has(v.value) ? " checked" : "") + ">" +
        '<span class="facet-val" title="' + esc(v.value) + '">' + esc(v.value) + "</span>" +
        '<span class="facet-count">' + v.count.toLocaleString() + "</span></label>";
    }
    if (f.values.length > FACET_MAX_VALUES) {
      html += '<div class="facet-more">+' + (f.values.length - FACET_MAX_VALUES) + (f.truncated ? "+" : "") + " more</div>";
    }
    html += "</div>";
  }
  box.innerHTML = html;
  box.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const field = cb.dataset.field;
      const set = lbState.facets[field] || new Set();
      if (cb.checked) set.add(cb.dataset.value);
      else set.delete(cb.dataset.value);
      if (set.size) lbState.facets[field] = set;
      else delete lbState.facets[field];
      lbState.page = 1;
      loadLeaderboard();
    });
  });
  const clear = el("lb-clear");
  if (clear) {
    clear.addEventListener("click", () => {
      lbState.facets = {};
      lbState.search = "";
      if (el("lb-search")) el("lb-search").value = "";
      lbState.page = 1;
      loadLeaderboard();
    });
  }
}

function renderLbMain() {
  const main = el("lb-main");
  if (!lbRows.length) { main.innerHTML = '<div class="empty">No systems match these filters.</div>'; return; }
  if (chartView === "bars") renderLbBars(main);
  else renderLbTable(main);
}

function renderLbTable(main) {
  const metricNames = metricList.map((m) => m.name);
  const startRank = (lbState.page - 1) * LB_PAGE_SIZE;
  const showVendor = lbRows.some((r) => r.attributes.details && r.attributes.details.vendor);
  let html =
    '<div class="table-wrap"><table class="data-table lb-table"><thead><tr><th class="rank">#</th><th class="name-col">System</th>' +
    (showVendor ? '<th class="text-col">Vendor</th>' : "") +
    metricNames
      .map(
        (n) =>
          '<th class="sortable" data-metric="' + esc(n) + '">' + esc(metricLabel(n)) +
          (lbState.sort === n ? (lbState.desc ? " ↓" : " ↑") : "") + "</th>",
      )
      .join("") +
    "</tr></thead><tbody>";
  lbRows.forEach((r, i) => {
    const a = r.attributes;
    const metrics = a.metrics || {};
    html +=
      '<tr><td class="rank">' + (startRank + i + 1) + '</td><td class="name-col" title="' + esc(a.name) + '">' + esc(a.name) + "</td>" +
      (showVendor ? '<td class="text-col">' + esc((a.details && a.details.vendor) || "—") + "</td>" : "") +
      metricNames.map((n) => "<td>" + esc(fmtCell(metrics[n])) + "</td>").join("") +
      "</tr>";
  });
  html += "</tbody></table></div>";
  main.innerHTML = html;
  main.querySelectorAll("th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const m = th.dataset.metric;
      if (lbState.sort === m) lbState.desc = !lbState.desc;
      else { lbState.sort = m; lbState.desc = true; }
      if (el("lb-sort")) el("lb-sort").value = lbState.sort;
      if (el("lb-dir")) el("lb-dir").textContent = lbState.desc ? "High → low" : "Low → high";
      lbState.page = 1;
      loadLeaderboard();
    });
  });
}

function renderLbBars(main) {
  const yKey = lbSortField();
  const unit = metricUnit(yKey);
  const rows = lbRows.map((r) => {
    const v = (r.attributes.metrics || {})[yKey];
    return { name: r.attributes.name, value: typeof v === "number" ? v : null };
  });
  const max = Math.max(1, ...rows.map((r) => (r.value == null ? 0 : Math.abs(r.value))));
  main.innerHTML =
    '<div class="bars">' +
    rows
      .map((r, i) => {
        const w = r.value == null ? 0 : Math.round((Math.abs(r.value) / max) * 100);
        const val = r.value == null ? "—" : fmtCell(r.value) + (unit ? " " + unit : "");
        return (
          '<div class="bar-row"><div class="bar-label" title="' + esc(r.name) + '">' + esc(r.name) + "</div>" +
          '<div class="bar-track"><div class="bar-fill" style="width:' + w + "%;background:" + COLORS[i % COLORS.length] + '"></div></div>' +
          '<div class="bar-value">' + esc(val) + "</div></div>"
        );
      })
      .join("") +
    "</div>";
}

function renderLbPager() {
  const pager = el("lb-pager");
  const pages = Math.max(1, Math.ceil(lbTotal / LB_PAGE_SIZE));
  if (pages <= 1) { pager.innerHTML = ""; return; }
  pager.innerHTML =
    '<button type="button" class="btn" id="lb-prev"' + (lbState.page <= 1 ? " disabled" : "") + ">‹ Prev</button>" +
    '<span class="lb-pageinfo">Page ' + lbState.page + " of " + pages.toLocaleString() + "</span>" +
    '<button type="button" class="btn" id="lb-next"' + (lbState.page >= pages ? " disabled" : "") + ">Next ›</button>";
  const go = (delta) => {
    lbState.page = Math.min(pages, Math.max(1, lbState.page + delta));
    loadLeaderboard();
    const panel = document.querySelector('.tab-panel[data-panel="data"]');
    if (panel) panel.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  if (el("lb-prev")) el("lb-prev").addEventListener("click", () => go(-1));
  if (el("lb-next")) el("lb-next").addEventListener("click", () => go(1));
}

const MAX_RAIL_ROWS = 500;

// ── The target rail: every target with a checkbox (all on by default) and a hover "only" link
// that isolates it, Datadog-style. ──
function railTargets() {
  const needle = railFilter.trim().toLowerCase();
  return needle
    ? targets.filter((t) => t.attributes.name.toLowerCase().includes(needle))
    : targets;
}

function setupTargetRail() {
  const rail = el("target-rail");
  rail.innerHTML =
    '<div class="rail-head"><span class="rail-title">Targets</span>' +
    '<span class="rail-meta" id="rail-meta"></span>' +
    '<button type="button" class="rail-all" id="rail-all" hidden>All</button></div>' +
    (targets.length > 100
      ? '<input type="search" id="rail-search" class="target-search" placeholder="Filter ' + targets.length + ' targets…" autocomplete="off" />'
      : "") +
    '<div class="rail-list" id="rail-list"></div>' +
    '<p class="rail-note" id="rail-note" hidden></p>';
  const search = rail.querySelector("#rail-search");
  if (search) {
    search.addEventListener("input", () => {
      railFilter = search.value;
      renderRailList();
    });
  }
  rail.querySelector("#rail-all").addEventListener("click", () => {
    selectedTargetIds = null;
    renderRailList();
    drawChart();
  });
  const list = rail.querySelector("#rail-list");
  list.addEventListener("change", (e) => {
    const id = e.target.dataset && e.target.dataset.id;
    if (!id) return;
    if (selectedTargetIds === null) selectedTargetIds = new Set(targets.map((t) => t.id));
    if (e.target.checked) selectedTargetIds.add(id);
    else selectedTargetIds.delete(id);
    if (selectedTargetIds.size === targets.length) selectedTargetIds = null;
    renderRailList();
    drawChart();
  });
  list.addEventListener("click", (e) => {
    const only = e.target.closest && e.target.closest(".rail-only");
    if (!only) return;
    e.preventDefault();
    selectedTargetIds = new Set([only.dataset.id]);
    renderRailList();
    drawChart();
  });
  renderRailList();
}

function renderRailList() {
  const matches = railTargets();
  const shown = matches.slice(0, MAX_RAIL_ROWS);
  el("rail-list").innerHTML = shown
    .map((t) => {
      const on = selectedTargetIds === null || selectedTargetIds.has(t.id);
      return (
        '<label class="rail-row">' +
        '<input type="checkbox" data-id="' + esc(t.id) + '"' + (on ? " checked" : "") + " />" +
        '<span class="rail-name" title="' + esc(t.attributes.name) + '">' + esc(t.attributes.name) + "</span>" +
        '<button type="button" class="rail-only" data-id="' + esc(t.id) + '">only</button>' +
        "</label>"
      );
    })
    .join("");
  const checked = selectedTargetIds === null ? targets.length : selectedTargetIds.size;
  el("rail-meta").textContent = checked + "/" + targets.length;
  el("rail-all").hidden = selectedTargetIds === null;
  const note = el("rail-note");
  note.hidden = matches.length <= MAX_RAIL_ROWS;
  if (!note.hidden) note.textContent = "Showing " + MAX_RAIL_ROWS + " of " + matches.length + " — refine the filter.";
}

/** The targets currently checked (all when nothing is deselected). */
function activeTargets() {
  return selectedTargetIds === null ? targets : targets.filter((t) => selectedTargetIds.has(t.id));
}

// ── The metric picker: a checkbox dropdown; the table shows every checked metric as a column,
// bars/line charts plot the primary (the chart default when checked, else the first checked). ──
function defaultMetricSelection() {
  const names = metricList.map((m) => m.name);
  if (names.length <= 1) return names;
  const primary = chartDecl && names.includes(chartDecl.y) ? chartDecl.y : names[0];
  const ordered = [primary, ...names.filter((n) => n !== primary)];
  // Fit heuristic: how many columns sit beside the target column without horizontal scrolling.
  const width = el("chart").clientWidth || 900;
  const fit = Math.max(1, Math.floor((width - 300) / 140));
  const kept = ordered.slice(0, Math.min(fit, ordered.length));
  return names.filter((n) => kept.includes(n)); // back to schema order
}

function setupMetricControl() {
  if (metricList.length <= 1) {
    metricSelection = metricList.map((m) => m.name);
    return;
  }
  if (!metricSelection.length) metricSelection = defaultMetricSelection(); // URL may have seeded it
  const field = el("metric-field");
  field.hidden = false;
  const box = el("metric-dropdown");
  box.innerHTML =
    '<button type="button" class="dropdown-toggle" id="metric-toggle"></button>' +
    '<div class="dropdown-panel" id="metric-panel" hidden></div>';
  const toggle = el("metric-toggle");
  const panel = el("metric-panel");
  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
  });
  document.addEventListener("click", (e) => {
    if (!box.contains(e.target)) panel.hidden = true;
  });
  panel.addEventListener("change", (e) => {
    const name = e.target.dataset && e.target.dataset.metric;
    if (!name) return;
    const set = new Set(metricSelection);
    if (e.target.checked) set.add(name);
    else if (set.size > 1) set.delete(name); // never zero metrics
    metricSelection = metricList.map((m) => m.name).filter((n) => set.has(n));
    renderMetricControl();
    drawChart();
  });
  panel.addEventListener("click", (e) => {
    const only = e.target.closest && e.target.closest(".rail-only");
    if (!only) return;
    e.preventDefault();
    metricSelection = [only.dataset.metric];
    renderMetricControl();
    drawChart();
  });
  renderMetricControl();
}

function renderMetricControl() {
  const panel = el("metric-panel");
  if (!panel) return;
  el("metric-toggle").textContent =
    "Metrics · " + metricSelection.length + "/" + metricList.length;
  panel.innerHTML = metricList
    .map((m) => {
      const on = metricSelection.includes(m.name);
      return (
        '<label class="rail-row">' +
        '<input type="checkbox" data-metric="' + esc(m.name) + '"' + (on ? " checked" : "") + " />" +
        '<span class="rail-name" title="' + esc(m.name) + '">' + esc(m.name) + "</span>" +
        '<button type="button" class="rail-only" data-metric="' + esc(m.name) + '">only</button>' +
        "</label>"
      );
    })
    .join("");
}

function setupChartControls() {
  setupTargetRail();
  setupMetricControl();

  // Range only applies to time-series charts.
  if (chartMode !== "TIME" && el("range-field")) el("range-field").hidden = true;

  // CATEGORY benchmarks get a visualization picker (ranked bars, or a sortable table of every
  // metric per target) — a two-option segmented control, radio semantics.
  if (chartMode === "CATEGORY") {
    const field = document.createElement("div");
    field.className = "field";
    field.innerHTML =
      "<label>View</label>" +
      '<div class="segmented" role="radiogroup" aria-label="View">' +
      '<button type="button" class="seg-option' + (chartView === "bars" ? " active" : "") +
      '" data-view="bars" role="radio" aria-checked="' + (chartView === "bars") + '">Bars</button>' +
      '<button type="button" class="seg-option' + (chartView === "table" ? " active" : "") +
      '" data-view="table" role="radio" aria-checked="' + (chartView === "table") + '">Table</button>' +
      "</div>";
    const metricField = el("metric-field");
    metricField.parentElement.insertBefore(field, metricField);
    field.querySelectorAll(".seg-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.view === chartView) return;
        chartView = btn.dataset.view;
        field.querySelectorAll(".seg-option").forEach((b) => {
          const on = b === btn;
          b.classList.toggle("active", on);
          b.setAttribute("aria-checked", String(on));
        });
        tableSort = { key: null, desc: true };
        drawChart();
      });
    });
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
  const actions = el("chart-actions");
  actions.innerHTML = shareMenuHtml();
  wireShareMenu(actions, {
    csv: () => downloadObservations("text/csv", "csv"),
    json: () => downloadObservations("application/vnd.api+json", "json"),
  });
}

init();
