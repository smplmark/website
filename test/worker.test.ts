import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// The website Worker (src/index.ts): apex → www, the /benchmarks/{key} shell, and static fallthrough.
function noFollow(url: string) {
  return SELF.fetch(url, { redirect: "manual" });
}

describe("website worker", () => {
  it("redirects the apex to www (301)", async () => {
    const res = await noFollow("https://smplmark.org/benchmarks/scheduler-latency");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(
      "https://www.smplmark.org/benchmarks/scheduler-latency",
    );
  });

  it("serves the data-driven benchmark shell for /benchmarks/{key}", async () => {
    const res = await SELF.fetch("https://www.smplmark.org/benchmarks/scheduler-latency");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('id="bm-name"'); // the benchmark.html shell
    expect(body).toContain("/js/benchmark.js");
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
});
