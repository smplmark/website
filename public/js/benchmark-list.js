"use strict";

// Populates a #benchmark-grid with published benchmarks from the API. Fully data-driven:
// each card links to /benchmarks/{key}. Used by the home page and the /benchmarks list.
//
// On the /benchmarks page (which carries a #benchmark-filters container) the grid is filterable by
// category and tag via the API's filter[category] / filter[tag] params, driven by the ?category=
// and ?tag= URL params so filtered views are shareable links.
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

var CATEGORY_LABELS = {
  HARDWARE: "Hardware",
  DATABASE: "Database",
  ML_AI: "ML & AI",
  STORAGE: "Storage",
  NETWORK: "Network",
  OTHER: "Other",
};

// Chips on a card are plain spans (the whole card is already a link); category first, then up to
// three tags with a "+N" overflow marker.
function cardChips(a) {
  const chips = [];
  if (a.category && a.category !== "OTHER") {
    chips.push('<span class="pill category">' + esc(CATEGORY_LABELS[a.category] || a.category) + "</span>");
  }
  const tags = Array.isArray(a.tags) ? a.tags : [];
  for (const t of tags.slice(0, 3)) chips.push('<span class="pill tag">' + esc(t) + "</span>");
  if (tags.length > 3) chips.push('<span class="pill tag">+' + (tags.length - 3) + "</span>");
  return chips.length ? '<div class="chips">' + chips.join(" ") + "</div>" : "";
}

// Ingested benchmarks carry their source attribution on the card, prominently.
function cardSource(a) {
  const pa = a.published_as;
  if (!pa || pa.kind !== "INGESTED") return "";
  return (
    '<div class="source-line">Source: ' + esc(pa.source_name || "") +
    (pa.license ? " (" + esc(pa.license) + ")" : "") + "</div>"
  );
}

function currentFilters() {
  const params = new URLSearchParams(location.search);
  const category = (params.get("category") || "").toUpperCase();
  return {
    category: CATEGORY_LABELS[category] ? category : "",
    tag: (params.get("tag") || "").trim().toLowerCase(),
  };
}

function renderFilterBar(filters) {
  const box = document.getElementById("benchmark-filters");
  if (!box) return;
  const options = ['<option value="">All categories</option>'];
  for (const key of Object.keys(CATEGORY_LABELS)) {
    options.push(
      '<option value="' + key + '"' + (filters.category === key ? " selected" : "") + ">" +
        esc(CATEGORY_LABELS[key]) + "</option>",
    );
  }
  box.innerHTML =
    '<div class="field"><label for="category-filter">Category</label>' +
    '<select id="category-filter">' + options.join("") + "</select></div>" +
    (filters.tag
      ? '<span class="active-tag">tag: <strong>' + esc(filters.tag) +
        '</strong> <button id="clear-tag" class="clear-tag" title="Clear tag filter" aria-label="Clear tag filter">×</button></span>'
      : "");

  document.getElementById("category-filter").addEventListener("change", (e) => {
    applyFilters({ category: e.target.value, tag: filters.tag });
  });
  const clear = document.getElementById("clear-tag");
  if (clear) clear.addEventListener("click", () => applyFilters({ category: filters.category, tag: "" }));
}

function applyFilters(filters) {
  const params = new URLSearchParams(location.search);
  if (filters.category) params.set("category", filters.category);
  else params.delete("category");
  if (filters.tag) params.set("tag", filters.tag);
  else params.delete("tag");
  const qs = params.toString();
  history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
  load();
}

async function load() {
  const grid = document.getElementById("benchmark-grid");
  const status = document.getElementById("status");
  if (!grid) return;
  // Filters apply only on the page that renders the filter bar (the /benchmarks list).
  const filterable = !!document.getElementById("benchmark-filters");
  const filters = filterable ? currentFilters() : { category: "", tag: "" };
  if (filterable) renderFilterBar(filters);

  let url = apiBase() + "/api/v1/benchmarks";
  const qs = new URLSearchParams();
  if (filters.category) qs.set("filter[category]", filters.category);
  if (filters.tag) qs.set("filter[tag]", filters.tag);
  if ([...qs].length) url += "?" + qs.toString();

  if (status) {
    status.className = "status";
    status.textContent = "Loading…";
  }
  try {
    const res = await fetch(url, { headers: { Accept: "application/vnd.api+json" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const doc = await res.json();

    if (!doc.data.length) {
      grid.innerHTML = "";
      if (status) {
        status.textContent =
          filters.category || filters.tag
            ? "No published benchmarks match this filter."
            : "No published benchmarks yet.";
      }
      return;
    }
    if (status) status.textContent = "";

    grid.innerHTML = doc.data
      .map((b) => {
        const a = b.attributes;
        const cls = a.status === "WITHDRAWN" ? "withdrawn" : "published";
        const label = a.status === "WITHDRAWN" ? "withdrawn" : "published";
        return `
          <a class="card" href="/benchmarks/${encodeURIComponent(a.key)}">
            <h3>${esc(a.name)} <span class="pill ${cls}">${esc(label)}</span></h3>
            <p>${esc(a.description || "")}</p>
            ${cardChips(a)}
            ${cardSource(a)}
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
