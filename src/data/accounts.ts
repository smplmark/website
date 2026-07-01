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
