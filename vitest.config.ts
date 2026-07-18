import { MockAgent } from "undici";
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// The website Worker is a thin routing shim over static assets, but it now also server-side-renders
// the benchmark pages and the sitemap by fetching the app API. Tests must be hermetic, so we mock
// every outbound fetch to the app host with canned JSON:API responses (undici MockAgent, wired into
// miniflare via `fetchMock`). disableNetConnect() guarantees no test ever hits the real network.

const APP_ORIGIN = "https://app.smplmark.org";

const BENCH_BLENDER = {
  id: "bench-blender-cpu",
  attributes: {
    key: "blender-cpu",
    publisher_slug: "blender",
    name: "Blender Benchmark — CPU",
    description: "Cycles CPU render performance across community-benchmarked processors.",
    about: "Median render scores for CPUs in the Blender Open Data set.\n\nHigher is better.",
    methodology: "Scores are the community median for each device.",
    category: "HARDWARE",
    tags: ["blender", "cpu", "rendering"],
    status: "PUBLISHED",
    published_at: "2026-07-04T15:51:02.616Z",
    updated_at: "2026-07-04T16:00:00.000Z",
    measurement_schema: {
      metrics: [{ name: "median_score" }],
      derived: [{ name: "submission_count" }],
      chart: { x_kind: "CATEGORY" },
    },
    published_as: {
      kind: "INGESTED",
      source_name: "Blender Open Data",
      source_url: "https://opendata.blender.org",
      license: "CC0-1.0",
    },
  },
};

// A TIME-series benchmark — its embed image requires a bounded from/to range.
const BENCH_TIME = {
  id: "bench-time",
  attributes: {
    key: "time-bench",
    publisher_slug: "timepub",
    name: "Time Bench",
    description: "A time-series benchmark.",
    measurement_schema: { metrics: [{ name: "skew_ms" }], derived: [], chart: { x_kind: "TIME" } },
  },
};

const BENCH_AMLB = {
  id: "bench-amlb",
  attributes: {
    key: "openml-amlb",
    publisher_slug: "openml",
    name: "AutoML Benchmark (AMLB)",
    description: "AutoML frameworks compared on classification accuracy.",
    updated_at: "2026-07-04T16:12:44.217Z",
  },
};

// A found benchmark whose subjects endpoint fails — exercises the SSR path's best-effort subjects
// fallback (head metadata still renders; the body block just omits the subject list).
const BENCH_NOSUBJECTS = {
  id: "bench-nosubjects",
  attributes: {
    key: "no-subjects",
    publisher_slug: "notarg",
    name: "No Subjects",
    description: "A benchmark with no subject data.",
  },
};

const SUBJECTS = {
  data: [
    { id: "t1", attributes: { key: "amd-ryzen", name: "AMD Ryzen 9 7950X" } },
    { id: "t2", attributes: { key: "intel-i9", name: "Intel Core i9-14900K" } },
    { attributes: { key: "no-id", name: "Malformed (no id)" } }, // exercises the id-guard skip
  ],
  meta: { pagination: { total: 2 } },
};

// The config runs in a bare Node/TS context (no @types/node, no DOM lib), so parse the request path
// with plain string ops rather than the URL global.
function queryParam(path: string, name: string): string | null {
  const m = new RegExp(`[?&]${name.replace(/[[\]]/g, "\\$&")}=([^&]*)`).exec(path);
  return m ? decodeURIComponent(m[1]) : null;
}

function replyFor(path: string): { statusCode: number; data: string } {
  const pathname = path.split("?")[0];
  const json = (body: unknown) => ({ statusCode: 200, data: JSON.stringify(body) });

  if (pathname === "/api/v1/benchmarks") {
    const key = queryParam(path, "filter[key]");
    if (key === "blender-cpu") return json({ data: [BENCH_BLENDER] });
    if (key === "time-bench") return json({ data: [BENCH_TIME] });
    if (key === "no-subjects") return json({ data: [BENCH_NOSUBJECTS] });
    if (key === "bare-attributes") return json({ data: [{ id: "bench-bare" }] }); // row without attributes
    if (key === "ghost-benchmark") return json({ data: [] });
    if (key === "down-benchmark") return { statusCode: 503, data: "{}" };
    // The sitemap list request (sort/page, no filter[key]).
    if (key === null) return json({ data: [BENCH_BLENDER, BENCH_AMLB] });
    return json({ data: [] });
  }
  if (pathname === "/api/v1/subjects") {
    if (queryParam(path, "filter[benchmark]") === "bench-nosubjects") {
      return { statusCode: 503, data: "{}" };
    }
    return json(SUBJECTS);
  }
  return { statusCode: 404, data: "{}" };
}

const agent = new MockAgent();
agent.disableNetConnect();
agent
  .get(APP_ORIGIN)
  .intercept({ path: () => true, method: "GET" })
  .reply((opts) => {
    const { statusCode, data } = replyFor(String(opts.path));
    return { statusCode, data, responseOptions: { headers: { "content-type": "application/vnd.api+json" } } };
  })
  .persist();

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        fetchMock: agent,
        // Simulated in-memory R2 for the /embed/{key}.png cache path. Browser Rendering has no
        // miniflare simulation, so the generate-on-miss path is verified on deploy, not here.
        r2Buckets: ["EMBEDS"],
        bindings: {
          // vitest auto-loads .dev.vars; blank it so tests exercise the PRODUCTION app-host
          // redirects (the DEV_APP_ORIGIN dev-loop behavior is exercised via wrangler dev). This
          // also makes the SSR fetches target app.smplmark.org, which the mock above intercepts.
          DEV_APP_ORIGIN: "",
        },
      },
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      exclude: ["**/*.d.ts"],
      thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
    },
  },
});
