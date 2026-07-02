"use strict";

// Data-driven benchmark page. Everything shown is pulled from the API for the {key} in the URL;
// only published benchmarks are reachable (the list endpoint returns published only).

const COLORS = ["#4f8cff", "#f78166", "#3fb950", "#d2a8ff", "#ffa657"];
const RANGE_SECONDS = { "24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400 };

const el = (id) => document.getElementById(id);
const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

// Only let http(s) URLs into an href sink; javascript:/data: and unparseable values are dropped.
function safeHttpUrl(u) {
  try {
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch (_) {
    return null;
  }
}

function keyFromPath() {
  const parts = location.pathname.split("/").filter(Boolean); // ["benchmarks", "{key}"]
  return decodeURIComponent(parts[1] || "");
}

async function errorDetail(res) {
  try {
    const doc = await res.json();
    if (doc.errors && doc.errors[0] && doc.errors[0].detail) return doc.errors[0].detail;
  } catch (_) {
    /* noop */
  }
  return "HTTP " + res.status;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/vnd.api+json" } });
  if (!res.ok) throw new Error(await errorDetail(res));
  return res.json();
}

// Split a text block into paragraphs on blank lines.
function paragraphs(text) {
  if (!text) return "<p class=\"muted\">Not provided.</p>";
  return String(text)
    .split(/\n\s*\n/)
    .map((p) => `<p>${esc(p.trim())}</p>`)
    .join("");
}

let benchmark = null;
let publisher = null;
let targets = [];
let metricList = []; // [{name, unit?, description?}]
let chartDrawn = false;
let chart = null;

async function init() {
  const key = keyFromPath();
  try {
    const doc = await fetchJson(
      "/api/v1/benchmarks?filter[key]=" + encodeURIComponent(key),
    );
    benchmark = doc.data[0];
  } catch (err) {
    el("bm-name").textContent = "Error";
    el("load-status").className = "status error";
    el("load-status").textContent = "Failed to load benchmark: " + err.message;
    return;
  }
  if (!benchmark) {
    el("bm-name").textContent = "Benchmark not found";
    el("load-status").textContent =
      "No published benchmark with key “" + key + "”.";
    return;
  }

  const a = benchmark.attributes;
  document.title = a.name + " — smplmark";

  // Publisher + targets (best-effort; the page still renders if these fail).
  try {
    publisher = (await fetchJson("/api/v1/accounts/" + encodeURIComponent(a.account))).data;
  } catch (_) {
    publisher = null;
  }
  try {
    targets = (
      await fetchJson("/api/v1/targets?filter[benchmark]=" + encodeURIComponent(benchmark.id))
    ).data;
  } catch (_) {
    targets = [];
  }

  const schema = a.sample_schema || { metrics: [], derived: [] };
  metricList = [...(schema.metrics || []), ...(schema.derived || [])];

  renderHead();
  renderOverview();
  renderMethodology();
  renderPublisher();
  setupTabs();
  setupChartControls();

  el("tabs-wrap").hidden = false;
}

function renderHead() {
  const a = benchmark.attributes;
  el("bm-name").innerHTML = esc(a.name);
  el("bm-tagline").textContent = a.description || "";
  if (publisher) {
    el("bm-byline").innerHTML =
      'Published by <a href="#publisher" id="byline-link">' +
      esc(publisher.attributes.name) +
      "</a>";
    const link = el("byline-link");
    if (link) link.addEventListener("click", (e) => { e.preventDefault(); activateTab("publisher"); });
  }
}

function renderOverview() {
  el("overview-about").innerHTML = paragraphs(
    benchmark.attributes.about || benchmark.attributes.description,
  );
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
  if (!publisher) {
    box.innerHTML = '<p class="muted">Publisher information is unavailable.</p>';
    return;
  }
  const p = publisher.attributes;
  const since = p.created_at
    ? new Date(p.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long" })
    : null;
  const link = safeHttpUrl(p.url);
  box.innerHTML =
    `<h3>${esc(p.name)}</h3>` +
    (since ? `<p class="since">Publishing on smplmark since ${esc(since)}</p>` : "") +
    (p.description ? `<p>${esc(p.description)}</p>` : "") +
    (link ? `<a class="site" href="${esc(link)}" target="_blank" rel="noopener">${esc(link)}</a>` : "");
}

// ── Tabs ──
function activateTab(name) {
  for (const t of document.querySelectorAll(".tab")) {
    t.classList.toggle("active", t.dataset.tab === name);
  }
  for (const p of document.querySelectorAll(".tab-panel")) {
    p.classList.toggle("active", p.dataset.panel === name);
  }
  if (name === "data" && !chartDrawn) drawChart();
}

function setupTabs() {
  for (const t of document.querySelectorAll(".tab")) {
    t.addEventListener("click", () => activateTab(t.dataset.tab));
  }
  window.addEventListener("resize", () => {
    if (chart) chart.setSize({ width: el("chart").clientWidth || 900, height: 420 });
  });
}

// ── Chart ──
function currentMetric() {
  const sel = el("metric");
  return sel && sel.value ? sel.value : metricList.length ? metricList[0].name : null;
}

function currentRange() {
  const secs = RANGE_SECONDS[el("range").value] || RANGE_SECONDS["24h"];
  const now = Date.now();
  const from = new Date(now - secs * 1000).toISOString();
  const to = new Date(now).toISOString();
  return "[" + from + "," + to + ")";
}

function samplesUrl(range, targetId) {
  const scope = targetId ? "&filter[target]=" + encodeURIComponent(targetId) : "";
  return "/api/v1/samples?filter[created_at]=" + encodeURIComponent(range) + scope + "&page[size]=1000";
}

async function fetchSamples(range, targetId) {
  const res = await fetch(samplesUrl(range, targetId), {
    headers: { Accept: "application/vnd.api+json" },
  });
  if (!res.ok) throw new Error(await errorDetail(res));
  return (await res.json()).data;
}

const AXIS = {
  stroke: "#9aa7b4",
  grid: { stroke: "#2a3140", width: 1 },
  ticks: { stroke: "#2a3140", width: 1 },
};
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

function renderSeries(seriesTargets, perTarget, metric) {
  const xset = new Set();
  perTarget.forEach((list) =>
    list.forEach((s) => xset.add(Math.round(Date.parse(s.attributes.created_at) / 1000))),
  );
  const xs = [...xset].sort((a, b) => a - b);
  if (!xs.length) {
    destroyChart();
    el("empty").hidden = false;
    return;
  }
  el("empty").hidden = true;
  const idx = new Map(xs.map((x, i) => [x, i]));
  const data = [xs];
  perTarget.forEach((list) => {
    const y = new Array(xs.length).fill(null);
    list.forEach((s) => {
      const m = s.attributes.metrics;
      const v = m && typeof m[metric] === "number" ? m[metric] : null;
      y[idx.get(Math.round(Date.parse(s.attributes.created_at) / 1000))] = v;
    });
    data.push(y);
  });
  const unit = (metricList.find((m) => m.name === metric) || {}).unit;
  const opts = {
    width: el("chart").clientWidth || 900,
    height: 420,
    scales: { x: { time: true } },
    series: [
      {},
      ...seriesTargets.map((t, i) => ({
        label: t.attributes.name,
        stroke: COLORS[i % COLORS.length],
        width: 1.5,
        spanGaps: true,
        points: { show: xs.length < 200 },
      })),
    ],
    axes: [
      Object.assign({ values: utcTicks }, AXIS),
      Object.assign({ label: metric + (unit ? " (" + unit + ")" : ""), labelSize: 34 }, AXIS),
    ],
  };
  destroyChart();
  chart = new uPlot(opts, data, el("chart"));
}

async function drawChart() {
  chartDrawn = true;
  const metric = currentMetric();
  const range = currentRange();
  const selected = el("target").value;
  el("json").href = samplesUrl(range, selected);

  if (!metric) {
    el("chart-status").textContent = "This benchmark has no numeric metric to plot.";
    return;
  }
  const seriesTargets = selected ? targets.filter((t) => t.id === selected) : targets;
  el("chart-status").className = "status";
  el("chart-status").textContent = "Loading…";
  try {
    const perTarget = await Promise.all(seriesTargets.map((t) => fetchSamples(range, t.id)));
    const total = perTarget.reduce((n, list) => n + list.length, 0);
    renderSeries(seriesTargets, perTarget, metric);
    el("chart-status").textContent =
      total + " samples · " + seriesTargets.length + " target(s) · metric “" + metric + "”.";
  } catch (err) {
    destroyChart();
    el("chart-status").className = "status error";
    el("chart-status").textContent = "Failed to load samples: " + err.message;
  }
}

async function downloadCsv() {
  const range = currentRange();
  const selected = el("target").value;
  try {
    const res = await fetch(samplesUrl(range, selected), { headers: { Accept: "text/csv" } });
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
  const opt = document.createElement("option");
  opt.value = "";
  opt.textContent = "All targets";
  targetSel.appendChild(opt);
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
      metricSel.appendChild(o);
    }
    field.hidden = false;
    metricSel.addEventListener("change", drawChart);
  }

  targetSel.addEventListener("change", drawChart);
  el("range").addEventListener("change", drawChart);
  el("csv").addEventListener("click", downloadCsv);
}

init();
