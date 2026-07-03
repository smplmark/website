import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// Host-partition routing (src/app.ts). app.smplmark.org = console + auth + API; www.smplmark.org =
// marketing + published /benchmarks; the apex redirects to www. Requests to the wrong host redirect.
function fetchNoFollow(url: string) {
  return SELF.fetch(url, { redirect: "manual" });
}

describe("host partition", () => {
  it("301s the apex to www", async () => {
    const res = await fetchNoFollow("https://smplmark.org/");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://www.smplmark.org/");
  });

  it("moves the API off www to the app host (308, method-preserving)", async () => {
    const res = await fetchNoFollow("https://www.smplmark.org/api/v1/benchmarks");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://app.smplmark.org/api/v1/benchmarks");
  });

  it("moves app pages off www to the app host (301)", async () => {
    const res = await fetchNoFollow("https://www.smplmark.org/login");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://app.smplmark.org/login");
  });

  it("moves marketing pages off the app host to www (301)", async () => {
    const res = await fetchNoFollow("https://app.smplmark.org/about");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://www.smplmark.org/about");
  });

  it("redirects the app-host root into the console", async () => {
    const res = await fetchNoFollow("https://app.smplmark.org/");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://app.smplmark.org/account");
  });

  it("serves the API on the app host", async () => {
    const res = await fetchNoFollow("https://app.smplmark.org/api/v1/benchmarks");
    expect(res.status).toBe(200); // public list, no redirect
  });

  it("does not partition non-production hosts (localhost serves the API directly)", async () => {
    const res = await fetchNoFollow("http://smplmark.test/api/v1/benchmarks");
    expect(res.status).toBe(200);
  });
});
