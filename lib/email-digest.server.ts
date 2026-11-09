/**
 * Server-only email digest delivery. getEnabledEmailPreferences reads every
 * user's preferences and sendEmailDigest decrypts a user's SMTP password, so
 * neither may be a browser-callable Server Action. Cron routes only.
 */
import "server-only";
import { query, queryOne } from "@/lib/db";
import { buildEmailHtml, type EmailDigestData } from "@/lib/email/digest-template";
import { sendEmailWithConfig } from "@/lib/email/nodemailer-service";
import { getProbabilitySummary } from "@/lib/probability-runtime";
import { getUserSwingSettings } from "@/lib/settings";
import { getStrongSwingCandidates } from "@/lib/strongSwing";
import type { EmailPreferences } from "@/lib/email-actions";

/** Fetch users who have email digest enabled and should receive today's email. */
export async function getEnabledEmailPreferences(): Promise<
  (EmailPreferences & { userName: string })[]
> {
  const results = await query<{
    id: string;
    user_id: string;
    enabled: boolean;
    email: string;
    send_time: string;
    include_swing_candidates: boolean;
    include_probability: boolean;
    last_sent_at: Date | null;
    user_email: string;
  }>(
    `select ep.*, u.email as user_email
     from public.email_preferences ep
     join public.users u on ep.user_id = u.id
     where ep.enabled = true`,
  );

  return results.map((r) => ({
    id: r.id,
    userId: r.user_id,
    enabled: r.enabled,
    email: r.email,
    sendTime: r.send_time,
    includeSwingCandidates: r.include_swing_candidates,
    includeProbability: r.include_probability,
    lastSentAt: r.last_sent_at,
    userName: r.user_email.split("@")[0],
  }));
}

/** Send email digest to a user. */
export async function sendEmailDigest(userId: string): Promise<void> {
  const prefs = await queryOne<{
    id: string;
    user_id: string;
    enabled: boolean;
    email: string;
    send_time: string;
    include_swing_candidates: boolean;
    include_probability: boolean;
    last_sent_at: Date | null;
  }>(
    `select * from public.email_preferences where user_id = $1`,
    [userId],
  );

  if (!prefs || !prefs.enabled) return;

  // Get SMTP credentials from database
  const smtpCreds = await queryOne<{
    smtp_host: string;
    smtp_port: number;
    smtp_user: string;
    smtp_password_encrypted: string;
  }>(
    `select smtp_host, smtp_port, smtp_user, smtp_password_encrypted
     from public.user_credentials where user_id = $1`,
    [userId],
  );

  if (!smtpCreds?.smtp_host || !smtpCreds.smtp_user || !smtpCreds.smtp_password_encrypted) {
    throw new Error("SMTP credentials not configured for user");
  }

  // Import crypto here to avoid circular dependency
  const { decryptCredential } = await import("@/lib/crypto/credentials");
  const smtpPassword = decryptCredential(smtpCreds.smtp_password_encrypted);

  // Strong Swing candidates — the same server-authoritative source, user risk
  // settings, confirmation gates, and order as the Strong Swing screen.
  const settings = await getUserSwingSettings(userId);
  const strongSwingCandidates = prefs.include_swing_candidates
    ? (await getStrongSwingCandidates("IN", settings)).slice(0, 5)
    : [];

  // Probability forecasts — the SAME source as the Probability screen:
  // getProbabilitySummary(), already ranked by probability of an up move.
  const probabilityCandidates = prefs.include_probability
    ? (await getProbabilitySummary("IN")).rows.slice(0, 5)
    : [];

  const digestData: EmailDigestData = {
    userName: prefs.email.split("@")[0],
    userEmail: prefs.email,
    strongSwingCandidates,
    probabilityCandidates,
    generatedAt: new Date(),
  };

  const html = buildEmailHtml(digestData);

  // Send with database credentials
  await sendEmailWithConfig(
    {
      host: smtpCreds.smtp_host,
      port: smtpCreds.smtp_port || 587,
      user: smtpCreds.smtp_user,
      password: smtpPassword,
    },
    {
      to: prefs.email,
      subject: `InvestoGenie Daily Digest - ${new Date().toLocaleDateString("en-IN")}`,
      html,
    },
  );

  // Update last_sent_at
  await query(
    `update public.email_preferences set last_sent_at = now() where user_id = $1`,
    [userId],
  );
}
