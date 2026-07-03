"use strict";

// Benchmarks (/account/benchmarks) — list, create, publish/withdraw/delete, and
// the inline manage panel (targets + runs). Depends on api.js + shell.js.

(function () {
  let ACCOUNT_ID = null;
  const esc = SM.esc;

  function $(id) { return document.getElementById(id); }
  function setMsg(el, text, kind) {
    if (!el) return;
    el.textContent = text || "";
    el.className = "form-status" + (text ? " is-" + (kind || "error") : "");
  }
  function cssEsc(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/["\\\]]/g, "\\$&");
  }

  // Top-bar primary action
  SM.setTopBarAction(
    '<button type="button" class="button buttonPrimary buttonTopBar" id="new-benchmark">' +
    SM.icon("plus", 16) + " New benchmark</button>",
  );
  $("new-benchmark").addEventListener("click", openCreateModal);

  // ── Create modal ──
  const modal = $("create-modal");
  function openCreateModal() {
    setMsg($("create-benchmark-msg"), "");
    $("create-benchmark-form").reset();
    modal.style.display = "grid";
    const first = modal.querySelector('input[name="key"]');
    if (first) first.focus();
  }
  function closeCreateModal() { modal.style.display = "none"; }
  $("create-cancel").addEventListener("click", closeCreateModal);
  modal.addEventListener("mousedown", (ev) => { if (ev.target === modal) closeCreateModal(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && modal.style.display !== "none") closeCreateModal(); });

  $("create-benchmark-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    setMsg($("create-benchmark-msg"), "");
    const attrs = { key: form.key.value.trim(), name: form.name.value.trim() };
    const desc = form.description.value.trim();
    if (desc) attrs.description = desc;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await apiFetch("/api/v1/benchmarks", { method: "POST", body: jsonapiBody("benchmark", attrs) });
      closeCreateModal();
      await loadBenchmarks();
    } catch (err) {
      setMsg($("create-benchmark-msg"), err.message, "error");
    } finally {
      submit.disabled = false;
    }
  });

  // ── Boot ──
  SM.ready.then((id) => {
    ACCOUNT_ID = id.accountId;
    loadBenchmarks();
  }).catch(() => {
    $("load-error").innerHTML = '<div class="errorBanner"><p>Failed to load your account.</p></div>';
  });

  // ── Benchmarks list ──
  async function loadBenchmarks() {
    const body = $("benchmarks-body");
    setMsg($("benchmarks-msg"), "");
    try {
      const doc = await apiFetch("/api/v1/benchmarks?filter[account]=" + encodeURIComponent(ACCOUNT_ID));
      const list = (doc && doc.data) || [];
      if (!list.length) {
        body.innerHTML = '<tr><td colspan="4" class="dataTableEmpty">No benchmarks yet. Use “New benchmark” to create one.</td></tr>';
        return;
      }
      body.innerHTML = list.map(benchmarkRow).join("");
      wireRowActions(list);
    } catch (err) {
      body.innerHTML = '<tr><td colspan="4" class="dataTableEmpty">Failed to load.</td></tr>';
      setMsg($("benchmarks-msg"), err.message, "error");
    }
  }

  function benchmarkRow(b) {
    const a = b.attributes || {};
    const status = String(a.status || "").toUpperCase();
    const id = esc(b.id);
    let actions = "";
    if (status === "PRIVATE") {
      actions = btn("Publish", "act-publish", id) + btn("Manage", "act-manage", id) + btn("Delete", "act-delete", id, "danger");
    } else if (status === "PUBLISHED") {
      actions = viewLink(a.key) + btn("Manage", "act-manage", id) + btn("Withdraw", "act-withdraw", id, "danger");
    } else {
      actions = viewLink(a.key) + btn("Manage", "act-manage", id);
    }
    return (
      '<tr data-id="' + id + '">' +
      "<td><code>" + esc(a.key || "") + "</code></td>" +
      "<td>" + esc(a.name || "") + "</td>" +
      "<td>" + SM.statusPill(status, status) + "</td>" +
      '<td class="actions">' + actions + "</td>" +
      "</tr>"
    );
  }
  function viewLink(key) {
    return '<a class="button buttonSecondary buttonSmall" href="/benchmarks/' + encodeURIComponent(key || "") + '">View</a>';
  }
  function btn(label, cls, id, extra) {
    const kind = extra === "danger" ? "buttonDanger" : "buttonSecondary";
    return '<button type="button" class="button ' + kind + ' buttonSmall ' + cls + '" data-id="' + esc(id) + '">' + esc(label) + "</button>";
  }

  function wireRowActions(list) {
    const byId = {};
    list.forEach((b) => { byId[b.id] = b; });
    const body = $("benchmarks-body");
    body.querySelectorAll(".act-publish").forEach((el) => el.addEventListener("click", () => doPublish(el.dataset.id)));
    body.querySelectorAll(".act-withdraw").forEach((el) => el.addEventListener("click", () => doWithdraw(el.dataset.id)));
    body.querySelectorAll(".act-delete").forEach((el) => el.addEventListener("click", () => doDelete(el.dataset.id)));
    body.querySelectorAll(".act-manage").forEach((el) => el.addEventListener("click", () => openManage(byId[el.dataset.id])));
  }

  async function doPublish(id) {
    setMsg($("benchmarks-msg"), "");
    try {
      await apiFetch("/api/v1/benchmarks/" + encodeURIComponent(id) + "/actions/publish", { method: "POST" });
      await loadBenchmarks();
    } catch (err) { setMsg($("benchmarks-msg"), err.message, "error"); }
  }

  async function doWithdraw(id) {
    const reason = window.prompt("Reason for withdrawal (required):", "");
    if (reason === null) return;
    if (!reason.trim()) { setMsg($("benchmarks-msg"), "A withdrawal reason is required.", "error"); return; }
    setMsg($("benchmarks-msg"), "");
    try {
      await apiFetch("/api/v1/benchmarks/" + encodeURIComponent(id) + "/actions/withdraw", {
        method: "POST", body: jsonapiBody("benchmark", { withdrawal_reason: reason.trim() }),
      });
      await loadBenchmarks();
    } catch (err) { setMsg($("benchmarks-msg"), err.message, "error"); }
  }

  async function doDelete(id) {
    if (!window.confirm("Delete this benchmark? This cannot be undone.")) return;
    setMsg($("benchmarks-msg"), "");
    try {
      await apiFetch("/api/v1/benchmarks/" + encodeURIComponent(id), { method: "DELETE" });
      const mp = $("manage-panel");
      if (mp && mp.dataset.id === id) { mp.innerHTML = ""; mp.removeAttribute("data-id"); }
      await loadBenchmarks();
    } catch (err) { setMsg($("benchmarks-msg"), err.message, "error"); }
  }

  // ── Manage panel: targets + runs ──
  function openManage(b) {
    if (!b) return;
    const a = b.attributes || {};
    const mp = $("manage-panel");
    mp.dataset.id = b.id;
    mp.innerHTML =
      '<div class="panel">' +
      '<div class="sectionHead"><h2>Manage: ' + esc(a.name || a.key || "") + "</h2>" +
      '<button type="button" class="button buttonSecondary buttonSmall" id="manage-close">Close</button></div>' +
      '<div class="manageBody">' +
      '<p class="miniLabel">Targets</p>' +
      '<div id="targets-host"></div>' +
      '<form id="create-target-form" class="inlineForm" style="margin-top:0.9rem;">' +
      '<label class="field"><span class="fieldRequired">Key</span><input name="key" type="text" placeholder="target-key" required /></label>' +
      '<label class="field"><span class="fieldRequired">Name</span><input name="name" type="text" placeholder="Target name" required /></label>' +
      '<label class="field"><span>Details</span><input name="details" type="text" placeholder="optional" /></label>' +
      '<button type="submit" class="button buttonPrimary buttonSmall">Add target</button>' +
      "</form>" +
      '<div id="create-target-msg" class="form-status"></div>' +
      "</div></div>";

    $("manage-close").addEventListener("click", () => { mp.innerHTML = ""; mp.removeAttribute("data-id"); });

    $("create-target-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      setMsg($("create-target-msg"), "");
      const f = ev.target;
      const attrs = { benchmark: b.id, key: f.key.value.trim(), name: f.name.value.trim() };
      const d = f.details.value.trim();
      if (d) attrs.details = d;
      try {
        await apiFetch("/api/v1/targets", { method: "POST", body: jsonapiBody("target", attrs) });
        f.reset();
        await loadTargets(b.id);
      } catch (err) { setMsg($("create-target-msg"), err.message, "error"); }
    });

    mp.scrollIntoView({ behavior: "smooth", block: "nearest" });
    loadTargets(b.id);
  }

  async function loadTargets(benchmarkId) {
    const host = $("targets-host");
    if (!host) return;
    host.innerHTML = '<div class="muted">Loading targets…</div>';
    try {
      const doc = await apiFetch("/api/v1/targets?filter[benchmark]=" + encodeURIComponent(benchmarkId));
      const list = (doc && doc.data) || [];
      if (!list.length) { host.innerHTML = '<div class="muted">No targets yet.</div>'; return; }
      host.innerHTML = list.map((t) => {
        const a = t.attributes || {};
        const id = esc(t.id);
        return (
          '<div class="subPanel" style="margin-bottom:0.75rem;" data-target="' + id + '">' +
          '<div class="sectionHead" style="margin-bottom:0.5rem;">' +
          "<div><code>" + esc(a.key || "") + '</code> <span class="muted">' + esc(a.name || "") + "</span></div>" +
          '<button type="button" class="button buttonDanger buttonSmall del-target" data-id="' + id + '">Delete</button>' +
          "</div>" +
          '<div class="runsBlock">' +
          '<p class="miniLabel">Runs</p>' +
          '<div class="runs-host" data-target="' + id + '"></div>' +
          '<form class="inlineForm create-run-form" data-target="' + id + '" style="margin-top:0.6rem;">' +
          '<label class="field"><span class="fieldRequired">Key</span><input name="key" type="text" placeholder="run-key" required /></label>' +
          '<label class="field"><span>Started at</span><input name="started_at" type="text" placeholder="2026-01-01T00:00:00Z" /></label>' +
          '<button type="submit" class="button buttonPrimary buttonSmall">Add run</button>' +
          "</form>" +
          '<div class="form-status run-msg" data-target="' + id + '"></div>' +
          "</div></div>"
        );
      }).join("");

      host.querySelectorAll(".del-target").forEach((el) => el.addEventListener("click", () => deleteTarget(el.dataset.id, benchmarkId)));
      host.querySelectorAll(".create-run-form").forEach((form) => form.addEventListener("submit", (ev) => createRun(ev, form.dataset.target)));
      list.forEach((t) => loadRuns(t.id));
    } catch (err) {
      host.innerHTML = '<div class="form-status is-error">' + esc(err.message) + "</div>";
    }
  }

  async function deleteTarget(targetId, benchmarkId) {
    if (!window.confirm("Delete this target and its runs?")) return;
    try {
      await apiFetch("/api/v1/targets/" + encodeURIComponent(targetId), { method: "DELETE" });
      await loadTargets(benchmarkId);
    } catch (err) { setMsg($("create-target-msg"), err.message, "error"); }
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
      await apiFetch("/api/v1/runs", { method: "POST", body: jsonapiBody("run", attrs) });
      form.reset();
      await loadRuns(targetId);
    } catch (err) { setMsg(msg, err.message, "error"); }
  }

  async function loadRuns(targetId) {
    const host = document.querySelector('.runs-host[data-target="' + cssEsc(targetId) + '"]');
    if (!host) return;
    host.innerHTML = '<div class="muted">Loading runs…</div>';
    try {
      const doc = await apiFetch("/api/v1/runs?filter[target]=" + encodeURIComponent(targetId));
      const list = (doc && doc.data) || [];
      if (!list.length) { host.innerHTML = '<div class="muted">No runs yet.</div>'; return; }
      host.innerHTML =
        '<table class="dataTable"><tbody>' +
        list.map((r) => {
          const a = r.attributes || {};
          const id = esc(r.id);
          const invalidated = a.invalidated || a.invalidated_at || a.invalidation_reason;
          const ended = a.ended_at || a.live === false;
          let state;
          if (invalidated) state = SM.statusPill("invalidated", "invalidated");
          else if (ended) state = SM.statusPill("ended", "ended");
          else state = SM.statusPill("live", "live");
          let acts = "";
          if (!ended && !invalidated) acts += '<button type="button" class="button buttonSecondary buttonSmall run-end" data-id="' + id + '" data-target="' + esc(targetId) + '">End</button>';
          if (!invalidated) acts += '<button type="button" class="button buttonDanger buttonSmall run-invalidate" data-id="' + id + '" data-target="' + esc(targetId) + '">Invalidate</button>';
          return "<tr><td><code>" + esc(a.key || "") + "</code></td><td>" + state + '</td><td class="actions">' + acts + "</td></tr>";
        }).join("") +
        "</tbody></table>";
      host.querySelectorAll(".run-end").forEach((el) => el.addEventListener("click", () => endRun(el.dataset.id, el.dataset.target)));
      host.querySelectorAll(".run-invalidate").forEach((el) => el.addEventListener("click", () => invalidateRun(el.dataset.id, el.dataset.target)));
    } catch (err) {
      host.innerHTML = '<div class="form-status is-error">' + esc(err.message) + "</div>";
    }
  }

  async function endRun(runId, targetId) {
    const msg = document.querySelector('.run-msg[data-target="' + cssEsc(targetId) + '"]');
    setMsg(msg, "");
    try {
      await apiFetch("/api/v1/runs/" + encodeURIComponent(runId) + "/actions/end", { method: "POST" });
      await loadRuns(targetId);
    } catch (err) { setMsg(msg, err.message, "error"); }
  }

  async function invalidateRun(runId, targetId) {
    const reason = window.prompt("Invalidation reason (optional):", "");
    if (reason === null) return;
    const msg = document.querySelector('.run-msg[data-target="' + cssEsc(targetId) + '"]');
    setMsg(msg, "");
    const attrs = {};
    if (reason.trim()) attrs.invalidation_reason = reason.trim();
    try {
      await apiFetch("/api/v1/runs/" + encodeURIComponent(runId) + "/actions/invalidate", { method: "POST", body: jsonapiBody("run", attrs) });
      await loadRuns(targetId);
    } catch (err) { setMsg(msg, err.message, "error"); }
  }
})();
