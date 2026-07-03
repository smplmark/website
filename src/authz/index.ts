// Authorization (§7). One check, fed by both credential sources. A credential's *effective* scope
// (ACCOUNT for a session OWNER or ACCOUNT key; BENCHMARK/RUN for a scoped key) grants read+write on
// the scoped resource and its whole subtree, uniformly at every level. Tenant isolation is the floor:
// a resource in another account is never covered.
import { ForbiddenError } from "../errors";
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

// ── Role-based access (mirrors smplkit's VIEWER < MEMBER < ADMIN < OWNER chain) ──
// Role gating applies only to SESSION credentials — an API key's authority is already bounded by its
// scope, so it always passes the role gates (a key is minted by an admin and acts within its scope).

/** May create / edit / delete resources (benchmarks, targets, runs, observations). */
export function canWrite(ctx: AuthContext): boolean {
  if (ctx.source === "API_KEY") return true;
  return ctx.role === "OWNER" || ctx.role === "ADMIN" || ctx.role === "MEMBER";
}

/** May manage members, invitations, API keys, and account settings. */
export function canAdmin(ctx: AuthContext): boolean {
  if (ctx.source === "API_KEY") return true;
  return ctx.role === "OWNER" || ctx.role === "ADMIN";
}

/** The account owner (immutable, one per account). */
export function isOwner(ctx: AuthContext): boolean {
  if (ctx.source === "API_KEY") return true;
  return ctx.role === "OWNER";
}

export const RBAC_REASONS = {
  write: "Viewers can view resources but can't edit them. Ask an admin to change your role.",
  admin: "Only admins can manage members, invitations, API keys, and account settings.",
  owner: "Only the account owner can perform this action.",
} as const;

/** Throw 403 unless the caller may write resources. */
export function requireWrite(ctx: AuthContext): void {
  if (!canWrite(ctx)) throw new ForbiddenError(RBAC_REASONS.write);
}

/** Throw 403 unless the caller may perform admin operations. */
export function requireAdmin(ctx: AuthContext): void {
  if (!canAdmin(ctx)) throw new ForbiddenError(RBAC_REASONS.admin);
}
