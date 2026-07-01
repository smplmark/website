import { describe, expect, it } from "vitest";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  toErrorDocument,
} from "../../src/errors";

describe("toErrorDocument", () => {
  it("maps a BadRequestError with detail and source", () => {
    const out = toErrorDocument(
      new BadRequestError("bad key", { pointer: "/data/attributes/key" }),
    );
    expect(out).toEqual({
      status: 400,
      document: {
        errors: [
          {
            status: "400",
            title: "Bad Request",
            detail: "bad key",
            source: { pointer: "/data/attributes/key" },
          },
        ],
      },
    });
  });

  it("maps a uniform UnauthorizedError", () => {
    const out = toErrorDocument(new UnauthorizedError());
    expect(out.status).toBe(401);
    expect(out.document.errors[0]).toEqual({
      status: "401",
      title: "Unauthorized",
      detail: "Authentication failed.",
    });
  });

  it("omits detail and source when absent (NotFoundError)", () => {
    const out = toErrorDocument(new NotFoundError());
    expect(out.document.errors[0]).toEqual({ status: "404", title: "Not Found" });
  });

  it("maps a ConflictError", () => {
    expect(toErrorDocument(new ConflictError("dup")).status).toBe(409);
  });

  it("maps an unexpected (non-App) error to a 500", () => {
    const out = toErrorDocument(new Error("boom"));
    expect(out).toEqual({
      status: 500,
      document: { errors: [{ status: "500", title: "Internal Server Error" }] },
    });
  });
});
