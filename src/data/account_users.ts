import type { AccountUserRow, Role } from "../types";

export async function createMembership(
  db: D1Database,
  input: { account_id: string; user_id: string; role: Role },
): Promise<AccountUserRow> {
  const row: AccountUserRow = {
    account_id: input.account_id,
    user_id: input.user_id,
    role: input.role,
    created_at: Date.now(),
  };
  await db
    .prepare(
      "INSERT INTO account_user (account_id, user_id, role, created_at) VALUES (?,?,?,?)",
    )
    .bind(row.account_id, row.user_id, row.role, row.created_at)
    .run();
  return row;
}

export async function listMembershipsForAccount(
  db: D1Database,
  accountId: string,
): Promise<AccountUserRow[]> {
  return (
    await db
      .prepare(
        "SELECT * FROM account_user WHERE account_id = ? ORDER BY created_at, user_id",
      )
      .bind(accountId)
      .all<AccountUserRow>()
  ).results;
}

/** The caller's primary (oldest) account, used to pick the session account on login. */
export async function getPrimaryMembershipForUser(
  db: D1Database,
  userId: string,
): Promise<AccountUserRow | null> {
  return (
    (await db
      .prepare(
        "SELECT account_user.* FROM account_user JOIN account ON account.id = account_user.account_id WHERE account_user.user_id = ? ORDER BY account.created_at, account.id LIMIT 1",
      )
      .bind(userId)
      .first<AccountUserRow>()) ?? null
  );
}
