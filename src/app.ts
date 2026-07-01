import { Hono } from "hono";
import { NotFoundError } from "./errors";
import { errorResponse } from "./http/jsonapi";
import type { AppBindings } from "./http/middleware";
import { benchmarks } from "./routes/benchmarks";
import { runs } from "./routes/runs";
import { samples } from "./routes/samples";
import { targets } from "./routes/targets";

export function createApp() {
  const app = new Hono<AppBindings>();

  app.route("/api/v1/benchmarks", benchmarks);
  app.route("/api/v1/targets", targets);
  app.route("/api/v1/runs", runs);
  app.route("/api/v1/samples", samples);

  // Any thrown AppError (and unexpected errors) render as a JSON:API error document.
  app.onError((err) => errorResponse(err));

  // An unmatched API route is a JSON:API 404 (not the HTML 404 page).
  app.all("/api/*", () => errorResponse(new NotFoundError("No such endpoint.")));

  // Non-API paths fall through to Static Assets. In production `run_worker_first: ["/api/*"]`
  // means only /api/* reaches the Worker; this is the safety net for anything else.
  app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

  return app;
}
