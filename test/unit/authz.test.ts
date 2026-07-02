import { describe, expect, it } from "vitest";
import { canMintScope, covers, isPublicStatus } from "../../src/authz";
import type { AuthContext, ScopeType } from "../../src/types";

const ctx = (scope_type: ScopeType, scope_ref: string | null = null, account_id = "acc"): AuthContext => ({
  source: "API_KEY",
  account_id,
  scope_type,
  scope_ref,
  user_id: null,
  role: null,
  session_id: null,
});

describe("covers", () => {
  it("enforces the tenant floor", () => {
    expect(covers(ctx("ACCOUNT", null, "acc"), { account_id: "other" })).toBe(false);
  });

  it("ACCOUNT scope covers the whole account", () => {
    expect(covers(ctx("ACCOUNT"), { account_id: "acc", benchmark_id: "b", run_id: "r" })).toBe(true);
  });

  it("BENCHMARK scope covers only its benchmark subtree", () => {
    expect(covers(ctx("BENCHMARK", "b1"), { account_id: "acc", benchmark_id: "b1" })).toBe(true);
    expect(covers(ctx("BENCHMARK", "b1"), { account_id: "acc", benchmark_id: "b2" })).toBe(false);
    expect(covers(ctx("BENCHMARK", "b1"), { account_id: "acc" })).toBe(false); // no benchmark_id
  });

  it("RUN scope covers only its run", () => {
    expect(covers(ctx("RUN", "r1"), { account_id: "acc", benchmark_id: "b", run_id: "r1" })).toBe(true);
    expect(covers(ctx("RUN", "r1"), { account_id: "acc", benchmark_id: "b", run_id: "r2" })).toBe(false);
    expect(covers(ctx("RUN", "r1"), { account_id: "acc", benchmark_id: "b" })).toBe(false); // no run_id
  });
});

describe("isPublicStatus", () => {
  it("is true for PUBLISHED and WITHDRAWN only", () => {
    expect(isPublicStatus("PUBLISHED")).toBe(true);
    expect(isPublicStatus("WITHDRAWN")).toBe(true);
    expect(isPublicStatus("PRIVATE")).toBe(false);
  });
});

describe("canMintScope", () => {
  it("only account authority can mint an account-scope key", () => {
    expect(canMintScope(ctx("ACCOUNT"), { account_id: "acc" })).toBe(true);
    expect(canMintScope(ctx("RUN", "r1"), { account_id: "acc" })).toBe(false);
  });
});
