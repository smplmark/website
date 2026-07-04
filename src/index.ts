// smplmark website Worker — the marketing site and the published-benchmark viewer, served on
// www.smplmark.org (the apex redirects here). It holds no API and no database: the viewer reads
// published data from the app's public API (app.smplmark.org) client-side (see public/js/benchmark.js).
//
// Responsibilities:
//   1. Redirect the apex (smplmark.org) to the canonical www host.
//   2. Redirect app pages (/login, /signup, /account, …) and /api/* to the app host — the console +
//      auth + API live there now (the `app` repo). Marketing links to /login etc. resolve this way.
//   3. Serve the data-driven benchmark shell for every /benchmarks/{key}.
//   4. Fall through to static assets (marketing pages, viewer JS/CSS, images) for everything else.

const APEX_HOST = "smplmark.org";
const WWW_HOST = "www.smplmark.org";
const APP_HOST = "app.smplmark.org";

/** /benchmarks/{key} — a single path segment after /benchmarks (not /benchmarks itself, which is the
 *  static index listing). */
function isBenchmarkDetail(pathname: string): boolean {
  return /^\/benchmarks\/[^/]+\/?$/.test(pathname);
}

/** Paths whose canonical home is the app host (console + auth). */
function isAppPage(p: string): boolean {
  const roots = ["/login", "/signup", "/account", "/auth", "/verify-email", "/accept-invitation"];
  if (p === "/api-reference") return true;
  return roots.some((r) => p === r || p.startsWith(`${r}/`));
}

function isApiPath(p: string): boolean {
  return p === "/api" || p.startsWith("/api/");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Domain-verification files (e.g. the Microsoft publisher-domain association) must be reachable at
    // the exact host a verifier requests, so serve /.well-known/* directly — no apex→www redirect.
    if (url.pathname.startsWith("/.well-known/")) {
      return env.ASSETS.fetch(request);
    }

    // Apex → www (single canonical marketing host).
    if (url.hostname === APEX_HOST) {
      url.protocol = "https:";
      url.hostname = WWW_HOST;
      return Response.redirect(url.toString(), 301);
    }

    // App pages + API live on the app host. Redirect there so marketing "Sign in" links (and any
    // stray console/API URL or old bookmark) resolve. /api/* uses 308 to preserve method + body.
    // In the local loop the app host is the local app Worker: DEV_APP_ORIGIN comes from .dev.vars,
    // which wrangler loads only for `wrangler dev` — it does not exist in production. (Hostname
    // sniffing can't work here: wrangler dev presents requests as the configured custom domain.)
    const toAppHost = (u: URL) =>
      env.DEV_APP_ORIGIN
        ? new URL(u.pathname + u.search, env.DEV_APP_ORIGIN).toString()
        : (() => {
            u.protocol = "https:";
            u.hostname = APP_HOST;
            return u.toString();
          })();
    if (isApiPath(url.pathname)) {
      return Response.redirect(toAppHost(url), 308);
    }
    if (isAppPage(url.pathname)) {
      return Response.redirect(toAppHost(url), 301);
    }

    // Data-driven benchmark page: every /benchmarks/{key} serves the same shell, which then loads the
    // benchmark's data from the app API.
    if (isBenchmarkDetail(url.pathname)) {
      const shell = new URL(url);
      shell.pathname = "/benchmark.html";
      return env.ASSETS.fetch(new Request(shell, { method: "GET", headers: request.headers }));
    }

    // Marketing pages, viewer assets, images, favicons.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
