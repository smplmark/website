// Additional Worker bindings beyond the generated DB/ASSETS. Secrets are set with
// `wrangler secret put <NAME>` in prod and `.dev.vars` locally; vitest supplies them via
// vitest.config.ts. All are OPTIONAL: an unset secret disables its feature (OIDC begin → 503,
// email send → best-effort no-op), so config.ts must guard on presence rather than assume it.
//
// We augment BOTH the global `Env` (what src/ code sees) and `Cloudflare.Env` (what
// `cloudflare:test`'s `env` export is typed as) so the same fields are visible in app + tests.

interface SmplmarkSecrets {
  /** HS256 signing secret for session JWTs. */
  APP_AUTH_SECRET?: string;
  /** base64 32-byte AES-GCM key that encrypts API-key plaintext at rest (for reveal). */
  KEY_ENCRYPTION_SECRET?: string;
  /** Public origin (e.g. https://www.smplmark.org). Used for OIDC redirect + email links. */
  APP_URL?: string;
  GOOGLE_OIDC_CLIENT_ID?: string;
  GOOGLE_OIDC_CLIENT_SECRET?: string;
  MICROSOFT_OIDC_CLIENT_ID?: string;
  MICROSOFT_OIDC_CLIENT_SECRET?: string;
  /** Resend API key for verification email. */
  RESEND_API_KEY?: string;
  /** From-address for verification email (e.g. "smplmark <noreply@smplmark.org>"). */
  RESEND_FROM?: string;
}

declare global {
  interface Env extends SmplmarkSecrets {}
  namespace Cloudflare {
    interface Env extends SmplmarkSecrets {}
  }
}

export {};
