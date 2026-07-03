"use strict";

// Populates a #benchmark-grid with published benchmarks from the API. Fully data-driven:
// each card links to /benchmarks/{key}. Used by the home page and the /benchmarks list.
//
// The API lives on the app host (app.smplmark.org), a different origin from this site, so requests
// are cross-origin (the app answers CORS for our origin). Local dev: append ?api=http://localhost:8788
// (or set window.SM_API_BASE) to point the viewer at a locally-running app Worker.

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

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}

function metricNames(schema) {
  const metrics = (schema && schema.metrics) || [];
  const derived = (schema && schema.derived) || [];
  return [...metrics, ...derived].map((m) => m.name).join(" · ") || "—";
}

async function load() {
  const grid = document.getElementById("benchmark-grid");
  const status = document.getElementById("status");
  if (!grid) return;
  try {
    const res = await fetch(apiBase() + "/api/v1/benchmarks", {
      headers: { Accept: "application/vnd.api+json" },
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const doc = await res.json();

    if (!doc.data.length) {
      if (status) status.textContent = "No published benchmarks yet.";
      return;
    }

    grid.innerHTML = doc.data
      .map((b) => {
        const a = b.attributes;
        const cls = a.status === "WITHDRAWN" ? "withdrawn" : "published";
        const label = a.status === "WITHDRAWN" ? "withdrawn" : "published";
        return `
          <a class="card" href="/benchmarks/${encodeURIComponent(a.key)}">
            <h3>${esc(a.name)} <span class="pill ${cls}">${esc(label)}</span></h3>
            <p>${esc(a.description || "")}</p>
            <div class="meta">${esc(metricNames(a.sample_schema))}</div>
          </a>`;
      })
      .join("");
  } catch (err) {
    if (status) {
      status.className = "status error";
      status.textContent = "Failed to load benchmarks: " + err.message;
    }
  }
}

load();
