import { describe, expect, it } from "vitest";
import { generateSecret, hashSecret } from "../../src/auth/secret";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("generateSecret", () => {
  it("returns a UUID-shaped token", () => {
    expect(generateSecret()).toMatch(UUID_RE);
  });

  it("returns a distinct value each call", () => {
    expect(generateSecret()).not.toBe(generateSecret());
  });
});

describe("hashSecret", () => {
  it("produces a 64-char hex SHA-256 digest", async () => {
    const h = await hashSecret("hello");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches a known SHA-256 vector", async () => {
    expect(await hashSecret("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is deterministic and collision-free across inputs", async () => {
    expect(await hashSecret("x")).toBe(await hashSecret("x"));
    expect(await hashSecret("x")).not.toBe(await hashSecret("y"));
  });
});
