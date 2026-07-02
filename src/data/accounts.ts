import type { AccountRow } from "../types";

export async function getAccountById(
  db: D1Database,
  id: string,
): Promise<AccountRow | null> {
  return (
    (await db
      .prepare("SELECT * FROM account WHERE id = ?")
      .bind(id)
      .first<AccountRow>()) ?? null
  );
}

/** Public publisher lookup: only accounts that publish at least one published benchmark. */
export async function getPublicAccountById(
  db: D1Database,
  id: string,
): Promise<AccountRow | null> {
  return (
    (await db
      .prepare(
        "SELECT * FROM account WHERE id = ? AND EXISTS (SELECT 1 FROM benchmark WHERE benchmark.account_id = account.id AND benchmark.visibility = 'published')",
      )
      .bind(id)
      .first<AccountRow>()) ?? null
  );
}
