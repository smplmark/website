"use strict";

// Logic for /login, /signup, and /auth/callback. Each page includes this file;
// behavior is chosen by which elements are present on the page.
// Depends on api.js (getToken/setToken/apiFetch/authFetch/esc).

function showFormError(msg) {
  const box = document.getElementById("form-error");
  if (box) {
    box.textContent = msg || "";
    box.style.display = msg ? "block" : "none";
  }
}

function goDashboard() {
  location.href = "/account";
}

// ── OIDC full-page navigation (NOT fetch) ──
function wireOidcButtons() {
  const g = document.getElementById("oidc-google");
  if (g) {
    g.addEventListener("click", function () {
      location.href = "/api/v1/auth/oidc/google";
    });
  }
  const m = document.getElementById("oidc-microsoft");
  if (m) {
    m.addEventListener("click", function () {
      location.href = "/api/v1/auth/oidc/microsoft";
    });
  }
}

// ── Login page ──
function wireLogin() {
  const form = document.getElementById("login-form");
  if (!form) return;
  form.addEventListener("submit", async function (ev) {
    ev.preventDefault();
    showFormError("");
    const btn = form.querySelector('button[type="submit"]');
    const email = form.email.value.trim();
    const password = form.password.value;
    if (btn) btn.disabled = true;
    try {
      const doc = await authFetch("/api/v1/auth/login", { email, password });
      if (!doc || !doc.token) throw new Error("No session token returned.");
      setToken(doc.token);
      goDashboard();
    } catch (err) {
      showFormError(err.message);
      if (btn) btn.disabled = false;
    }
  });
}

// ── Signup page ──
function wireSignup() {
  const form = document.getElementById("signup-form");
  if (!form) return;
  form.addEventListener("submit", async function (ev) {
    ev.preventDefault();
    showFormError("");
    const btn = form.querySelector('button[type="submit"]');
    const email = form.email.value.trim();
    const password = form.password.value;
    const displayName = form.display_name.value.trim();
    const body = { email, password };
    if (displayName) body.display_name = displayName;
    if (btn) btn.disabled = true;
    try {
      const doc = await authFetch("/api/v1/auth/register", body);
      if (!doc || !doc.token) throw new Error("No session token returned.");
      setToken(doc.token);
      goDashboard();
    } catch (err) {
      showFormError(err.message);
      if (btn) btn.disabled = false;
    }
  });
}

// ── OIDC callback page (/auth/callback) ──
// Provider redirects back to /auth/callback#token=<jwt>&expires_in=<n>.
function handleCallback() {
  const root = document.getElementById("callback-root");
  if (!root) return;
  const hash = (location.hash || "").replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const token = params.get("token");
  if (token) {
    setToken(token);
    location.href = "/account";
  } else {
    location.href = "/login";
  }
}

document.addEventListener("DOMContentLoaded", function () {
  // If already signed in, skip login/signup and go straight to the dashboard.
  if ((document.getElementById("login-form") || document.getElementById("signup-form")) && getToken()) {
    goDashboard();
    return;
  }
  wireOidcButtons();
  wireLogin();
  wireSignup();
  handleCallback();
});
