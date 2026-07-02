"use strict";

// Scheduler Latency chart: skew_ms over created_at, one line per scheduler (target).
// Reads the public GET /api/v1/samples endpoint; the same endpoint backs CSV + JSON download.

const BENCH_KEY = "scheduler-latency";
const COLORS = ["#4f8cff", "#f78166", "#3fb950", "#d2a8ff", "#ffa657"];

const el = (id) => document.getElementById(id);

// Format a Date as a datetime-local input value in UTC wall-clock (the inputs are labelled UTC).
function toDatetimeLocalUTC(d) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    "-" + p(d.getUTCMonth() + 1) +
    "-" + p(d.getUTCDate()) +
    "T" + p(d.getUTCHours()) +
    ":" + p(d.getUTCMinutes()) +
    ":" + p(d.getUTCSeconds())
  );
}
const targetSel = el("target");
const fromEl = el("from");
const toEl = el("to");
const chartEl = el("chart");
const emptyEl = el("empty");
const statusEl = el("status");
const jsonLink = el("json");

let targets = [];
let chart = null;

function setStatus(msg, isError) {
  statusEl.textContent = msg || "";
  statusEl.className = "status" + (isError ? " error" : "");
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/vnd.api+json" } });
  if (!res.ok) throw new Error(await errorDetail(res));
  return res.json();
}

async function errorDetail(res) {
  try {
    const doc = await res.json();
    if (doc.errors && doc.errors[0] && doc.errors[0].detail) return doc.errors[0].detail;
  } catch (_) {
    /* fall through */
  }
  return "HTTP " + res.status;
}

function buildRange() {
  const from = new Date(fromEl.value + "Z");
  const to = new Date(toEl.value + "Z");
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return null;
  return "[" + from.toISOString() + "," + to.toISOString() + ")";
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
  if (chart) {
    chart.destroy();
    chart = null;
  }
}

function renderChart(seriesTargets, perTarget) {
  const xset = new Set();
  perTarget.forEach((list) =>
    list.forEach((s) => xset.add(Math.round(Date.parse(s.attributes.created_at) / 1000))),
  );
  const xs = [...xset].sort((a, b) => a - b);

  if (!xs.length) {
    destroyChart();
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  const idx = new Map(xs.map((x, i) => [x, i]));
  const data = [xs];
  perTarget.forEach((list) => {
    const y = new Array(xs.length).fill(null);
    list.forEach((s) => {
      const x = Math.round(Date.parse(s.attributes.created_at) / 1000);
      y[idx.get(x)] = s.attributes.metrics ? s.attributes.metrics.skew_ms : null;
    });
    data.push(y);
  });

  const opts = {
    width: chartEl.clientWidth || 900,
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
      Object.assign({ label: "skew (ms)", labelSize: 34 }, AXIS),
    ],
  };

  destroyChart();
  chart = new uPlot(opts, data, chartEl);
}

async function draw() {
  const range = buildRange();
  if (!range) {
    setStatus("Enter a valid From and To date.", true);
    return;
  }

  const selected = targetSel.value;
  const scope = selected ? "&filter[target]=" + encodeURIComponent(selected) : "";
  jsonLink.href = samplesUrl(range, selected);

  const seriesTargets = selected
    ? targets.filter((t) => t.id === selected)
    : targets;

  setStatus("Loading…");
  try {
    const perTarget = await Promise.all(
      seriesTargets.map((t) => fetchSamples(range, t.id)),
    );
    const total = perTarget.reduce((n, list) => n + list.length, 0);
    renderChart(seriesTargets, perTarget);
    setStatus(total + " samples across " + seriesTargets.length + " scheduler(s).");
  } catch (err) {
    destroyChart();
    setStatus("Failed to load samples: " + err.message, true);
  }
}

async function downloadCsv() {
  const range = buildRange();
  if (!range) return;
  const selected = targetSel.value;
  try {
    const res = await fetch(samplesUrl(range, selected), { headers: { Accept: "text/csv" } });
    if (!res.ok) throw new Error(await errorDetail(res));
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "scheduler-latency.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    setStatus("CSV download failed: " + err.message, true);
  }
}

async function init() {
  // Default to the last 24 hours (UTC). Adjust the inputs to view historical/seeded data.
  const now = new Date();
  fromEl.value = toDatetimeLocalUTC(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  toEl.value = toDatetimeLocalUTC(now);

  el("apply").addEventListener("click", draw);
  targetSel.addEventListener("change", draw);
  el("csv").addEventListener("click", downloadCsv);
  window.addEventListener("resize", () => {
    if (chart) chart.setSize({ width: chartEl.clientWidth || 900, height: 420 });
  });

  try {
    const benches = await fetchJson("/api/v1/benchmarks?filter[key]=" + BENCH_KEY);
    const bench = benches.data[0];
    if (bench) {
      const t = await fetchJson("/api/v1/targets?filter[benchmark]=" + bench.id);
      targets = t.data;
      for (const tg of targets) {
        const o = document.createElement("option");
        o.value = tg.id;
        o.textContent = tg.attributes.name;
        targetSel.appendChild(o);
      }
    }
  } catch (err) {
    setStatus("Could not load schedulers: " + err.message, true);
  }

  await draw();
}

init();
