/**
 * Server-only email digest delivery. getEnabledEmailPreferences reads every
 * user's preferences and sendEmailDigest decrypts a user's SMTP password, so
 * neither may be a browser-callable Server Action. Cron routes only.
 */
import "server-only";
import { tenantQuery, tenantQueryOne, workerQuery } from "@/lib/db";
import { buildEmailHtml, type EmailDigestData } from "@/lib/email/digest-template";
import { sendEmailWithConfig } from "@/lib/email/nodemailer-service";
import { getProbabilitySummary } from "@/lib/probability-runtime";
import { getUserSwingSettings } from "@/lib/settings";
import { getStrongSwingCandidates, type StrongSwingCandidate } from "@/features/strong-swing/service";
import { swingSettingsKey } from "@/lib/displayScanCache";
import type { EmailPreferences } from "@/lib/email-actions";

export interface EmailDigestBatchCache {
  strongSwingBySettings: Map<string, Promise<StrongSwingCandidate[]>>;
  probability?: Promise<Awaited<ReturnType<typeof getProbabilitySummary>>>;
}

export function createEmailDigestBatchCache(): EmailDigestBatchCache {
  return { strongSwingBySettings: new Map() };
}

export async function claimEmailDigest(userId: string, marketDate: string): Promise<boolean> {
  const rows = await tenantQuery<{ user_id: string }>(userId,
    `insert into public.email_digest_deliveries(user_id,market_date,status)
     values($1,$2,'PROCESSING') on conflict do nothing returning user_id`,
    [userId, marketDate],
  );
  return rows.length === 1;
}

export async function finishEmailDigest(
  userId: string,
  marketDate: string,
  status: "SENT" | "FAILED",
  error?: string,
): Promise<void> {
  await tenantQuery(userId,
    `update public.email_digest_deliveries
        set status=$3,completed_at=now(),error=$4
      where user_id=$1 and market_date=$2`,
    [userId, marketDate, status, error?.slice(0, 1000) ?? null],
  );
}

/** Fetch users who have email digest enabled and should receive today's email. */
export async function getEnabledEmailPreferences(): Promise<
  (EmailPreferences & { userName: string })[]
> {
  const results = await workerQuery<{
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
export async function sendEmailDigest(userId: string, batchCache?: EmailDigestBatchCache): Promise<void> {
  const prefs = await tenantQueryOne<{
    id: string;
    user_id: string;
    enabled: boolean;
    email: string;
    send_time: string;
    include_swing_candidates: boolean;
    include_probability: boolean;
    last_sent_at: Date | null;
  }>(userId,
    `select * from public.email_preferences where user_id = $1`,
    [userId],
  );

  if (!prefs || !prefs.enabled) return;

  // Get SMTP credentials from database
  const smtpCreds = await tenantQueryOne<{
    smtp_host: string;
    smtp_port: number;
    smtp_user: string;
    smtp_password_encrypted: string;
  }>(userId,
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
  const loadStrong = () => {
    if (!batchCache) return getStrongSwingCandidates("IN", settings);
    const key = swingSettingsKey(settings);
    let pending = batchCache.strongSwingBySettings.get(key);
    if (!pending) {
      pending = getStrongSwingCandidates("IN", settings);
      batchCache.strongSwingBySettings.set(key, pending);
    }
    return pending;
  };
  const strongSwingCandidates = prefs.include_swing_candidates
    ? (await loadStrong()).slice(0, 5)
    : [];

  // Probability forecasts — the SAME source as the Probability screen:
  // getProbabilitySummary(), already ranked by probability of an up move.
  const loadProbability = () => {
    if (!batchCache) return getProbabilitySummary("IN");
    batchCache.probability ??= getProbabilitySummary("IN");
    return batchCache.probability;
  };
  const probabilityCandidates = prefs.include_probability
    ? (await loadProbability()).rows.slice(0, 5)
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
  await tenantQuery(userId,
    `update public.email_preferences set last_sent_at = now() where user_id = $1`,
    [userId],
  );
}
