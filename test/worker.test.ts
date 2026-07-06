import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { embedObjectKey } from "../src/embed";

// The website Worker (src/index.ts): apex → www, the /benchmarks/{key} shell, and static fallthrough.
function noFollow(url: string) {
  return SELF.fetch(url, { redirect: "manual" });
}

async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("website worker", () => {
  it("redirects the apex to www (301)", async () => {
    const res = await noFollow("https://smplmark.org/benchmarks/scheduler-latency");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(
      "https://www.smplmark.org/benchmarks/scheduler-latency",
    );
  });

  it("server-side-renders a found benchmark into the shell (title, meta, JSON-LD, body)", async () => {
    const res = await SELF.fetch("https://www.smplmark.org/benchmarks/blender-cpu");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toContain("max-age=300");
    const body = await res.text();

    // The interactive shell is still intact (the viewer hydrates on top).
    expect(body).toContain('id="bm-name"');
    expect(body).toContain("/js/benchmark.js");

    // SEO head injection.
    expect(body).toContain("<title>Blender Benchmark — CPU — smplmark</title>");
    expect(body).toContain('<meta name="description" content="Cycles CPU render performance');
    expect(body).toContain('<link rel="canonical" href="https://www.smplmark.org/benchmarks/blender-cpu"');
    expect(body).toContain('<meta property="og:title"');
    // A CATEGORY benchmark unfurls its own chart image (not the logo) via a large Twitter card.
    expect(body).toContain('<meta property="og:image" content="https://www.smplmark.org/embed/blender-cpu.png"');
    expect(body).toContain('<meta name="twitter:card" content="summary_large_image"');
    expect(body).toContain('<script type="application/ld+json">');
    expect(body).toContain('"@type":"Dataset"');
    expect(body).toContain(
      '"contentUrl":"https://app.smplmark.org/api/v1/observations?filter[benchmark]=bench-blender-cpu"',
    );

    // Crawlable body: the SSR content block is filled with real text + the target list.
    expect(body).toContain("Median render scores");
    expect(body).toContain("<h2>Targets (2)</h2>");
    expect(body).toContain("AMD Ryzen 9 7950X");
    expect(body).toContain("median_score");
  });

  it("returns a real 404 (noindex) for an unknown benchmark key", async () => {
    const res = await SELF.fetch("https://www.smplmark.org/benchmarks/ghost-benchmark");
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain("<title>Benchmark not found — smplmark</title>");
    expect(body).toContain('content="noindex"');
    expect(body).toContain('id="bm-name"'); // shell still served; the viewer shows the not-found state
  });

  it("falls back to the plain shell (200) when the API is unreachable", async () => {
    // down-benchmark's lookup 503s → SSR enrichment is skipped, the shell is served as-is.
    const res = await SELF.fetch("https://www.smplmark.org/benchmarks/down-benchmark");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('id="bm-name"');
    expect(body).toContain("/js/benchmark.js");
    expect(body).not.toContain("application/ld+json"); // no injection on the fallback path
  });

  it("renders head metadata even when the targets fetch fails (best-effort body)", async () => {
    const res = await SELF.fetch("https://www.smplmark.org/benchmarks/no-targets");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<title>No Targets — smplmark</title>");
    expect(body).toContain('"@type":"Dataset"');
    expect(body).not.toContain("<h2>Targets"); // targets 503'd → the block omits them
  });

  it("renders a found-but-attributeless row without crashing, skipping malformed targets", async () => {
    const res = await SELF.fetch("https://www.smplmark.org/benchmarks/bare-attributes");
    expect(res.status).toBe(200);
    const body = await res.text();
    // No attributes → a generic title, and the two valid targets counted (the id-less one skipped).
    expect(body).toContain("<title>Benchmark — smplmark</title>");
    expect(body).toContain("<h2>Targets (2)</h2>");
    expect(body).not.toContain("Malformed (no id)");
  });

  it("serves the /benchmarks list as a static page (not the detail shell)", async () => {
    const res = await SELF.fetch("https://www.smplmark.org/benchmarks");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("benchmark-grid"); // the list grid, not benchmark.html
  });

  it("serves the marketing home from static assets", async () => {
    const res = await SELF.fetch("https://www.smplmark.org/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("smplmark");
  });

  it("redirects app pages (login/signup) to the app host (301)", async () => {
    for (const p of ["/login", "/signup", "/account"]) {
      const res = await noFollow(`https://www.smplmark.org${p}`);
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe(`https://app.smplmark.org${p}`);
    }
  });

  it("serves the sources page", async () => {
    const res = await SELF.fetch("https://www.smplmark.org/sources");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Where smplmark's ingested benchmarks come from");
  });

  it("redirects the API to the app host (308, method-preserving)", async () => {
    const res = await noFollow("https://www.smplmark.org/api/v1/benchmarks");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://app.smplmark.org/api/v1/benchmarks");
  });

  it("serves the Microsoft publisher-domain file on www AND the apex (no redirect)", async () => {
    for (const host of ["https://www.smplmark.org", "https://smplmark.org"]) {
      const res = await noFollow(`${host}/.well-known/microsoft-identity-association.json`);
      expect(res.status).toBe(200); // apex serves it directly, not a 301 to www
      const doc = (await res.json()) as { associatedApplications: { applicationId: string }[] };
      expect(doc.associatedApplications[0].applicationId).toBe(
        "941cf0fd-6ad3-443f-9f1e-3e58445d4fed",
      );
    }
  });

  it("serves robots.txt on any host without a redirect", async () => {
    for (const host of ["https://www.smplmark.org", "https://smplmark.org"]) {
      const res = await noFollow(`${host}/robots.txt`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");
      const body = await res.text();
      expect(body).toContain("User-agent: *");
      expect(body).toContain("Sitemap: https://www.smplmark.org/sitemap.xml");
    }
  });

  it("serves a cached embed image straight from R2 (cache hit)", async () => {
    // No params → empty canonical query → the empty-string SHA-256 keys the object.
    const objectKey = embedObjectKey("blender-cpu", await sha256hex(""));
    await env.EMBEDS.put(objectKey, new Uint8Array([0x89, 0x50, 0x4e, 0x47])); // PNG magic
    const res = await SELF.fetch("https://www.smplmark.org/embed/blender-cpu.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await res.arrayBuffer())[0]).toBe(0x89); // the stored bytes, served back
  });

  it("404s an embed image for an unknown benchmark key", async () => {
    const res = await SELF.fetch("https://www.smplmark.org/embed/ghost-benchmark.png");
    expect(res.status).toBe(404);
  });

  it("400s a time-series embed image without a bounded range", async () => {
    const res = await SELF.fetch("https://www.smplmark.org/embed/time-bench.png");
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/bounded range/);
  });

  it("builds a dynamic sitemap.xml from the published-benchmark list", async () => {
    const res = await noFollow("https://www.smplmark.org/sitemap.xml");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    const body = await res.text();
    expect(body).toContain("<urlset");
    // Marketing pages.
    expect(body).toContain("<loc>https://www.smplmark.org/</loc>");
    expect(body).toContain("<loc>https://www.smplmark.org/about</loc>");
    // Published benchmarks (from the mocked list) with lastmod.
    expect(body).toContain("<loc>https://www.smplmark.org/benchmarks/blender-cpu</loc>");
    expect(body).toContain("<loc>https://www.smplmark.org/benchmarks/openml-amlb</loc>");
    expect(body).toContain("<lastmod>2026-07-04T16:00:00.000Z</lastmod>");
  });
});
