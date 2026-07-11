// Header light/dark switch. A tiny inline snippet in each page's <head> has already applied any
// saved choice to <html data-theme> before first paint (to avoid a flash); this script wires the
// button, persists the choice, and keeps other open tabs in sync. First-time visitors have no saved
// choice, so the page follows their OS preference until they pick a theme here.
//
// The choice is stored in a cookie scoped to the registrable domain (.smplmark.org), so the sibling
// app host (app.smplmark.org — console + the API Reference page) reads the same preference and
// renders in the matching theme. localStorage is kept as a same-origin mirror purely so the `storage`
// event can sync other open tabs of this site. The head snippet reads the cookie first, then it.
(function () {
  "use strict";
  var KEY = "smplmark-theme";
  var root = document.documentElement;

  // The theme actually on screen: an explicit choice if one is set, else the OS preference.
  function resolved() {
    var forced = root.getAttribute("data-theme");
    if (forced === "light" || forced === "dark") return forced;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  // Share across subdomains in production; on localhost (dev) omit the domain so the cookie is scoped
  // to the host and still shared across the website/app dev-server ports (cookies ignore port).
  function persistCookie(theme) {
    var onProd = /(?:^|\.)smplmark\.org$/.test(location.hostname);
    document.cookie =
      KEY + "=" + theme +
      "; path=/; max-age=31536000; samesite=lax" +
      (onProd ? "; domain=.smplmark.org" : "") +
      (location.protocol === "https:" ? "; secure" : "");
  }

  function apply(theme) {
    root.setAttribute("data-theme", theme);
    persistCookie(theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch (e) {
      /* localStorage may be unavailable (private mode) — the cookie still carries the choice. */
    }
  }

  var btn = document.querySelector(".theme-toggle");

  // Reflect the on-screen theme onto the switch's accessible state (on = dark).
  function syncChecked() {
    if (btn) btn.setAttribute("aria-checked", resolved() === "dark" ? "true" : "false");
  }

  if (btn) {
    syncChecked();
    btn.addEventListener("click", function () {
      apply(resolved() === "dark" ? "light" : "dark");
      syncChecked();
    });
  }

  // Keep other open tabs in sync when the choice changes in one of them.
  window.addEventListener("storage", function (e) {
    if (e.key === KEY && (e.newValue === "light" || e.newValue === "dark")) {
      root.setAttribute("data-theme", e.newValue);
      syncChecked();
    }
  });

  // While following the OS preference (no explicit choice), track OS changes for the switch state —
  // the palette itself already follows via the media query; this just keeps aria-checked honest.
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
    if (root.getAttribute("data-theme") === null) syncChecked();
  });
})();
