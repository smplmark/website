"use strict";

// Dashboard logic for /account. Depends on api.js (requireAuth/apiFetch/authFetch/
// jsonapiBody/esc/getToken/clearToken/decodeJwt).

(function () {
  const token = requireAuth();
  if (!token) return; // requireAuth redirects when absent

  let ACCOUNT_ID = null; // resolved from accounts/current (fallback: JWT claim)

  // ── Small DOM helpers ──
  function $(id) {
    return document.getElementById(id);
  }
  function setMsg(el, text, kind) {
    if (!el) return;
    el.textContent = text || "";
    el.className = "row-msg" + (text ? " " + (kind || "") : "");
  }
  function statusPill(status) {
    const s = String(status || "").toUpperCase();
    return '<span class="pill ' + esc(s) + '">' + esc(s) + "</span>";
  }

  // ── Bootstrap ──
  async function init() {
    wireSignout();
    wireCreateBenchmark();
    wireCreateApiKey();
    wireResendVerification();

    try {
      await loadIdentity();
    } catch (err) {
      setMsg($("load-status"), "Failed to load your account: " + err.message, "error");
      return;
    }

    await Promise.all([loadBenchmarks(), loadApiKeys()]);
  }

  // ── Identity: account + user ──
  async function loadIdentity() {
    const claims = decodeJwt(token);
    ACCOUNT_ID = claims.account_id || null;

    const acctDoc = await apiFetch("/api/v1/accounts/current");
    const acct = acctDoc && acctDoc.data;
    if (acct) {
      ACCOUNT_ID = acct.id || ACCOUNT_ID;
      const attrs = acct.attributes || {};
      $("account-name").textContent = attrs.name || "Dashboard";
      $("account-who").textContent = attrs.key ? "@" + attrs.key : "";
    }

    const userDoc = await apiFetch("/api/v1/users/current");
    const user = userDoc && userDoc.data && userDoc.data.attributes;
    if (user) {
      $("account-who").textContent =
        (user.email ? user.email : $("account-who").textContent) || "";
      if (user.verified === false) {
        $("verify-banner").style.display = "flex";
      }
    }
  }

  // ── Benchmarks ──
  async function loadBenchmarks() {
    const body = $("benchmarks-body");
    setMsg($("benchmarks-msg"), "");
    try {
      const doc = await apiFetch(
        "/api/v1/benchmarks?filter[account]=" + encodeURIComponent(ACCOUNT_ID),
      );
      const list = (doc && doc.data) || [];
      if (!list.length) {
        body.innerHTML =
          '<tr><td colspan="4" class="empty-row">No benchmarks yet. Create one below.</td></tr>';
        return;
      }
      body.innerHTML = list.map(benchmarkRow).join("");
      wireBenchmarkRowActions(list);
    } catch (err) {
      body.innerHTML =
        '<tr><td colspan="4" class="empty-row">Failed to load.</td></tr>';
      setMsg($("benchmarks-msg"), err.message, "error");
    }
  }

  function benchmarkRow(b) {
    const a = b.attributes || {};
    const status = String(a.status || "").toUpperCase();
    const id = esc(b.id);
    const key = esc(a.key || "");
    let actions = "";
    if (status === "PRIVATE") {
      actions =
        btn("Publish", "act-publish", id) +
        btn("Manage", "act-manage", id) +
        btn("Delete", "act-delete", id, "danger");
    } else if (status === "PUBLISHED") {
      actions =
        '<a class="btn sm" href="/benchmarks/' +
        encodeURIComponent(a.key || "") +
        '">View</a>' +
        btn("Manage", "act-manage", id) +
        btn("Withdraw", "act-withdraw", id, "danger");
    } else {
      // WITHDRAWN or other
      actions =
        '<a class="btn sm" href="/benchmarks/' +
        encodeURIComponent(a.key || "") +
        '">View</a>' +
        btn("Manage", "act-manage", id);
    }
    return (
      "<tr data-id=\"" + id + "\">" +
      '<td class="key">' + key + "</td>" +
      "<td>" + esc(a.name || "") + "</td>" +
      "<td>" + statusPill(status) + "</td>" +
      '<td class="actions">' + actions + "</td>" +
      "</tr>"
    );
  }

  function btn(label, cls, id, extra) {
    return (
      '<button type="button" class="btn sm ' +
      (extra ? extra + " " : "") +
      cls +
      '" data-id="' + esc(id) + '">' +
      esc(label) +
      "</button>"
    );
  }

  function wireBenchmarkRowActions(list) {
    const byId = {};
    list.forEach((b) => {
      byId[b.id] = b;
    });
    const body = $("benchmarks-body");

    body.querySelectorAll(".act-publish").forEach((el) =>
      el.addEventListener("click", () => doPublish(el.dataset.id)),
    );
    body.querySelectorAll(".act-withdraw").forEach((el) =>
      el.addEventListener("click", () => doWithdraw(el.dataset.id)),
    );
    body.querySelectorAll(".act-delete").forEach((el) =>
      el.addEventListener("click", () => doDelete(el.dataset.id)),
    );
    body.querySelectorAll(".act-manage").forEach((el) =>
      el.addEventListener("click", () => openManage(byId[el.dataset.id])),
    );
  }

  async function doPublish(id) {
    setMsg($("benchmarks-msg"), "");
    try {
      await apiFetch("/api/v1/benchmarks/" + encodeURIComponent(id) + "/actions/publish", {
        method: "POST",
      });
      await loadBenchmarks();
    } catch (err) {
      setMsg($("benchmarks-msg"), err.message, "error");
    }
  }

  async function doWithdraw(id) {
    const reason = window.prompt("Reason for withdrawal (required):", "");
    if (reason === null) return;
    if (!reason.trim()) {
      setMsg($("benchmarks-msg"), "A withdrawal reason is required.", "error");
      return;
    }
    setMsg($("benchmarks-msg"), "");
    try {
      await apiFetch(
        "/api/v1/benchmarks/" + encodeURIComponent(id) + "/actions/withdraw",
        {
          method: "POST",
          body: jsonapiBody("benchmark", { withdrawal_reason: reason.trim() }),
        },
      );
      await loadBenchmarks();
    } catch (err) {
      setMsg($("benchmarks-msg"), err.message, "error");
    }
  }

  async function doDelete(id) {
    if (!window.confirm("Delete this benchmark? This cannot be undone.")) return;
    setMsg($("benchmarks-msg"), "");
    try {
      await apiFetch("/api/v1/benchmarks/" + encodeURIComponent(id), {
        method: "DELETE",
      });
      // close manage panel if it was showing this benchmark
      const mp = $("manage-panel");
      if (mp && mp.dataset.id === id) mp.innerHTML = "";
      await loadBenchmarks();
    } catch (err) {
      setMsg($("benchmarks-msg"), err.message, "error");
    }
  }

  function wireCreateBenchmark() {
    const form = $("create-benchmark-form");
    if (!form) return;
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      setMsg($("create-benchmark-msg"), "");
      const attrs = {
        key: form.key.value.trim(),
        name: form.name.value.trim(),
      };
      const desc = form.description.value.trim();
      if (desc) attrs.description = desc;
      const submit = form.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        await apiFetch("/api/v1/benchmarks", {
          method: "POST",
          body: jsonapiBody("benchmark", attrs),
        });
        form.reset();
        await loadBenchmarks();
        setMsg($("create-benchmark-msg"), "Benchmark created.", "ok");
      } catch (err) {
        setMsg($("create-benchmark-msg"), err.message, "error");
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }

  // ── Manage panel: targets + runs ──
  function openManage(b) {
    if (!b) return;
    const a = b.attributes || {};
    const mp = $("manage-panel");
    mp.dataset.id = b.id;
    mp.innerHTML =
      '<div class="panel">' +
      '<div class="section-head">' +
      "<h3 style=\"margin:0;font-size:18px;\">Manage: " + esc(a.name || a.key || "") + "</h3>" +
      '<button type="button" class="btn sm" id="manage-close">Close</button>' +
      "</div>" +
      '<div class="manage-body">' +
      "<h4>Targets</h4>" +
      '<div id="targets-host"></div>' +
      '<form id="create-target-form" class="inline-form" style="margin-top:12px;">' +
      '<div class="form-row"><label>Key</label><input name="key" type="text" placeholder="target-key" required /></div>' +
      '<div class="form-row"><label>Name</label><input name="name" type="text" placeholder="Target name" required /></div>' +
      '<div class="form-row"><label>Details <span class="muted">(optional)</span></label><input name="details" type="text" /></div>' +
      '<button type="submit" class="btn primary sm">Add target</button>' +
      "</form>" +
      '<div id="create-target-msg" class="row-msg"></div>' +
      "</div>" +
      "</div>";

    $("manage-close").addEventListener("click", () => {
      mp.innerHTML = "";
      mp.removeAttribute("data-id");
    });

    $("create-target-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      setMsg($("create-target-msg"), "");
      const f = ev.target;
      const attrs = {
        benchmark: b.id,
        key: f.key.value.trim(),
        name: f.name.value.trim(),
      };
      const d = f.details.value.trim();
      if (d) attrs.details = d;
      try {
        await apiFetch("/api/v1/targets", {
          method: "POST",
          body: jsonapiBody("target", attrs),
        });
        f.reset();
        await loadTargets(b.id);
      } catch (err) {
        setMsg($("create-target-msg"), err.message, "error");
      }
    });

    loadTargets(b.id);
  }

  async function loadTargets(benchmarkId) {
    const host = $("targets-host");
    if (!host) return;
    host.innerHTML = '<div class="muted">Loading targets…</div>';
    try {
      const doc = await apiFetch(
        "/api/v1/targets?filter[benchmark]=" + encodeURIComponent(benchmarkId),
      );
      const list = (doc && doc.data) || [];
      if (!list.length) {
        host.innerHTML = '<div class="empty-row">No targets yet.</div>';
        return;
      }
      host.innerHTML = list
        .map((t) => {
          const a = t.attributes || {};
          const id = esc(t.id);
          return (
            '<div class="panel sub" data-target="' + id + '">' +
            '<div class="section-head">' +
            "<div><span class=\"key\">" + esc(a.key || "") + '</span> <span class="muted">' + esc(a.name || "") + "</span></div>" +
            '<button type="button" class="btn sm danger del-target" data-id="' + id + '">Delete</button>' +
            "</div>" +
            '<div class="runs-block">' +
            "<h4>Runs</h4>" +
            '<div class="runs-host" data-target="' + id + '"></div>' +
            '<form class="inline-form create-run-form" data-target="' + id + '" style="margin-top:10px;">' +
            '<div class="form-row"><label>Key</label><input name="key" type="text" placeholder="run-key" required /></div>' +
            '<div class="form-row"><label>Started at <span class="muted">(optional ISO)</span></label><input name="started_at" type="text" placeholder="2026-01-01T00:00:00Z" /></div>' +
            '<button type="submit" class="btn primary sm">Add run</button>' +
            "</form>" +
            '<div class="row-msg run-msg" data-target="' + id + '"></div>' +
            "</div>" +
            "</div>"
          );
        })
        .join("");

      host.querySelectorAll(".del-target").forEach((el) =>
        el.addEventListener("click", () => deleteTarget(el.dataset.id, benchmarkId)),
      );
      host.querySelectorAll(".create-run-form").forEach((form) =>
        form.addEventListener("submit", (ev) => createRun(ev, form.dataset.target)),
      );
      list.forEach((t) => loadRuns(t.id));
    } catch (err) {
      host.innerHTML = '<div class="row-msg error">' + esc(err.message) + "</div>";
    }
  }

  async function deleteTarget(targetId, benchmarkId) {
    if (!window.confirm("Delete this target and its runs?")) return;
    try {
      await apiFetch("/api/v1/targets/" + encodeURIComponent(targetId), {
        method: "DELETE",
      });
      await loadTargets(benchmarkId);
    } catch (err) {
      setMsg($("create-target-msg"), err.message, "error");
    }
  }

  async function createRun(ev, targetId) {
    ev.preventDefault();
    const form = ev.target;
    const msg = document.querySelector('.run-msg[data-target="' + cssEsc(targetId) + '"]');
    setMsg(msg, "");
    const attrs = { target: targetId, key: form.key.value.trim() };
    const startedAt = form.started_at.value.trim();
    if (startedAt) attrs.started_at = startedAt;
    try {
      await apiFetch("/api/v1/runs", {
        method: "POST",
        body: jsonapiBody("run", attrs),
      });
      form.reset();
      await loadRuns(targetId);
    } catch (err) {
      setMsg(msg, err.message, "error");
    }
  }

  async function loadRuns(targetId) {
    const host = document.querySelector('.runs-host[data-target="' + cssEsc(targetId) + '"]');
    if (!host) return;
    host.innerHTML = '<div class="muted">Loading runs…</div>';
    try {
      const doc = await apiFetch(
        "/api/v1/runs?filter[target]=" + encodeURIComponent(targetId),
      );
      const list = (doc && doc.data) || [];
      if (!list.length) {
        host.innerHTML = '<div class="empty-row">No runs yet.</div>';
        return;
      }
      host.innerHTML =
        '<table class="list"><tbody>' +
        list
          .map((r) => {
            const a = r.attributes || {};
            const id = esc(r.id);
            const invalidated = a.invalidated_at || a.invalidation_reason;
            const ended = a.ended_at;
            let state;
            if (invalidated) state = '<span class="pill invalidated">invalidated</span>';
            else if (ended) state = '<span class="pill">ended</span>';
            else state = '<span class="pill live">live</span>';
            let acts = "";
            if (!ended && !invalidated) {
              acts += '<button type="button" class="btn sm run-end" data-id="' + id + '" data-target="' + esc(targetId) + '">End</button>';
            }
            if (!invalidated) {
              acts += '<button type="button" class="btn sm danger run-invalidate" data-id="' + id + '" data-target="' + esc(targetId) + '">Invalidate</button>';
            }
            return (
              "<tr>" +
              '<td class="key">' + esc(a.key || "") + "</td>" +
              "<td>" + state + "</td>" +
              '<td class="actions">' + acts + "</td>" +
              "</tr>"
            );
          })
          .join("") +
        "</tbody></table>";

      host.querySelectorAll(".run-end").forEach((el) =>
        el.addEventListener("click", () => endRun(el.dataset.id, el.dataset.target)),
      );
      host.querySelectorAll(".run-invalidate").forEach((el) =>
        el.addEventListener("click", () => invalidateRun(el.dataset.id, el.dataset.target)),
      );
    } catch (err) {
      host.innerHTML = '<div class="row-msg error">' + esc(err.message) + "</div>";
    }
  }

  async function endRun(runId, targetId) {
    const msg = document.querySelector('.run-msg[data-target="' + cssEsc(targetId) + '"]');
    setMsg(msg, "");
    try {
      await apiFetch("/api/v1/runs/" + encodeURIComponent(runId) + "/actions/end", {
        method: "POST",
      });
      await loadRuns(targetId);
    } catch (err) {
      setMsg(msg, err.message, "error");
    }
  }

  async function invalidateRun(runId, targetId) {
    const reason = window.prompt("Invalidation reason (optional):", "");
    if (reason === null) return;
    const msg = document.querySelector('.run-msg[data-target="' + cssEsc(targetId) + '"]');
    setMsg(msg, "");
    const attrs = {};
    if (reason.trim()) attrs.invalidation_reason = reason.trim();
    try {
      await apiFetch("/api/v1/runs/" + encodeURIComponent(runId) + "/actions/invalidate", {
        method: "POST",
        body: jsonapiBody("run", attrs),
      });
      await loadRuns(targetId);
    } catch (err) {
      setMsg(msg, err.message, "error");
    }
  }

  // ── API keys ──
  async function loadApiKeys() {
    const body = $("apikeys-body");
    setMsg($("apikeys-msg"), "");
    try {
      const doc = await apiFetch("/api/v1/api_keys");
      const list = (doc && doc.data) || [];
      if (!list.length) {
        body.innerHTML =
          '<tr><td colspan="5" class="empty-row">No API keys yet.</td></tr>';
        return;
      }
      body.innerHTML = list.map(apiKeyRow).join("");
      wireApiKeyRowActions();
    } catch (err) {
      body.innerHTML =
        '<tr><td colspan="5" class="empty-row">Failed to load.</td></tr>';
      setMsg($("apikeys-msg"), err.message, "error");
    }
  }

  function apiKeyRow(k) {
    const a = k.attributes || {};
    const id = esc(k.id);
    const scope =
      esc(a.scope_type || "") + (a.scope_ref ? " " + esc(a.scope_ref) : "");
    const state = a.revoked
      ? '<span class="pill revoked">revoked</span>'
      : '<span class="pill live">active</span>';
    let acts = "";
    if (!a.revoked) {
      acts =
        '<button type="button" class="btn sm key-rotate" data-id="' + id + '">Rotate</button>' +
        '<button type="button" class="btn sm danger key-revoke" data-id="' + id + '">Revoke</button>';
    }
    return (
      "<tr>" +
      "<td>" + esc(a.name || "") + "</td>" +
      '<td class="mono">' + esc(a.prefix || "") + "</td>" +
      "<td>" + scope + "</td>" +
      "<td>" + state + "</td>" +
      '<td class="actions">' + acts + "</td>" +
      "</tr>"
    );
  }

  function wireApiKeyRowActions() {
    const body = $("apikeys-body");
    body.querySelectorAll(".key-rotate").forEach((el) =>
      el.addEventListener("click", () => rotateKey(el.dataset.id)),
    );
    body.querySelectorAll(".key-revoke").forEach((el) =>
      el.addEventListener("click", () => revokeKey(el.dataset.id)),
    );
  }

  function wireCreateApiKey() {
    const form = $("create-apikey-form");
    if (!form) return;
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      setMsg($("apikeys-msg"), "");
      const attrs = {
        name: form.name.value.trim(),
        scope_type: form.scope_type.value,
      };
      const ref = form.scope_ref.value.trim();
      if (ref) attrs.scope_ref = ref;
      const submit = form.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        const doc = await apiFetch("/api/v1/api_keys", {
          method: "POST",
          body: jsonapiBody("api_key", attrs),
        });
        form.reset();
        const created = doc && doc.data && doc.data.attributes;
        if (created && created.key) revealKey(created.key, "New API key");
        await loadApiKeys();
      } catch (err) {
        setMsg($("apikeys-msg"), err.message, "error");
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }

  async function rotateKey(id) {
    if (!window.confirm("Rotate this key? The old value stops working immediately.")) return;
    setMsg($("apikeys-msg"), "");
    try {
      const doc = await apiFetch(
        "/api/v1/api_keys/" + encodeURIComponent(id) + "/actions/rotate",
        { method: "POST" },
      );
      const rotated = doc && doc.data && doc.data.attributes;
      if (rotated && rotated.key) revealKey(rotated.key, "Rotated API key");
      await loadApiKeys();
    } catch (err) {
      setMsg($("apikeys-msg"), err.message, "error");
    }
  }

  async function revokeKey(id) {
    if (!window.confirm("Revoke this key? This cannot be undone.")) return;
    setMsg($("apikeys-msg"), "");
    try {
      await apiFetch("/api/v1/api_keys/" + encodeURIComponent(id), {
        method: "DELETE",
      });
      await loadApiKeys();
    } catch (err) {
      setMsg($("apikeys-msg"), err.message, "error");
    }
  }

  // Show a plaintext key ONCE in a copyable highlighted box.
  function revealKey(keyValue, label) {
    const host = $("key-reveal-host");
    if (!host) return;
    host.innerHTML =
      '<div class="key-reveal">' +
      '<p class="warn">' + esc(label) + " — copy it now. You won't see this again.</p>" +
      '<div class="key-value">' +
      "<code id=\"reveal-code\">" + esc(keyValue) + "</code>" +
      '<button type="button" class="btn sm" id="reveal-copy">Copy</button>' +
      '<button type="button" class="btn sm" id="reveal-dismiss">Dismiss</button>' +
      "</div>" +
      "</div>";

    $("reveal-copy").addEventListener("click", () => {
      copyText(keyValue).then(
        () => {
          $("reveal-copy").textContent = "Copied";
        },
        () => {
          $("reveal-copy").textContent = "Copy failed";
        },
      );
    });
    $("reveal-dismiss").addEventListener("click", () => {
      host.innerHTML = "";
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error("copy failed"));
      } catch (e) {
        reject(e);
      }
    });
  }

  // ── Verify email ──
  function wireResendVerification() {
    const btn = $("resend-verification");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      setMsg($("verify-msg"), "");
      btn.disabled = true;
      try {
        await authFetch("/api/v1/auth/resend-verification", undefined, {
          method: "POST",
        });
        setMsg($("verify-msg"), "Verification email sent.", "ok");
      } catch (err) {
        setMsg($("verify-msg"), err.message, "error");
      } finally {
        btn.disabled = false;
      }
    });
  }

  // ── Sign out ──
  function wireSignout() {
    const doSignout = async (ev) => {
      if (ev) ev.preventDefault();
      try {
        await authFetch("/api/v1/auth/logout", undefined, { method: "POST" });
      } catch (_e) {
        /* logout failures shouldn't block clearing local state */
      }
      clearToken();
      location.href = "/login";
    };
    const nav = $("nav-signout");
    if (nav) nav.addEventListener("click", doSignout);
    const btn = $("signout-btn");
    if (btn) btn.addEventListener("click", doSignout);
  }

  // Escape a string for use inside a CSS attribute selector value.
  function cssEsc(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/["\\\]]/g, "\\$&");
  }

  init();
})();
