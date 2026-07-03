// Env-derived configuration and feature detection. Secrets are optional (see env.d.ts): the getters
// here distinguish "feature not configured" (a graceful 503 / no-op) from "required secret missing"
// (a server-config bug → 500), never a client 400.

import type { Provider } from "./types";

/** Session-JWT parameters. */
export const JWT_AUDIENCE = "smplmark";
export const JWT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/** API-key plaintext prefix (smplmark-specific; the dispatch discriminator on /api/v1/*). */
export const API_KEY_PREFIX = "sm_api_";

/** Email-verification token lifetime. */
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/** Invitation token lifetime (mirrors smplkit). */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Where Contact Us tickets are delivered, and the From/Reply-To for transactional email. */
export const SUPPORT_EMAIL = "support@smplmark.org";

/** Canonical hosts (production). The app (console + auth + API) lives on `app`; the marketing site
 *  and published benchmarks live on `www`. See src/app.ts for the host-split routing. */
export const APP_HOST = "app.smplmark.org";
export const WWW_HOST = "www.smplmark.org";
export const APEX_HOST = "smplmark.org";

/**
 * The public origin. Prefers the APP_URL secret; otherwise falls back to the request's own origin
 * (fine for same-origin flows). Trailing slash stripped.
 */
export function appUrl(env: Env, requestUrl: string): string {
  const raw = env.APP_URL && env.APP_URL.length > 0 ? env.APP_URL : new URL(requestUrl).origin;
  return raw.replace(/\/+$/, "");
}

/** True when both client id and secret are present for the given OIDC provider. */
export function oidcConfigured(env: Env, provider: Provider): boolean {
  if (provider === "GOOGLE") {
    return !!(env.GOOGLE_OIDC_CLIENT_ID && env.GOOGLE_OIDC_CLIENT_SECRET);
  }
  if (provider === "MICROSOFT") {
    return !!(env.MICROSOFT_OIDC_CLIENT_ID && env.MICROSOFT_OIDC_CLIENT_SECRET);
  }
  return false;
}

export interface OidcClient {
  clientId: string;
  clientSecret: string;
  discoveryUrl: string;
  scope: string;
}

/** OIDC client config, or null when the provider is unconfigured. */
export function oidcClient(env: Env, provider: Provider): OidcClient | null {
  if (provider === "GOOGLE" && oidcConfigured(env, provider)) {
    return {
      clientId: env.GOOGLE_OIDC_CLIENT_ID as string,
      clientSecret: env.GOOGLE_OIDC_CLIENT_SECRET as string,
      discoveryUrl: "https://accounts.google.com/.well-known/openid-configuration",
      scope: "openid email profile",
    };
  }
  if (provider === "MICROSOFT" && oidcConfigured(env, provider)) {
    return {
      clientId: env.MICROSOFT_OIDC_CLIENT_ID as string,
      clientSecret: env.MICROSOFT_OIDC_CLIENT_SECRET as string,
      discoveryUrl:
        "https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration",
      scope: "openid email profile",
    };
  }
  return null;
}

/** True when the Resend transport is configured. */
export function emailConfigured(env: Env): boolean {
  return !!env.RESEND_API_KEY;
}

/** True when the Smpl Jobs trigger secret is configured (else the system-job endpoints 503). */
export function jobsTriggerConfigured(env: Env): boolean {
  return !!env.JOBS_TRIGGER_SECRET;
}

/**
 * The JWT signing secret. Absent in a properly-deployed service is a server-config bug, not client
 * input, so callers surface a 500 — never a 400.
 */
export function requireAuthSecret(env: Env): string {
  if (!env.APP_AUTH_SECRET) {
    throw new Error("APP_AUTH_SECRET is not configured.");
  }
  return env.APP_AUTH_SECRET;
}

/** The AES-GCM key-encryption secret (base64). Absent is a server-config bug. */
export function requireKeyEncryptionSecret(env: Env): string {
  if (!env.KEY_ENCRYPTION_SECRET) {
    throw new Error("KEY_ENCRYPTION_SECRET is not configured.");
  }
  return env.KEY_ENCRYPTION_SECRET;
}
