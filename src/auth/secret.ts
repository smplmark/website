// Ingest-secret generation and hashing. The plaintext is a high-entropy random token returned once
// at target creation; only its SHA-256 hash is persisted (spec §6). WebCrypto is native to Workers.

/** Generate a fresh ingest secret (a random UUID — ~122 bits of entropy). */
export function generateSecret(): string {
  return crypto.randomUUID();
}

/** SHA-256 hash of a secret, hex-encoded. Used for the O(1) unique-index lookup on ingest. */
export async function hashSecret(secret: string): Promise<string> {
  const data = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
