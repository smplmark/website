import { Hono } from "hono";
import { listMembershipsForAccount } from "../data/account_users";
import { ForbiddenError } from "../errors";
import { collectionResponse } from "../http/jsonapi";
import { getAuth, requireAuth, type AppBindings } from "../http/middleware";
import { paginationMeta } from "../query/pagination";
import { serializeAccountUser } from "../serialize/resource";
import { readPagination } from "./shared";

export const accountUsers = new Hono<AppBindings>();

/** Membership of the caller's account. Account-level authority required. */
accountUsers.get("/", requireAuth, async (c) => {
  const auth = getAuth(c);
  if (auth.scope_type !== "ACCOUNT") {
    throw new ForbiddenError("Listing members requires an account-scoped credential.");
  }
  const pagination = readPagination(c);
  const rows = await listMembershipsForAccount(c.env.DB, auth.account_id);
  const page = rows.slice(pagination.offset, pagination.offset + pagination.limit);
  return collectionResponse(page.map(serializeAccountUser), {
    meta: { pagination: paginationMeta(pagination, pagination.includeTotal ? rows.length : undefined) },
  });
});
