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
  if (g) g.addEventListener("click", () => { location.href = "/api/v1/auth/oidc/google"; });
  const m = document.getElementById("oidc-microsoft");
  if (m) m.addEventListener("click", () => { location.href = "/api/v1/auth/oidc/microsoft"; });
}

// ── Password reveal toggles (any .fieldRevealToggle[data-reveal=<inputId>]) ──
function wireRevealToggles() {
  document.querySelectorAll(".fieldRevealToggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.reveal);
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.textContent = show ? "Hide" : "Show";
    });
  });
}

// ── Password strength meter (signup only) ──
function passwordStrength(password) {
  if (!password) return { level: "weak", label: "" };
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  if (score <= 2) return { level: "weak", label: "Weak" };
  if (score <= 4) return { level: "medium", label: "Medium" };
  return { level: "strong", label: "Strong" };
}

function wireStrengthMeter() {
  const wrap = document.getElementById("password-strength");
  const fill = document.getElementById("strength-fill");
  const label = document.getElementById("strength-label");
  const input = document.getElementById("password");
  if (!wrap || !fill || !label || !input) return;
  input.addEventListener("input", () => {
    const pw = input.value;
    if (!pw) { wrap.style.display = "none"; return; }
    wrap.style.display = "flex";
    const s = passwordStrength(pw);
    fill.className = "passwordStrengthFill is-" + s.level;
    label.className = "passwordStrengthLabel is-" + s.level;
    label.textContent = s.label;
  });
}

// ── Login page ──
function wireLogin() {
  const form = document.getElementById("login-form");
  if (!form) return;
  form.addEventListener("submit", async (ev) => {
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
  form.addEventListener("submit", async (ev) => {
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
  wireRevealToggles();
  wireStrengthMeter();
  wireLogin();
  wireSignup();
  handleCallback();
});
