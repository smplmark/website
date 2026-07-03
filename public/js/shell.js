"use strict";

/* shell.js — renders the logged-in chrome (collapsible sidebar + top bar) for
   every /account/* console page and wires the shared interactions. Mirrors the
   smplkit app shell. Depends on api.js (requireAuth/apiFetch/authFetch/esc/
   clearToken/decodeJwt).

   A page opts in by providing this skeleton in its <body>:

     <div class="appShell">
       <aside class="sidebar" id="sm-sidebar"></aside>
       <div class="appMain">
         <header class="topBar" id="sm-topbar"></header>
         <main class="appContent"> …page content… </main>
       </div>
     </div>

   …and setting `window.SM_PAGE = { active, breadcrumbs }` before this script.
   Page scripts read identity through the `SM.ready` promise. */

(function () {
  const token = requireAuth();
  if (!token) return; // requireAuth() redirected to /login

  const COLLAPSE_KEY = "smplmark.sidebar.collapsed";
  const AUTO_COLLAPSE_WIDTH = 1024;

  const PAGE = window.SM_PAGE || { active: "", breadcrumbs: [] };

  // ── Inline icon set (frameless, stroke=currentColor — mirrors smplkit) ──
  const ICONS = {
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    benchmarks: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    apikeys: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
    chevronLeft: '<path d="M15 18l-6-6 6-6"/>',
    chevronDown: '<polyline points="6 9 12 15 18 9"/>',
    pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  };

  function icon(name, size) {
    const s = size || 20;
    const inner = ICONS[name] || "";
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.75" stroke-linecap="round" ' +
      'stroke-linejoin="round" width="' + s + '" height="' + s + '" aria-hidden="true">' +
      inner + "</svg>"
    );
  }

  // ── Nav model ──
  // API Keys is a top-level item (smplmark has no "Platform" grouping).
  const NAV = [
    { key: "dashboard", label: "Dashboard", href: "/account", icon: "dashboard", exact: true },
    { divider: true },
    { key: "benchmarks", label: "Benchmarks", href: "/account/benchmarks", icon: "benchmarks" },
    { key: "apikeys", label: "API Keys", href: "/account/api-keys", icon: "apikeys" },
  ];

  // ── Avatar (Gravatar with initials fallback; mirrors smplkit) ──
  async function sha256Hex(input) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function initials(name, email) {
    const n = (name || "").trim();
    if (n) {
      const parts = n.split(/\s+/);
      if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      return parts[0].slice(0, 2).toUpperCase();
    }
    const e = (email || "").trim();
    if (e) return (e.split("@")[0] || e).slice(0, 2).toUpperCase();
    return "?";
  }

  // Returns a span.smAvatar element sized to `size`, showing initials, then
  // upgrading to the user's Gravatar if one exists (d=404 → fall back silently).
  function avatar(size, email, name) {
    const el = document.createElement("span");
    el.className = "smAvatar";
    el.style.width = size + "px";
    el.style.height = size + "px";
    el.style.fontSize = Math.max(10, Math.round(size * 0.36)) + "px";
    el.textContent = initials(name, email);
    const lookup = (email || "").trim().toLowerCase();
    if (lookup && crypto.subtle) {
      sha256Hex(lookup).then((hex) => {
        const img = new Image();
        img.alt = "";
        img.onload = () => { el.textContent = ""; el.appendChild(img); };
        img.onerror = () => { /* keep initials */ };
        img.src = "https://www.gravatar.com/avatar/" + hex + "?s=" + size * 2 + "&d=404";
      }).catch(() => { /* keep initials */ });
    }
    return el;
  }

  // ── Build sidebar ──
  function collapsedInitial() {
    let stored = null;
    try { stored = localStorage.getItem(COLLAPSE_KEY); } catch (_e) { /* ignore */ }
    if (stored === "true") return true;
    if (stored === "false") return false;
    return window.matchMedia("(max-width: " + AUTO_COLLAPSE_WIDTH + "px)").matches;
  }

  function renderSidebar(aside, collapsed) {
    const brand = collapsed
      ? '<button class="sidebarLogoCompact" id="sm-expand" type="button" aria-label="Expand sidebar" title="Expand sidebar">' +
        '<img src="/img/favicon-120.png" alt="smplmark" /></button>'
      : '<div class="sidebarBrand"><a class="sidebarLogo" href="/account" aria-label="smplmark home"><picture>' +
        '<source srcset="/img/logo-light.png" media="(prefers-color-scheme: light)" />' +
        '<img src="/img/logo-dark.png" alt="smplmark" /></picture></a></div>' +
        '<button class="sidebarToggle" id="sm-collapse" type="button" aria-label="Collapse sidebar" title="Collapse sidebar">' +
        icon("chevronLeft", 18) + "</button>";

    let nav = "";
    NAV.forEach((item) => {
      if (item.divider) { nav += '<hr class="sidebarDivider" />'; return; }
      const active = item.key === PAGE.active;
      nav +=
        '<a href="' + item.href + '" class="sidebarLink' + (active ? " isActive" : "") + '"' +
        (collapsed ? ' title="' + esc(item.label) + '"' : "") + ">" +
        '<span class="sidebarLinkIcon">' + icon(item.icon, 20) + "</span>" +
        (collapsed ? "" : '<span class="sidebarLinkLabel">' + esc(item.label) + "</span>") +
        "</a>";
    });

    const user =
      '<div class="sidebarUser" id="sm-user">' +
      '<button class="sidebarUserButton" id="sm-user-button" type="button">' +
      '<span class="smAvatar" id="sm-user-avatar" style="width:32px;height:32px;font-size:12px;"></span>' +
      (collapsed ? "" :
        '<span class="sidebarUserInfo"><span class="sidebarUserName" id="sm-user-name">…</span>' +
        '<span class="sidebarUserEmail" id="sm-user-email"></span></span>' +
        '<span class="sidebarUserChevron">' + icon("chevronDown", 14) + "</span>") +
      "</button></div>";

    aside.className = "sidebar" + (collapsed ? " isCollapsed" : "");
    aside.innerHTML =
      '<div class="sidebarHeader">' + brand + "</div>" +
      '<nav class="sidebarNav">' + nav + "</nav>" +
      user;
  }

  // ── Build top bar ──
  function renderTopBar(header) {
    const crumbs = (PAGE.breadcrumbs && PAGE.breadcrumbs.length)
      ? PAGE.breadcrumbs
      : [{ label: "Dashboard" }];
    let list = "";
    crumbs.forEach((c, i) => {
      const last = i === crumbs.length - 1;
      list +=
        '<li class="breadcrumbItem">' +
        (i > 0 ? '<span class="breadcrumbSeparator">/</span>' : "") +
        (last || !c.href
          ? '<span' + (last ? ' class="breadcrumbCurrent"' : "") + ">" + esc(c.label) + "</span>"
          : '<a class="breadcrumbLink" href="' + c.href + '">' + esc(c.label) + "</a>") +
        "</li>";
    });
    header.innerHTML =
      '<nav class="breadcrumbs" aria-label="Breadcrumbs"><ol class="breadcrumbList">' + list + "</ol></nav>" +
      '<div class="topBarActions" id="sm-topbar-actions"></div>';
  }

  // ── Interactions ──
  const aside = document.getElementById("sm-sidebar");
  const header = document.getElementById("sm-topbar");
  let collapsed = collapsedInitial();

  function mount() {
    renderSidebar(aside, collapsed);
    wireSidebar();
    fillUser();
  }

  function setCollapsed(next, persist) {
    collapsed = next;
    if (persist) { try { localStorage.setItem(COLLAPSE_KEY, String(next)); } catch (_e) { /* ignore */ } }
    renderSidebar(aside, collapsed);
    wireSidebar();
    fillUser();
  }

  let userFlyoutOpen = false;
  function wireSidebar() {
    const collapseBtn = document.getElementById("sm-collapse");
    if (collapseBtn) collapseBtn.addEventListener("click", () => setCollapsed(true, true));
    const expandBtn = document.getElementById("sm-expand");
    if (expandBtn) expandBtn.addEventListener("click", () => setCollapsed(false, true));

    const userBtn = document.getElementById("sm-user-button");
    if (userBtn) userBtn.addEventListener("click", (ev) => { ev.stopPropagation(); toggleUserFlyout(); });
  }

  function toggleUserFlyout() {
    if (userFlyoutOpen) { closeUserFlyout(); return; }
    const btn = document.getElementById("sm-user-button");
    const rect = btn.getBoundingClientRect();
    const fly = document.createElement("div");
    fly.className = "userFlyout";
    fly.id = "sm-user-flyout";
    fly.style.bottom = window.innerHeight - rect.top + 4 + "px";
    fly.style.left = rect.left + "px";
    if (!collapsed) fly.style.width = rect.width + "px";
    fly.innerHTML =
      '<a class="flyoutItem" href="/account/profile">Profile</a>' +
      '<hr class="flyoutDivider" />' +
      '<button class="flyoutItem flyoutItemDanger" id="sm-signout" type="button">Sign out</button>';
    document.body.appendChild(fly);
    document.getElementById("sm-signout").addEventListener("click", signOut);
    userFlyoutOpen = true;
    setTimeout(() => document.addEventListener("mousedown", onDocClick), 0);
  }
  function closeUserFlyout() {
    const fly = document.getElementById("sm-user-flyout");
    if (fly) fly.remove();
    userFlyoutOpen = false;
    document.removeEventListener("mousedown", onDocClick);
  }
  function onDocClick(ev) {
    const fly = document.getElementById("sm-user-flyout");
    const btn = document.getElementById("sm-user-button");
    if (fly && !fly.contains(ev.target) && btn && !btn.contains(ev.target)) closeUserFlyout();
  }

  async function signOut() {
    try { await authFetch("/api/v1/auth/logout", undefined, { method: "POST" }); }
    catch (_e) { /* logout failures shouldn't block clearing local state */ }
    clearToken();
    location.href = "/login";
  }

  // ── Identity (fetched once, shared with page scripts via SM.ready) ──
  let resolveReady, rejectReady;
  const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
  let IDENTITY = null;

  async function loadIdentity() {
    const claims = decodeJwt(token);
    let accountId = claims.account_id || null;
    let account = null;
    let user = null;
    try {
      const acctDoc = await apiFetch("/api/v1/accounts/current");
      account = (acctDoc && acctDoc.data) || null;
      if (account && account.id) accountId = account.id;
    } catch (_e) { /* surfaced by page if needed */ }
    try {
      const userDoc = await apiFetch("/api/v1/users/current");
      user = (userDoc && userDoc.data) || null;
    } catch (_e) { /* surfaced by page if needed */ }
    IDENTITY = { account, user, accountId, token };
    return IDENTITY;
  }

  function fillUser() {
    const avatarHost = document.getElementById("sm-user-avatar");
    const nameEl = document.getElementById("sm-user-name");
    const emailEl = document.getElementById("sm-user-email");
    if (!IDENTITY) return;
    const u = (IDENTITY.user && IDENTITY.user.attributes) || {};
    const email = u.email || "";
    const displayName = u.display_name || (email ? email.split("@")[0] : "Account");
    if (avatarHost) {
      const av = avatar(32, email, u.display_name);
      avatarHost.replaceWith(av);
      av.id = "sm-user-avatar";
    }
    if (nameEl) nameEl.textContent = displayName;
    if (emailEl) emailEl.textContent = email;
    const btn = document.getElementById("sm-user-button");
    if (btn) btn.title = displayName + " — " + email;
  }

  // Auto-collapse on crossing the narrow breakpoint (does not persist).
  const mql = window.matchMedia("(max-width: " + AUTO_COLLAPSE_WIDTH + "px)");
  mql.addEventListener("change", (e) => { if (e.matches && !collapsed) setCollapsed(true, false); });

  // ── Public helpers for page scripts ──
  window.SM = {
    ready: ready,
    icon: icon,
    avatar: avatar,
    esc: esc,
    setTopBarAction: function (html) {
      const host = document.getElementById("sm-topbar-actions");
      if (host) host.innerHTML = html || "";
      return host;
    },
    copyText: function (text) {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
      return new Promise((resolve, reject) => {
        try {
          const ta = document.createElement("textarea");
          ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
          document.body.appendChild(ta); ta.select();
          const ok = document.execCommand("copy");
          document.body.removeChild(ta);
          ok ? resolve() : reject(new Error("copy failed"));
        } catch (e) { reject(e); }
      });
    },
    statusPill: function (label, variant) {
      return '<span class="statusPill is-' + esc(String(variant).toLowerCase()) + '">' + esc(label) + "</span>";
    },
  };

  // ── Boot ──
  renderTopBar(header);
  mount();
  loadIdentity().then((id) => { fillUser(); resolveReady(id); }, (err) => { rejectReady(err); });
})();
