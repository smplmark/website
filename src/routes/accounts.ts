import { Hono } from "hono";
import { getAccountById, getPublicAccountById, updateAccount } from "../data/accounts";
import { ForbiddenError, NotFoundError } from "../errors";
import { optionalStringOrNull, requireString } from "../http/body";
import { resourceResponse } from "../http/jsonapi";
import {
  getAuth,
  getOptionalAuth,
  optionalAuth,
  requireAuth,
  type AppBindings,
} from "../http/middleware";
import { serializeAccount } from "../serialize/resource";
import { readAttributes } from "./shared";

export const accounts = new Hono<AppBindings>();

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
