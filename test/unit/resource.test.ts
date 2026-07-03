import { describe, expect, it } from "vitest";
import type { DerivedContext } from "../../src/logic/derived";
import {
  serializeAccount,
  serializeAccountMembership,
  serializeAccountUser,
  serializeApiKey,
  serializeBenchmark,
  serializeInvitation,
  serializeObservation,
  serializeRun,
  serializeTarget,
  serializeUser,
} from "../../src/serialize/resource";
import type {
  AccountRow,
  AccountUserRow,
  ApiKeyRow,
  BenchmarkRow,
  InvitationRow,
  ObservationRow,
  RunRow,
  SampleSchema,
  TargetRow,
  UserRow,
} from "../../src/types";

const T0 = Date.UTC(2026, 6, 1, 9, 0, 0);
const ISO0 = "2026-07-01T09:00:00.000Z";

describe("serializeUser", () => {
  it("maps email_verified → verified boolean", () => {
    const row: UserRow = { id: "u1", email: "a@b.com", email_verified: 1, display_name: "A", created_at: T0 };
    expect(serializeUser(row)).toEqual({
      type: "user",
      id: "u1",
      attributes: { email: "a@b.com", verified: true, display_name: "A", created_at: ISO0 },
    });
    expect(serializeUser({ ...row, email_verified: 0 }).attributes.verified).toBe(false);
  });
});

describe("serializeAccount", () => {
  it("emits key/name/description/url and ISO created_at", () => {
    const row: AccountRow = {
      id: "a1", key: "smplkit", name: "smplkit",
      description: "we build things", url: "https://smplkit.com", created_at: T0,
    };
    expect(serializeAccount(row).attributes).toEqual({
      key: "smplkit", name: "smplkit", description: "we build things",
      url: "https://smplkit.com", created_at: ISO0,
    });
  });
});

describe("serializeAccountUser", () => {
  it("synthesizes a composite id and bare reference fields", () => {
    const row: AccountUserRow = { account_id: "a1", user_id: "u1", role: "OWNER", created_at: T0 };
    expect(serializeAccountUser(row)).toEqual({
      type: "account_user",
      id: "a1:u1",
      attributes: { account: "a1", user: "u1", role: "OWNER", created_at: ISO0 },
    });
  });

  it("surfaces joined identity fields when present", () => {
    const row = { account_id: "a1", user_id: "u1", role: "MEMBER" as const, created_at: T0, email: "m@b.com", display_name: null, email_verified: 1 };
    expect(serializeAccountUser(row).attributes).toEqual({
      account: "a1", user: "u1", role: "MEMBER", created_at: ISO0,
      email: "m@b.com", display_name: null, verified: true,
    });
  });
});

describe("serializeAccountMembership", () => {
  it("emits the account + the caller's role", () => {
    expect(
      serializeAccountMembership({ account_id: "a1", account_key: "acme", account_name: "Acme", role: "ADMIN", created_at: T0 }),
    ).toEqual({
      type: "account_membership",
      id: "a1",
      attributes: { account: "a1", key: "acme", name: "Acme", role: "ADMIN", created_at: ISO0 },
    });
  });
});

describe("serializeInvitation", () => {
  const row: InvitationRow = {
    id: "inv1", account_id: "a1", email: "x@b.com", role: "MEMBER", token_hash: "HASH",
    status: "PENDING", invited_by_user_id: "u1", expires_at: T0, accepted_at: null, created_at: T0,
  };
  it("omits the token by default and never leaks the hash", () => {
    const out = serializeInvitation(row);
    expect(out.attributes).toEqual({
      account: "a1", email: "x@b.com", role: "MEMBER", status: "PENDING",
      invited_by_user: "u1", expires_at: ISO0, accepted_at: null, created_at: ISO0,
    });
    expect(out.attributes.token).toBeUndefined();
  });
  it("includes the plaintext token when supplied", () => {
    expect(serializeInvitation(row, "PLAINTOKEN").attributes.token).toBe("PLAINTOKEN");
  });
});

describe("serializeApiKey", () => {
  const row: ApiKeyRow = {
    id: "k1", account_id: "a1", name: "ci", scope_type: "RUN", scope_ref: "r1",
    key_hash: "HASH", key_encrypted: "CIPHER", prefix: "sm_api_abcdefgh",
    expires_at: null, created_by_user_id: "u1", revoked_at: T0, last_used_at: null, created_at: T0,
  };

  it("never surfaces the hash or ciphertext; maps revoked/expires; omits plaintext by default", () => {
    const out = serializeApiKey(row);
    expect(out.attributes).toEqual({
      account: "a1", name: "ci", scope_type: "RUN", scope_ref: "r1", prefix: "sm_api_abcdefgh",
      expires_at: null, last_used_at: null, revoked: true, created_by_user: "u1", created_at: ISO0,
    });
    const s = JSON.stringify(out);
    expect(s).not.toContain("HASH");
    expect(s).not.toContain("CIPHER");
    expect(out.attributes).not.toHaveProperty("key");
  });

  it("includes the plaintext key only when provided (create/reveal)", () => {
    const out = serializeApiKey({ ...row, revoked_at: null, expires_at: T0 }, "sm_api_plain");
    expect(out.attributes.key).toBe("sm_api_plain");
    expect(out.attributes.revoked).toBe(false);
    expect(out.attributes.expires_at).toBe(ISO0);
  });
});

describe("serializeBenchmark", () => {
  it("maps account and status fields and parses sample_schema", () => {
    const row: BenchmarkRow = {
      id: "b1", account_id: "a1", key: "sched", name: "Sched",
      description: null, about: "long", methodology: "how", status: "WITHDRAWN",
      published_at: T0, withdrawn_at: T0, withdrawal_reason: "bad data",
      sample_schema: JSON.stringify({ metrics: [], derived: [] }),
      created_at: T0, updated_at: T0,
    };
    const out = serializeBenchmark(row);
    expect(out.type).toBe("benchmark");
    expect(out.attributes.account).toBe("a1");
    expect(out.attributes.status).toBe("WITHDRAWN");
    expect(out.attributes.published_at).toBe(ISO0);
    expect(out.attributes.withdrawal_reason).toBe("bad data");
    expect(out.attributes.sample_schema).toEqual({ metrics: [], derived: [] });
    expect(out.attributes).not.toHaveProperty("account_id");
  });

  it("emits null publish/withdraw timestamps as null", () => {
    const row: BenchmarkRow = {
      id: "b1", account_id: "a1", key: "sched", name: "Sched",
      description: null, about: null, methodology: null, status: "PRIVATE",
      published_at: null, withdrawn_at: null, withdrawal_reason: null,
      sample_schema: "{}", created_at: T0, updated_at: T0,
    };
    const out = serializeBenchmark(row);
    expect(out.attributes.published_at).toBeNull();
    expect(out.attributes.withdrawn_at).toBeNull();
  });
});

describe("serializeTarget", () => {
  const row: TargetRow = {
    id: "t1", benchmark_id: "b1", key: "sched-a", name: "Scheduler A",
    details: JSON.stringify({ region: "us-east-1" }), created_at: T0, updated_at: T0,
  };
  it("maps benchmark and parses details; null details → null", () => {
    expect(serializeTarget(row).attributes.benchmark).toBe("b1");
    expect(serializeTarget(row).attributes.details).toEqual({ region: "us-east-1" });
    expect(serializeTarget({ ...row, details: null }).attributes.details).toBeNull();
  });
});

describe("serializeRun", () => {
  const base: RunRow = {
    id: "r1", target_id: "t1", key: "default", name: null, details: null,
    started_at: null, ended_at: null, invalidated_at: null, invalidation_reason: null,
    invalidated_by_user_id: null, created_at: T0, updated_at: T0,
  };
  it("computes live/invalidated and maps timestamps", () => {
    const live = serializeRun(base);
    expect(live.attributes.target).toBe("t1");
    expect(live.attributes.live).toBe(true);
    expect(live.attributes.invalidated).toBe(false);

    const ended = serializeRun({
      ...base, started_at: T0, ended_at: T0, invalidated_at: T0,
      invalidation_reason: "oops", invalidated_by_user_id: "u1",
    });
    expect(ended.attributes.live).toBe(false);
    expect(ended.attributes.invalidated).toBe(true);
    expect(ended.attributes.started_at).toBe(ISO0);
    expect(ended.attributes.invalidated_by_user).toBe("u1");
  });
});

describe("serializeObservation", () => {
  const schema: SampleSchema = {
    metrics: [],
    derived: [{ name: "skew_ms", expr: { minute_offset_ms: [{ var: "created_at" }] } }],
  };
  const ctx: DerivedContext = { created_at: T0 + 87, run: { started_at: null, ended_at: null } };
  const base: Pick<ObservationRow, "id" | "run_id" | "created_at" | "metrics" | "meta"> = {
    id: 48213, run_id: "r1", created_at: T0 + 87, metrics: null, meta: null,
  };

  it("computes derived metrics, stringifies id", () => {
    const out = serializeObservation(base, schema, ctx);
    expect(out.id).toBe("48213");
    expect(out.attributes).toEqual({
      created_at: "2026-07-01T09:00:00.087Z", run: "r1", metrics: { skew_ms: 87 },
    });
  });

  it("includes meta when non-empty; omits it when null/empty/array", () => {
    expect(
      serializeObservation({ ...base, meta: JSON.stringify({ commit: "a1b2" }) }, schema, ctx)
        .attributes.meta,
    ).toEqual({ commit: "a1b2" });
    expect(serializeObservation(base, schema, ctx).attributes).not.toHaveProperty("meta");
    expect(serializeObservation({ ...base, meta: "{}" }, schema, ctx).attributes).not.toHaveProperty("meta");
    expect(serializeObservation({ ...base, meta: "[1,2]" }, schema, ctx).attributes).not.toHaveProperty("meta");
  });

  it("omits metrics for a bare observation under an empty schema", () => {
    const out = serializeObservation(base, { metrics: [], derived: [] }, ctx);
    expect(out.attributes).not.toHaveProperty("metrics");
  });
});
