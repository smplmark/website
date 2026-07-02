import { Hono } from "hono";
import { NotFoundError } from "./errors";
import { errorResponse } from "./http/jsonapi";
import type { AppBindings } from "./http/middleware";
import { accounts } from "./routes/accounts";
import { benchmarks } from "./routes/benchmarks";
import { runs } from "./routes/runs";
import { samples } from "./routes/samples";
import { targets } from "./routes/targets";

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

  app.route("/api/v1/accounts", accounts);
  app.route("/api/v1/benchmarks", benchmarks);
  app.route("/api/v1/targets", targets);
  app.route("/api/v1/runs", runs);
  app.route("/api/v1/samples", samples);

  // Any thrown AppError (and unexpected errors) render as a JSON:API error document.
  app.onError((err) => errorResponse(err));

  // Data-driven benchmark page: every /benchmarks/{key} serves the same shell; the client reads
  // the key from the path and fetches the benchmark. Keeps working for thousands of benchmarks.
  app.get("/benchmarks/:key", (c) => {
    const url = new URL(c.req.url);
    url.pathname = "/benchmark.html";
    return c.env.ASSETS.fetch(
      new Request(url, { method: "GET", headers: c.req.raw.headers }),
    );
  });

  // An unmatched API route is a JSON:API 404 (not the HTML 404 page).
  app.all("/api/*", () => errorResponse(new NotFoundError("No such endpoint.")));

  // Everything else falls through to Static Assets.
  app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

  return app;
}
