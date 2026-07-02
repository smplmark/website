// Authorization (§7). One check, fed by both credential sources. A credential's *effective* scope
// (ACCOUNT for a session OWNER or ACCOUNT key; BENCHMARK/RUN for a scoped key) grants read+write on
// the scoped resource and its whole subtree, uniformly at every level. Tenant isolation is the floor:
// a resource in another account is never covered.
import type { AuthContext, Status } from "../types";

/** A resource's ancestry, from the *chains* data helpers. */
export interface ResourceChain {
  account_id: string;
  benchmark_id?: string;
  target_id?: string;
  run_id?: string;
}

/** Does this credential's effective scope cover the given resource? */
export function covers(ctx: AuthContext, chain: ResourceChain): boolean {
  if (ctx.account_id !== chain.account_id) return false; // tenant floor
  switch (ctx.scope_type) {
    case "ACCOUNT":
      return true;
    case "BENCHMARK":
      return chain.benchmark_id !== undefined && chain.benchmark_id === ctx.scope_ref;
    case "RUN":
      return chain.run_id !== undefined && chain.run_id === ctx.scope_ref;
  }
}

/** World-visible statuses (no credential required to read). */
export function isPublicStatus(status: Status): boolean {
  return status === "PUBLISHED" || status === "WITHDRAWN";
}

/**
 * Authority ceiling for minting keys (§6): a key may not exceed its minter's authority. The
 * requested key's scope chain must be covered by the caller's effective scope. `requestedChain` for
 * an ACCOUNT-scope request is just `{account_id}` (so only an ACCOUNT-authority caller passes).
 */
export function canMintScope(ctx: AuthContext, requestedChain: ResourceChain): boolean {
  return covers(ctx, requestedChain);
}
