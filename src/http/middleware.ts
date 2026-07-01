import type { MiddlewareHandler } from "hono";
import { UnauthorizedError } from "../errors";

export interface AppBindings {
  Bindings: Env;
}

/**
 * Admin auth — a STUB in v1 (internal/seed use). Checks a shared bearer token. Becomes the
 * ADR-017 tenant JWT when the account product ships. Failure → 401.
 */
export const adminAuth: MiddlewareHandler<AppBindings> = async (c, next) => {
  const auth = c.req.header("Authorization");
  if (auth !== `Bearer ${c.env.ADMIN_TOKEN}`) {
    throw new UnauthorizedError();
  }
  await next();
};
