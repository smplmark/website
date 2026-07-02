// Verification email via Resend's REST API. Best-effort by contract (§15): a send failure NEVER
// wedges signup — callers ignore the boolean and rely on the resend path for recovery. When Resend
// is unconfigured (local/dev/tests), this is a silent no-op returning false.
import { emailConfigured } from "../config";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "smplmark <noreply@smplmark.org>";

function verificationHtml(verifyUrl: string, name: string | null): string {
  const greeting = name ? `Hi ${name},` : "Hi,";
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1f2328">
<p>${greeting}</p>
<p>Confirm your email to finish setting up your smplmark account and unlock publishing.</p>
<p><a href="${verifyUrl}" style="display:inline-block;padding:10px 18px;background:#4f8cff;color:#fff;border-radius:8px;text-decoration:none">Verify email</a></p>
<p>Or paste this link into your browser:<br><a href="${verifyUrl}">${verifyUrl}</a></p>
<p style="color:#5b6570;font-size:13px">This link expires in 24 hours. If you didn't create a smplmark account, you can ignore this email.</p>
</body></html>`;
}

function verificationText(verifyUrl: string): string {
  return `Confirm your email to finish setting up your smplmark account and unlock publishing.\n\n${verifyUrl}\n\nThis link expires in 24 hours. If you didn't create a smplmark account, you can ignore this email.`;
}

/** Send a verification email. Returns true on a 2xx from Resend, false on any failure / no-op. */
export async function sendVerificationEmail(
  env: Env,
  input: { to: string; verifyUrl: string; displayName: string | null },
): Promise<boolean> {
  if (!emailConfigured(env)) return false;
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM ?? DEFAULT_FROM,
        to: input.to,
        subject: "Verify your smplmark email",
        html: verificationHtml(input.verifyUrl, input.displayName),
        text: verificationText(input.verifyUrl),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
