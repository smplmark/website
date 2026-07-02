import { Hono } from "hono";
import { getPublicAccountById } from "../data/accounts";
import { NotFoundError } from "../errors";
import { resourceResponse } from "../http/jsonapi";
import type { AppBindings } from "../http/middleware";
import { serializeAccount } from "../serialize/resource";

// Public publisher info. Accounts are hand-seeded (no create/update API in v1); only accounts
// that publish a published benchmark are exposed.
export const accounts = new Hono<AppBindings>();

accounts.get("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await getPublicAccountById(c.env.DB, id);
  if (!row) throw new NotFoundError(`Account ${JSON.stringify(id)} not found.`);
  return resourceResponse(serializeAccount(row));
});
