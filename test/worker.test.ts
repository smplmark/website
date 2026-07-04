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

  it("redirects app pages (login/signup) to the app host (301)", async () => {
    for (const p of ["/login", "/signup", "/account"]) {
      const res = await noFollow(`https://www.smplmark.org${p}`);
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe(`https://app.smplmark.org${p}`);
    }
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
});
