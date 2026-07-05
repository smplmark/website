"use strict";

// Populates the /sources table from the app API's external-source catalog — the bookkeeping rows
// the ingestion importer maintains (source, what it publishes, license, when data was last
// retrieved). Same cross-origin conventions as benchmark-list.js: the API lives on the app host,
// with the :8788 local-loop default and the ?api= dev override.

function apiBase() {
  try {
    const override = new URLSearchParams(location.search).get("api");
    if (override) return override.replace(/\/+$/, "");
  } catch (_) {}
  if (window.SM_API_BASE) return String(window.SM_API_BASE).replace(/\/+$/, "");
  const h = location.hostname;
  if (h === "www.smplmark.org" || h === "smplmark.org") return "https://app.smplmark.org";
  if (h === "localhost" || h === "127.0.0.1") return "http://localhost:8788";
  return "";
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}

// Day precision: "last retrieved" is provenance, not telemetry.
function fmtDay(iso) {
  const ms = Date.parse(iso || "");
  return Number.isNaN(ms) ? "—" : new Date(ms).toISOString().slice(0, 10);
}

// Only http(s) URLs become links — API data never gets to smuggle another scheme into an href.
function safeHttpUrl(u) {
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:" ? p.href : null;
  } catch (_) {
    return null;
  }
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch (_) {
    return url;
  }
}

async function load() {
  const box = document.getElementById("source-table");
  const status = document.getElementById("source-status");
  if (!box) return;
  if (status) status.textContent = "Loading…";
  try {
    const res = await fetch(apiBase() + "/api/v1/external_sources", {
      headers: { Accept: "application/vnd.api+json" },
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const doc = await res.json();
    if (!doc.data.length) {
      if (status) status.textContent = "No ingested sources yet.";
      return;
    }
    if (status) status.textContent = "";
    box.innerHTML =
      '<table class="source-table"><thead><tr>' +
      "<th>Source</th><th>Publishes</th><th>License</th>" +
      '<th class="num">Benchmarks</th><th>Retrieved</th>' +
      "</tr></thead><tbody>" +
      doc.data
        .map((s) => {
          const a = s.attributes;
          return (
            "<tr><td>" +
            (safeHttpUrl(a.url)
              ? '<a href="' + esc(safeHttpUrl(a.url)) + '" target="_blank" rel="noopener">' + esc(a.name) + "</a>"
              : esc(a.name)) +
            '<div class="src-host">' + esc(hostOf(a.url)) + "</div></td>" +
            "<td>" + esc(a.description || "") + "</td>" +
            "<td>" +
            (a.license && safeHttpUrl(a.license_url)
              ? '<a href="' + esc(safeHttpUrl(a.license_url)) + '" target="_blank" rel="noopener">' + esc(a.license) + "</a>"
              : esc(a.license || "—")) +
            "</td>" +
            '<td class="num">' + (typeof a.benchmark_count === "number" ? a.benchmark_count : "—") + "</td>" +
            "<td>" + esc(fmtDay(a.retrieved_at)) + "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table>";
  } catch (err) {
    if (status) {
      status.className = "status error";
      const hint =
        location.hostname === "localhost" || location.hostname === "127.0.0.1"
          ? " Is the app Worker running? It serves the local API on :8788."
          : "";
      status.textContent = "Failed to load sources: " + err.message + "." + hint;
    }
  }
}

load();
