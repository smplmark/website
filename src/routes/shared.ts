// Small helpers shared across resource routes: request parsing (pagination, sort, JSON:API body,
// plain-JSON body) so each handler stays focused on its resource logic.
import type { Context } from "hono";
import { attributesOf, parseJsonBody } from "../http/body";
import type { AppBindings } from "../http/middleware";
import { parsePagination, type Pagination } from "../query/pagination";
import { parseSort, type Sort } from "../query/sort";
import { BadRequestError } from "../errors";

type C = Context<AppBindings>;

export function readPagination(c: C): Pagination {
  return parsePagination(
    c.req.query("page[number]") ?? null,
    c.req.query("page[size]") ?? null,
    c.req.query("meta[total]") ?? null,
  );
}

export function readSort(c: C, defaultSort: string, allowed: readonly string[]): Sort {
  return parseSort(c.req.query("sort") ?? null, defaultSort, allowed);
}

/** Parse a JSON:API request body → its `data.attributes` object. */
export async function readAttributes(c: C): Promise<Record<string, unknown>> {
  return attributesOf(parseJsonBody(await c.req.text()));
}

/** Parse a plain-JSON request body (for non-resource auth endpoints) → a plain object. */
export async function readJsonObject(c: C): Promise<Record<string, unknown>> {
  const body = parseJsonBody(await c.req.text());
  if (body === undefined) return {};
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestError("Request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}
