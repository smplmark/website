import { createApp } from "./app";

// Worker entry. The Hono app handles /api/* and falls through to Static Assets for everything else.
const app = createApp();

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) =>
    app.fetch(request, env, ctx),
} satisfies ExportedHandler<Env>;
