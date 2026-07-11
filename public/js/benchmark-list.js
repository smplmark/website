"use strict";

// Populates a #benchmark-grid with published benchmarks from the API. Fully data-driven:
// each card links to /benchmarks/{publisher}/{key}. Used by the home page and the /benchmarks list.
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

function apiFetchHint() {
  const h = location.hostname;
  return h === "localhost" || h === "127.0.0.1"
    ? " Is the app Worker running? Start it with `npm run dev` in the app repo (or the \u201Capi\u201D server in the preview panel) \u2014 it serves the local API on :8788."
    : "";
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

// The home page is a teaser, not the catalog: it shows only the top most-viewed benchmarks and
// sends visitors to /benchmarks (the full, filterable browse) for everything else.
var HOME_TOP_LIMIT = 20;

// Sort menu: newest (most recently published) plus reddit-style popularity windows.
var SORT_OPTIONS = [
  { value: "", label: "Newest" },
  { value: "views_today", label: "Popular today" },
  { value: "views_week", label: "Popular this week" },
  { value: "views_month", label: "Popular this month" },
  { value: "views_year", label: "Popular this year" },
  { value: "views", label: "Popular all time" },
];

function currentFilters() {
  const params = new URLSearchParams(location.search);
  const category = (params.get("category") || "").toUpperCase();
  const sort = (params.get("sort") || "").toLowerCase();
  return {
    category: CATEGORY_LABELS[category] ? category : "",
    tag: (params.get("tag") || "").trim().toLowerCase(),
    q: (params.get("q") || "").trim(),
    sort: SORT_OPTIONS.some((o) => o.value === sort) ? sort : "",
  };
}

// The big search box. Rendered once (never re-rendered on load — that would steal focus while
// typing). On /benchmarks it filters live (debounced); on the home page it sends you to
// /benchmarks?q=… like any search engine box.
function setupSearchBox(filters, filterable) {
  const box = document.getElementById("benchmark-search");
  if (!box || document.getElementById("benchmark-search-input")) return;
  box.innerHTML =
    '<input type="search" id="benchmark-search-input" class="big-search" ' +
    'placeholder="Search benchmarks — try gpu rendering or &quot;llama 3&quot;" ' +
    'value="' + esc(filters.q) + '" autocomplete="off" />';
  const input = document.getElementById("benchmark-search-input");
  if (filterable) {
    let timer = null;
    const apply = () => applyFilters({ ...currentFilters(), q: input.value.trim() });
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(apply, 350);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        clearTimeout(timer);
        apply();
      }
    });
  } else {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && input.value.trim()) {
        location.href = withApi("/benchmarks?q=" + encodeURIComponent(input.value.trim()));
      }
    });
  }
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
  const sortOptions = SORT_OPTIONS.map(
    (o) =>
      '<option value="' + o.value + '"' + (filters.sort === o.value ? " selected" : "") + ">" +
      esc(o.label) + "</option>",
  );
  box.innerHTML =
    '<div class="field"><label for="category-filter">Category</label>' +
    '<select id="category-filter">' + options.join("") + "</select></div>" +
    '<div class="field"><label for="sort-filter">Sort</label>' +
    '<select id="sort-filter">' + sortOptions.join("") + "</select></div>" +
    (filters.tag
      ? '<span class="active-tag">tag: <strong>' + esc(filters.tag) +
        '</strong> <button id="clear-tag" class="clear-tag" title="Clear tag filter" aria-label="Clear tag filter">×</button></span>'
      : "");

  document.getElementById("category-filter").addEventListener("change", (e) => {
    applyFilters({ ...filters, category: e.target.value });
  });
  document.getElementById("sort-filter").addEventListener("change", (e) => {
    applyFilters({ ...filters, sort: e.target.value });
  });
  const clear = document.getElementById("clear-tag");
  if (clear) clear.addEventListener("click", () => applyFilters({ ...filters, tag: "" }));
}

function applyFilters(filters) {
  const params = new URLSearchParams(location.search);
  for (const [key, value] of [
    ["category", filters.category],
    ["tag", filters.tag],
    ["q", filters.q],
    ["sort", filters.sort],
  ]) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const qs = params.toString();
  history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
  load();
}

// The tag rail: every tag in the current result set with its benchmark count, one click to
// filter. On the home page (not filterable) a click goes to /benchmarks?tag=….
function renderTagRail(resources, filters, filterable) {
  const rail = document.getElementById("tag-rail");
  if (!rail) return;
  const counts = new Map();
  for (const b of resources) {
    for (const t of Array.isArray(b.attributes.tags) ? b.attributes.tags : []) {
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  const tags = [...counts.entries()].sort((a, z) => z[1] - a[1] || (a[0] < z[0] ? -1 : 1));
  if (!tags.length && !filters.tag) {
    rail.innerHTML = "";
    return;
  }
  rail.innerHTML =
    '<h3 class="rail-title">Tags</h3><ul class="tag-list">' +
    tags
      .map(([tag, count]) => {
        const active = filters.tag === tag;
        return (
          '<li><a href="' + esc(withApi("/benchmarks?tag=" + encodeURIComponent(tag))) +
          '" class="tag-link' + (active ? " active" : "") + '" data-tag="' + esc(tag) + '">' +
          '<span class="tag-name">' + esc(tag) + "</span>" +
          '<span class="tag-count">' + count + "</span></a></li>"
        );
      })
      .join("") +
    "</ul>" +
    (filters.tag && !counts.has(filters.tag)
      ? '<p class="rail-note">Filtered by <strong>' + esc(filters.tag) + "</strong> — no matches.</p>"
      : "");
  if (filterable) {
    rail.querySelectorAll("a.tag-link").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const tag = a.dataset.tag;
        applyFilters({ ...currentFilters(), tag: filters.tag === tag ? "" : tag });
      });
    });
  }
}

async function load() {
  const grid = document.getElementById("benchmark-grid");
  const status = document.getElementById("status");
  if (!grid) return;
  // Filters apply only on the page that renders the filter bar (the /benchmarks list); the home
  // page still gets the search box (it redirects to /benchmarks).
  const filterable = !!document.getElementById("benchmark-filters");
  const filters = filterable
    ? currentFilters()
    : { category: "", tag: "", q: "", sort: "" };
  setupSearchBox(filters, filterable);
  if (filterable) renderFilterBar(filters);

  const base = apiBase() + "/api/v1/benchmarks";
  const qs = new URLSearchParams();
  if (filters.category) qs.set("filter[category]", filters.category);
  if (filters.tag) qs.set("filter[tag]", filters.tag);
  if (filters.q) qs.set("filter[search]", filters.q);
  // Home page: cap at the top most-viewed benchmarks.
  if (!filterable) qs.set("page[size]", String(HOME_TOP_LIMIT));

  // The home teaser defaults to most-viewed (all time); the filterable /benchmarks list defaults to
  // "Newest" (most recently published). An API version that predates a default sort 400s it, so fall
  // back to -created_at (also newest-first) to stay functional across a website/app deploy skew. An
  // explicit user sort is used as-is (no fallback).
  const defaultSort = filterable ? "published_at" : "views";
  const desiredSort = "-" + (filters.sort || defaultSort);
  function urlWith(sort) {
    const p = new URLSearchParams(qs);
    p.set("sort", sort);
    return base + "?" + p.toString();
  }

  if (status) {
    status.className = "status";
    status.textContent = "Loading…";
  }
  try {
    let res = await fetch(urlWith(desiredSort), { headers: { Accept: "application/vnd.api+json" } });
    if (!res.ok && !filters.sort && res.status === 400) {
      res = await fetch(urlWith("-created_at"), { headers: { Accept: "application/vnd.api+json" } });
    }
    if (!res.ok) throw new Error("HTTP " + res.status);
    const doc = await res.json();

    if (!doc.data.length) {
      renderTagRail(doc.data, filters, filterable);
      grid.innerHTML = "";
      if (status) {
        status.textContent =
          filters.q
            ? "No benchmarks match \u201C" + filters.q + "\u201D."
            : filters.category || filters.tag
              ? "No published benchmarks match this filter."
              : "No published benchmarks yet.";
      }
      return;
    }
    if (status) status.textContent = "";

    renderTagRail(doc.data, filters, filterable);

    grid.innerHTML = doc.data
      .map((b) => {
        const a = b.attributes;
        // Everything a visitor can see is published by definition. Most benchmarks are closed
        // (frozen datasets), so we badge the exception: a "live" pill on ones still accepting data.
        // WITHDRAWN takes precedence (a withdrawn benchmark is never "live").
        const pill =
          a.status === "WITHDRAWN"
            ? ' <span class="pill withdrawn">withdrawn</span>'
            : !a.closed
              ? ' <span class="pill live">live</span>'
              : "";
        return `
          <a class="card" href="${esc(withApi("/benchmarks/" + encodeURIComponent(a.publisher_slug) + "/" + encodeURIComponent(a.key)))}">
            <h3>${esc(a.name)}${pill}</h3>
            <p>${esc(a.description || "")}</p>
            ${cardChips(a)}
            ${cardSource(a)}
            <div class="meta">${esc(metricNames(a.observation_schema))}</div>
          </a>`;
      })
      .join("");
  } catch (err) {
    if (status) {
      status.className = "status error";
      status.textContent = "Failed to load benchmarks: " + err.message + "." + apiFetchHint();
    }
  }
}

load();
