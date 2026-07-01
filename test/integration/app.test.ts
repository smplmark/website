import { describe, expect, it } from "vitest";
import { apiGet } from "./helpers";

describe("app routing", () => {
  it("returns a JSON:API 404 for an unmatched /api route", async () => {
    const res = await apiGet("/api/v1/nonexistent");
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("application/vnd.api+json");
    const doc = (await res.json()) as { errors: { status: string }[] };
    expect(doc.errors[0].status).toBe("404");
  });

  it("falls through to static assets for non-API paths", async () => {
    const res = await apiGet("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("smplmark");
  });
});
