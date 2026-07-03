import { Hono } from "hono";
import { APEX_HOST, APP_HOST, WWW_HOST, appUrl } from "./config";
import { NotFoundError } from "./errors";
import { errorResponse } from "./http/jsonapi";
import type { AppBindings } from "./http/middleware";
import { buildOpenApiDocument } from "./openapi/spec";
import { scalarHtml } from "./openapi/scalar";
import { accounts } from "./routes/accounts";
import { accountUsers } from "./routes/account_users";
import { apiKeys } from "./routes/api_keys";
import { auth } from "./routes/auth";
import { benchmarks } from "./routes/benchmarks";
import { emails } from "./routes/emails";
import { invitations } from "./routes/invitations";
import { observations } from "./routes/observations";
import { publisherDomains } from "./routes/publisher_domains";
import { publisherIdentities } from "./routes/publisher_identities";
import { runs } from "./routes/runs";
import { targets } from "./routes/targets";
import { users } from "./routes/users";

// ── Host partition (production) ──────────────────────────────────────────────
// One Worker, two canonical hosts: the app (console + auth + API) lives on app.smplmark.org; the
// marketing site + published benchmarks live on www.smplmark.org. Requests to the wrong host are
// redirected. Static assets (/css, /js, /img, /vendor, favicons) are shared and served on both hosts
// (no redirect). Non-production hostnames (localhost, *.workers.dev, previews) serve everything.

function isApiPath(p: string): boolean {
  return p === "/api" || p.startsWith("/api/");
}
/** Pages whose canonical home is the app host. */
function isAppPage(p: string): boolean {
  const roots = ["/account", "/login", "/signup", "/auth", "/verify-email", "/accept-invitation"];
  if (p === "/api-reference") return true;
  return roots.some((r) => p === r || p.startsWith(`${r}/`));
}
/** Pages whose canonical home is the www host. */
function isPublicPage(p: string): boolean {
  const roots = ["/about", "/terms", "/privacy", "/benchmarks"];
  if (p === "/") return true;
  return roots.some((r) => p === r || p.startsWith(`${r}/`));
}

export function createApp() {
  const app = new Hono<AppBindings>();

  // Canonical-host routing. `run_worker_first: true` routes every request here first.
  app.use("*", async (c, next) => {
    const url = new URL(c.req.url);
    const host = url.hostname;

    // Apex → www (single canonical marketing host).
    if (host === APEX_HOST) {
      url.protocol = "https:";
      url.hostname = WWW_HOST;
      return c.redirect(url.toString(), 301);
    }

    // Only the two production hosts are partitioned; localhost / previews serve everything.
    if (host === WWW_HOST || host === APP_HOST) {
      const p = url.pathname;
      if (host === WWW_HOST) {
        // The API and the app pages live on the app host.
        if (isApiPath(p)) {
          url.hostname = APP_HOST;
          return c.redirect(url.toString(), 308); // preserve method + body
        }
        if (isAppPage(p)) {
          url.hostname = APP_HOST;
          return c.redirect(url.toString(), 301);
        }
      } else {
        // On the app host, the bare root lands in the console; marketing pages live on www.
        if (p === "/") {
          url.pathname = "/account";
          return c.redirect(url.toString(), 302);
        }
        if (isPublicPage(p)) {
          url.hostname = WWW_HOST;
          return c.redirect(url.toString(), 301);
        }
      }
    }

    await next();
  });

  // ── API (JSON:API, /api/v1) ──
  app.route("/api/v1/auth", auth);
  app.route("/api/v1/users", users);
  app.route("/api/v1/accounts", accounts);
  app.route("/api/v1/account_users", accountUsers);
  app.route("/api/v1/invitations", invitations);
  app.route("/api/v1/emails", emails);
  app.route("/api/v1/api_keys", apiKeys);
  app.route("/api/v1/benchmarks", benchmarks);
  app.route("/api/v1/targets", targets);
  app.route("/api/v1/runs", runs);
  app.route("/api/v1/observations", observations);
  app.route("/api/v1/publisher_identities", publisherIdentities);
  app.route("/api/v1/publisher_domains", publisherDomains);

  // ── Docs (ADR-008): un-versioned generated spec + Scalar reference page ──
  app.get("/api/openapi.json", (c) =>
    c.json(buildOpenApiDocument(appUrl(c.env, c.req.url))),
  );
  app.get("/api-reference", (c) => c.html(scalarHtml("/api/openapi.json")));

  // Any thrown AppError (and unexpected errors) render as a JSON:API error document.
  app.onError((err) => errorResponse(err));

  // Data-driven benchmark page: every /benchmarks/{key} serves the same shell (www host).
  app.get("/benchmarks/:key", (c) => {
    const url = new URL(c.req.url);
    url.pathname = "/benchmark.html";
    return c.env.ASSETS.fetch(new Request(url, { method: "GET", headers: c.req.raw.headers }));
  });

  // An unmatched API route is a JSON:API 404 (not the HTML 404 page).
  app.all("/api/*", () => errorResponse(new NotFoundError("No such endpoint.")));

  // Everything else falls through to Static Assets.
  app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

  return app;
}
