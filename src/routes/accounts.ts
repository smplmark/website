import { Hono } from "hono";
import { requireAdmin } from "../authz";
import { getAccountById, getPublicAccountById, updateAccount } from "../data/accounts";
import { listMembershipsForUserWithAccount } from "../data/account_users";
import { ForbiddenError, NotFoundError } from "../errors";
import { optionalStringOrNull, requireString } from "../http/body";
import { collectionResponse, resourceResponse } from "../http/jsonapi";
import {
  getAuth,
  getOptionalAuth,
  optionalAuth,
  requireAuth,
  type AppBindings,
} from "../http/middleware";
import { serializeAccount, serializeAccountMembership } from "../serialize/resource";
import { readAttributes } from "./shared";

export const accounts = new Hono<AppBindings>();

/** The accounts the current user is a member of, with the caller's role in each (for the switcher). */
accounts.get("/", requireAuth, async (c) => {
  const auth = getAuth(c);
  if (!auth.user_id) {
    throw new ForbiddenError("Listing your accounts requires a session credential.");
  }
  const rows = await listMembershipsForUserWithAccount(c.env.DB, auth.user_id);
  return collectionResponse(rows.map((r) => serializeAccountMembership(r)));
});

/** The caller's own account. */
accounts.get("/current", requireAuth, async (c) => {
  const auth = getAuth(c);
  const row = await getAccountById(c.env.DB, auth.account_id);
  if (!row) throw new NotFoundError();
  return resourceResponse(serializeAccount(row));
});

accounts.put("/current", requireAuth, async (c) => {
  const auth = getAuth(c);
  if (auth.scope_type !== "ACCOUNT") {
    throw new ForbiddenError("Updating the account requires an account-scoped credential.");
  }
  requireAdmin(auth);
  const attrs = await readAttributes(c);
  const name = requireString(attrs, "name");
  const description = optionalStringOrNull(attrs, "description") ?? null;
  const url = optionalStringOrNull(attrs, "url") ?? null;
  const row = await updateAccount(c.env.DB, auth.account_id, { name, description, url });
  if (!row) throw new NotFoundError();
  return resourceResponse(serializeAccount(row));
});

/** Public publisher lookup (only accounts with a world-visible benchmark), or the caller's own. */
accounts.get("/:id", optionalAuth, async (c) => {
  const auth = getOptionalAuth(c);
  const id = c.req.param("id");
  if (auth && auth.account_id === id) {
    const own = await getAccountById(c.env.DB, id);
    if (own) return resourceResponse(serializeAccount(own));
  }
  const row = await getPublicAccountById(c.env.DB, id);
  if (!row) throw new NotFoundError();
  return resourceResponse(serializeAccount(row));
});
