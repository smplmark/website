import { beforeEach, describe, expect, it } from "vitest";
import {
  clearCache,
  getCachedTarget,
  setCachedTarget,
} from "../../src/auth/ingest_cache";
import type { IngestTarget } from "../../src/data/targets";

const target = (id: string): IngestTarget => ({
  id,
  benchmark_id: "b",
  sample_schema: "{}",
});

beforeEach(() => clearCache());

describe("ingest cache", () => {
  it("returns null on a miss", () => {
    expect(getCachedTarget("nope", 0)).toBeNull();
  });

  it("returns a cached value before its TTL expires", () => {
    setCachedTarget("h", target("t1"), 1000);
    expect(getCachedTarget("h", 1000)).toEqual(target("t1"));
    expect(getCachedTarget("h", 1000 + 59_000)).toEqual(target("t1"));
  });

  it("expires and evicts an entry past its TTL", () => {
    setCachedTarget("h", target("t1"), 0);
    // TTL is 60s; at 60_001ms the entry is expired.
    expect(getCachedTarget("h", 60_001)).toBeNull();
    // A second lookup confirms it was deleted (still a miss).
    expect(getCachedTarget("h", 60_001)).toBeNull();
  });

  it("evicts the oldest entry when full", () => {
    for (let i = 0; i < 1000; i++) setCachedTarget(`h${i}`, target(`t${i}`), 0);
    // Cache is full (1000). Adding a new key evicts the oldest (h0).
    setCachedTarget("h1000", target("t1000"), 0);
    expect(getCachedTarget("h0", 0)).toBeNull();
    expect(getCachedTarget("h1000", 0)).toEqual(target("t1000"));
  });

  it("updates an existing key when full without evicting others", () => {
    for (let i = 0; i < 1000; i++) setCachedTarget(`h${i}`, target(`t${i}`), 0);
    setCachedTarget("h500", target("updated"), 0);
    expect(getCachedTarget("h500", 0)).toEqual(target("updated"));
    // No eviction happened: h0 is still present.
    expect(getCachedTarget("h0", 0)).toEqual(target("t0"));
  });
});
