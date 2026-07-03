import { createApp } from "./app";
import { sweepVerifiedDomains } from "./publish/sweep";

// Worker entry. The Hono app handles /api/* and falls through to Static Assets for everything else.
// The cron trigger (see wrangler.jsonc) re-checks VERIFIED publisher domains and lapses any whose TXT
// record has disappeared — it never touches a published benchmark's frozen attribution snapshot.
const app = createApp();

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) =>
    app.fetch(request, env, ctx),
  scheduled: (_controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(sweepVerifiedDomains(env.DB));
  },
} satisfies ExportedHandler<Env>;
