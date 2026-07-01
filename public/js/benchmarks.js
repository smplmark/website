"use strict";

// Known benchmarks that have a dedicated chart page. Others render a generic API link.
const CHART_PAGES = { "scheduler-latency": "/benchmarks/latency" };

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}

async function load() {
  const list = document.getElementById("list");
  const status = document.getElementById("status");
  try {
    const res = await fetch("/api/v1/benchmarks", {
      headers: { Accept: "application/vnd.api+json" },
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const doc = await res.json();

    if (!doc.data.length) {
      status.textContent = "No published benchmarks yet.";
      return;
    }

    list.innerHTML = doc.data
      .map((b) => {
        const a = b.attributes;
        const href = CHART_PAGES[a.key] || `/api/v1/benchmarks/${b.id}`;
        const derived = (a.sample_schema && a.sample_schema.derived) || [];
        const metrics = (a.sample_schema && a.sample_schema.metrics) || [];
        const names = [...metrics, ...derived].map((m) => m.name).join(", ") || "—";
        return `
          <a class="card" href="${esc(href)}">
            <h3>${esc(a.name)} <span class="pill published">${esc(a.visibility)}</span></h3>
            <p>${esc(a.description || "")}</p>
            <div class="meta">${esc(a.key)} · ${esc(names)}</div>
          </a>`;
      })
      .join("");
  } catch (err) {
    status.className = "status error";
    status.textContent = "Failed to load benchmarks: " + err.message;
  }
}

load();
