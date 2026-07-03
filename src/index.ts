// smplmark website Worker — the marketing site and the published-benchmark viewer, served on
// www.smplmark.org (the apex redirects here). It holds no API and no database: the viewer reads
// published data from the app's public API (app.smplmark.org) client-side (see public/js/benchmark.js).
//
// Responsibilities:
//   1. Redirect the apex (smplmark.org) to the canonical www host.
//   2. Serve the data-driven benchmark shell for every /benchmarks/{key}.
//   3. Fall through to static assets (marketing pages, viewer JS/CSS, images) for everything else.

const APEX_HOST = "smplmark.org";
const WWW_HOST = "www.smplmark.org";

/** /benchmarks/{key} — a single path segment after /benchmarks (not /benchmarks itself, which is the
 *  static index listing). */
function isBenchmarkDetail(pathname: string): boolean {
  return /^\/benchmarks\/[^/]+\/?$/.test(pathname);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Apex → www (single canonical marketing host).
    if (url.hostname === APEX_HOST) {
      url.protocol = "https:";
      url.hostname = WWW_HOST;
      return Response.redirect(url.toString(), 301);
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
