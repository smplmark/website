import { Hono } from "hono";
import { appUrl } from "./config";
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
import { observations } from "./routes/observations";
import { runs } from "./routes/runs";
import { targets } from "./routes/targets";
import { users } from "./routes/users";

export function createApp() {
  const app = new Hono<AppBindings>();

  // Canonical host: 301 the apex to www. `run_worker_first: true` routes every request here.
  app.use("*", async (c, next) => {
    const url = new URL(c.req.url);
    if (url.hostname === "smplmark.org") {
      url.protocol = "https:";
      url.hostname = "www.smplmark.org";
      return c.redirect(url.toString(), 301);
    }
    await next();
  });

  // ── API (JSON:API, /api/v1) ──
  app.route("/api/v1/auth", auth);
  app.route("/api/v1/users", users);
  app.route("/api/v1/accounts", accounts);
  app.route("/api/v1/account_users", accountUsers);
  app.route("/api/v1/api_keys", apiKeys);
  app.route("/api/v1/benchmarks", benchmarks);
  app.route("/api/v1/targets", targets);
  app.route("/api/v1/runs", runs);
  app.route("/api/v1/observations", observations);

  // ── Docs (ADR-008): un-versioned generated spec + Scalar reference page ──
  app.get("/api/openapi.json", (c) =>
    c.json(buildOpenApiDocument(appUrl(c.env, c.req.url))),
  );
  app.get("/api-reference", (c) => c.html(scalarHtml("/api/openapi.json")));

  // Any thrown AppError (and unexpected errors) render as a JSON:API error document.
  app.onError((err) => errorResponse(err));

  // Data-driven benchmark page: every /benchmarks/{key} serves the same shell.
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
