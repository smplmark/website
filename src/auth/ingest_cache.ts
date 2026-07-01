// L1 ingest-auth cache (spec §8): a per-isolate module-global map of secret_hash -> target.
// A warm isolate authenticates a known secret straight from memory; a miss falls through to one
// indexed D1 read. Positives only — a target created after an isolate warms has no invalidation
// channel, so caching only successful lookups means new targets authenticate immediately
// everywhere. Single-threaded isolate, so a plain Map needs no lock.
import type { IngestTarget } from "../data/targets";

interface Entry {
  value: IngestTarget;
  expiresAt: number;
}

const TTL_MS = 60_000;
const MAX_ENTRIES = 1000;
const cache = new Map<string, Entry>();

export function getCachedTarget(
  secretHash: string,
  now: number,
): IngestTarget | null {
  const entry = cache.get(secretHash);
  if (entry === undefined) return null;
  if (entry.expiresAt <= now) {
    cache.delete(secretHash);
    return null;
  }
  return entry.value;
}

export function setCachedTarget(
  secretHash: string,
  value: IngestTarget,
  now: number,
): void {
  // Bound memory: a spray of distinct valid secrets can't grow the isolate unboundedly.
  if (cache.size >= MAX_ENTRIES && !cache.has(secretHash)) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(secretHash, { value, expiresAt: now + TTL_MS });
}

/** Test-only: reset the module-global cache between cases. */
export function clearCache(): void {
  cache.clear();
}
