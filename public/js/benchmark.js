"use strict";

// Data-driven benchmark page. Everything shown is pulled from the API for the {key} in the URL.
// The chart renders one of three modes declared in sample_schema.chart:
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

// Build the frozen attribution badge from a benchmark's published_as snapshot. When nameHref is
// given the name is a link (used in the byline to jump to the Publisher tab).
function attributionMarkup(pa, nameHref) {
  if (!pa) return "";
  const label = esc(pa.name || pa.display_name || "");
  const nameEl = nameHref
    ? '<a href="' + esc(nameHref) + '" class="attribution-name" id="byline-link">' + label + "</a>"
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
  // PERSONAL
  const g = gravatarUrl(pa.gravatar_hash, 44);
  const avatar = g ? '<img class="attribution-avatar" src="' + esc(g) + '" alt="" />' : "";
  return '<span class="attribution"><span class="who">' + avatar + nameEl + "</span></span>";
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
  return ""; // same-origin fallback (e.g. a combined local deployment)
}
const API = apiBase();

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
let runs = []; // flattened across targets; each carries attributes incl target + live + invalidated
let metricList = [];
let chartDecl = null;
let chartMode = "TIME";
let chart = null;
let chartDrawn = false;

async function init() {
  const key = keyFromPath();
  try {
    const doc = await fetchJson(API + "/api/v1/benchmarks?filter[key]=" + encodeURIComponent(key));
    benchmark = doc.data[0];
  } catch (err) {
    el("bm-name").textContent = "Error";
    el("load-status").className = "status error";
    el("load-status").textContent = "Failed to load benchmark: " + err.message;
    return;
  }
  if (!benchmark) {
    el("bm-name").textContent = "Benchmark not found";
    el("load-status").textContent = "No published benchmark with key “" + key + "”.";
    return;
  }

  const a = benchmark.attributes;
  document.title = a.name + " — smplmark";

  try {
    publisher = (await fetchJson(API + "/api/v1/accounts/" + encodeURIComponent(a.account))).data;
  } catch (_) {
    publisher = null;
  }
  try {
    targets = (await fetchJson(API + "/api/v1/targets?filter[benchmark]=" + encodeURIComponent(benchmark.id))).data;
  } catch (_) {
    targets = [];
  }
  // Runs (for live + invalidation surfacing). Best-effort per target.
  runs = [];
  for (const t of targets) {
    try {
      const rs = (await fetchJson(API + "/api/v1/runs?filter[target]=" + encodeURIComponent(t.id))).data;
      for (const r of rs) runs.push({ ...r, targetId: t.id });
    } catch (_) {}
  }

  const schema = a.sample_schema || { metrics: [], derived: [] };
  metricList = [...(schema.metrics || []), ...(schema.derived || [])];
  chartDecl = schema.chart || inferChart(metricList);
  chartMode = chartDecl ? chartDecl.x_kind || inferKind(chartDecl.x) : "TIME";

  renderHead();
  renderBanners();
  renderOverview();
  renderMethodology();
  renderPublisher();
  setupTabs();
  setupChartControls();

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
    (a.status === "WITHDRAWN" ? ' <span class="pill withdrawn">withdrawn</span>' : "");
  el("bm-tagline").textContent = a.description || "";
  // Byline comes from the frozen published_as snapshot, never a live account lookup.
  const pa = a.published_as;
  if (pa) {
    el("bm-byline").innerHTML = "Published by " + attributionMarkup(pa, "#publisher");
    const link = el("byline-link");
    if (link) link.addEventListener("click", (e) => { e.preventDefault(); activateTab("publisher"); });
    wireBadgeImages(el("bm-byline"));
  } else {
    el("bm-byline").textContent = "";
  }
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
  box.innerHTML = html;
}

function renderOverview() {
  el("overview-about").innerHTML = paragraphs(benchmark.attributes.about || benchmark.attributes.description);
  el("overview-metrics").innerHTML = metricList.length
    ? metricList
        .map((m) => {
          const unit = m.unit ? ` <span class="unit">${esc(m.unit)}</span>` : "";
          const desc = m.description ? `<div class="desc">${esc(m.description)}</div>` : "";
          return `<div class="metric"><div class="name">${esc(m.name)}${unit}</div>${desc}</div>`;
        })
        .join("")
    : '<p class="muted">This benchmark declares no metrics.</p>';
}

function renderMethodology() {
  el("methodology-body").innerHTML = paragraphs(benchmark.attributes.methodology);
}

function renderPublisher() {
  const box = el("publisher-body");
  const pa = benchmark.attributes.published_as;
  let html = "";
  // Lead with the frozen attribution so the tab is self-consistent even if the live account lookup
  // failed. The account fetch below only adds optional extra detail.
  if (pa) {
    const kindLabel = pa.kind === "ORGANIZATION" ? "Organization" : "Individual";
    html += '<div class="publisher-badge">' + attributionMarkup(pa) + '<span class="publisher-kind">' + kindLabel + "</span></div>";
    if (pa.kind === "ORGANIZATION" && Array.isArray(pa.verified_domains) && pa.verified_domains.length) {
      html += '<p class="since">Verified domain' + (pa.verified_domains.length > 1 ? "s" : "") + ": " + pa.verified_domains.map(esc).join(", ") + "</p>";
    }
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

// ── Tabs ──
function activateTab(name) {
  for (const t of document.querySelectorAll(".tab")) t.classList.toggle("active", t.dataset.tab === name);
  for (const p of document.querySelectorAll(".tab-panel")) p.classList.toggle("active", p.dataset.panel === name);
  if (name === "data" && !chartDrawn) drawChart();
}
function setupTabs() {
  for (const t of document.querySelectorAll(".tab")) t.addEventListener("click", () => activateTab(t.dataset.tab));
  window.addEventListener("resize", () => {
    if (chart) chart.setSize({ width: el("chart").clientWidth || 900, height: 420 });
  });
}

// ── Chart ──
function currentY() {
  const sel = el("metric");
  if (sel && sel.value) return sel.value;
  return chartDecl ? chartDecl.y : metricList.length ? metricList[0].name : null;
}
function currentRange() {
  const secs = RANGE_SECONDS[el("range") ? el("range").value : "all"];
  if (!secs) return null; // all time → no filter
  const now = Date.now();
  return "[" + new Date(now - secs * 1000).toISOString() + "," + new Date(now).toISOString() + ")";
}

function observationsUrl(targetId, range) {
  let url = API + "/api/v1/observations?filter[target]=" + encodeURIComponent(targetId) + "&page[size]=1000";
  if (range) url += "&filter[created_at]=" + encodeURIComponent(range);
  return url;
}
async function fetchObservations(targetId, range) {
  const res = await fetch(observationsUrl(targetId, range), { headers: { Accept: "application/vnd.api+json" } });
  if (!res.ok) throw new Error(await errorDetail(res));
  return (await res.json()).data;
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
  destroyChart();
  chart = new uPlot(opts, data, el("chart"));
}

function renderBars(seriesTargets, perTargetPoints, yKey) {
  // CATEGORY: reduce each target's observations to a single value (mean of y).
  destroyChart();
  const rows = seriesTargets.map((t, i) => {
    const pts = perTargetPoints[i];
    const mean = pts.length ? pts.reduce((s, p) => s + p.y, 0) / pts.length : null;
    return { name: t.attributes.name, value: mean };
  });
  const max = Math.max(1, ...rows.map((r) => (r.value == null ? 0 : Math.abs(r.value))));
  if (!rows.some((r) => r.value != null)) { el("empty").hidden = false; return; }
  el("empty").hidden = true;
  const unit = metricUnit(yKey);
  el("chart").innerHTML =
    '<div class="bars">' +
    rows
      .map((r, i) => {
        const w = r.value == null ? 0 : Math.round((Math.abs(r.value) / max) * 100);
        const val = r.value == null ? "—" : r.value.toFixed(1) + (unit ? " " + unit : "");
        return (
          '<div class="bar-row"><div class="bar-label">' + esc(r.name) + "</div>" +
          '<div class="bar-track"><div class="bar-fill" style="width:' + w + "%;background:" + COLORS[i % COLORS.length] + '"></div></div>' +
          '<div class="bar-value">' + esc(val) + "</div></div>"
        );
      })
      .join("") +
    "</div>";
}

async function drawChart() {
  chartDrawn = true;
  const yKey = currentY();
  const selected = el("target").value;
  const range = chartMode === "TIME" ? currentRange() : null;
  el("json").href = observationsUrl(selected || (targets[0] && targets[0].id) || "", range);

  if (!yKey) {
    el("chart-status").textContent = "This benchmark has no numeric metric to plot.";
    return;
  }
  const seriesTargets = selected ? targets.filter((t) => t.id === selected) : targets;
  if (!seriesTargets.length) { el("chart-status").textContent = "No targets to plot."; return; }
  el("chart-status").className = "status";
  el("chart-status").textContent = "Loading…";
  try {
    const raw = await Promise.all(seriesTargets.map((t) => fetchObservations(t.id, range)));
    const xKey = chartMode === "NUMBER" ? chartDecl.x : "created_at";
    const perTargetPoints = raw.map((list) => pointsFor(list, yKey, xKey));
    if (chartMode === "CATEGORY") renderBars(seriesTargets, perTargetPoints, yKey);
    else renderXY(seriesTargets, perTargetPoints, yKey, chartMode === "TIME");
    const total = perTargetPoints.reduce((n, pts) => n + pts.length, 0);
    el("chart-status").textContent =
      total + " observations · " + seriesTargets.length + " target(s) · metric “" + yKey + "” · " + chartMode.toLowerCase() + " chart.";
  } catch (err) {
    destroyChart();
    el("chart-status").className = "status error";
    el("chart-status").textContent = "Failed to load observations: " + err.message;
  }
}

async function downloadCsv() {
  const selected = el("target").value;
  const range = chartMode === "TIME" ? currentRange() : null;
  const tid = selected || (targets[0] && targets[0].id);
  if (!tid) return;
  try {
    const res = await fetch(observationsUrl(tid, range), { headers: { Accept: "text/csv" } });
    if (!res.ok) throw new Error(await errorDetail(res));
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = benchmark.attributes.key + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    el("chart-status").className = "status error";
    el("chart-status").textContent = "CSV download failed: " + err.message;
  }
}

function setupChartControls() {
  const targetSel = el("target");
  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = "All targets";
  targetSel.appendChild(optAll);
  for (const t of targets) {
    const o = document.createElement("option");
    o.value = t.id;
    o.textContent = t.attributes.name;
    targetSel.appendChild(o);
  }

  if (metricList.length > 1) {
    const field = el("metric-field");
    const metricSel = el("metric");
    for (const m of metricList) {
      const o = document.createElement("option");
      o.value = m.name;
      o.textContent = m.name;
      if (chartDecl && m.name === chartDecl.y) o.selected = true;
      metricSel.appendChild(o);
    }
    field.hidden = false;
    metricSel.addEventListener("change", drawChart);
  }

  // Range only applies to time-series charts.
  if (chartMode !== "TIME" && el("range-field")) el("range-field").hidden = true;

  targetSel.addEventListener("change", drawChart);
  if (el("range")) el("range").addEventListener("change", drawChart);
  el("csv").addEventListener("click", downloadCsv);
}

init();
