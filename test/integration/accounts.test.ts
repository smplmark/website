import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiGet, makeBenchmark, resetDb, seedAccount } from "./helpers";

let account: string;
beforeEach(async () => {
  await resetDb();
  account = await seedAccount();
  await env.DB.prepare("UPDATE account SET description = ?, url = ? WHERE id = ?")
    .bind("we build developer infra", "https://smplkit.com", account)
    .run();
});

describe("GET /api/v1/accounts/:id", () => {
  it("returns publisher info for an account with a published benchmark", async () => {
    await makeBenchmark(account, { visibility: "published" });
    const res = await apiGet(`/api/v1/accounts/${account}`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      data: { type: string; attributes: Record<string, unknown> };
    };
    expect(doc.data.type).toBe("account");
    expect(doc.data.attributes.key).toBe("smplkit");
    expect(doc.data.attributes.description).toBe("we build developer infra");
    expect(doc.data.attributes.url).toBe("https://smplkit.com");
  });

  it("404s an account whose only benchmarks are private", async () => {
    await makeBenchmark(account, { key: "priv", visibility: "private" });
    expect((await apiGet(`/api/v1/accounts/${account}`)).status).toBe(404);
  });

  it("404s an unknown account", async () => {
    await makeBenchmark(account, { visibility: "published" });
    expect((await apiGet("/api/v1/accounts/missing")).status).toBe(404);
  });
});
