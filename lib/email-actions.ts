"use server";

import { getSessionUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { buildEmailHtml, type EmailDigestData } from "@/lib/email/digest-template";
import { sendEmailWithConfig } from "@/lib/email/nodemailer-service";
import { runScreener } from "@/lib/screener";
import { getProbabilitySummary } from "@/lib/probability-runtime";
import { DEFAULT_SETTINGS } from "@/lib/settings";

export interface EmailPreferences {
  id: string;
  userId: string;
  enabled: boolean;
  email: string;
  sendTime: string;
  includeSwingCandidates: boolean;
  includeProbability: boolean;
  lastSentAt: Date | null;
}

/** Get email preferences for the current user. */
export async function getEmailPreferences(): Promise<EmailPreferences | null> {
  const user = await getSessionUser();
  if (!user) return null;

  const result = await queryOne<{
    id: string;
    user_id: string;
    enabled: boolean;
    email: string;
    send_time: string;
    include_swing_candidates: boolean;
    include_probability: boolean;
    last_sent_at: Date | null;
  }>(
    `select id, user_id, enabled, email, send_time, include_swing_candidates,
            include_probability, last_sent_at
     from public.email_preferences
     where user_id = $1`,
    [user.id],
  );

  if (!result) return null;

  return {
    id: result.id,
    userId: result.user_id,
    enabled: result.enabled,
    email: result.email,
    sendTime: result.send_time,
    includeSwingCandidates: result.include_swing_candidates,
    includeProbability: result.include_probability,
    lastSentAt: result.last_sent_at,
  };
}

/** Create or update email preferences for the current user. */
export async function updateEmailPreferences(updates: {
  enabled?: boolean;
  sendTime?: string;
  includeSwingCandidates?: boolean;
  includeProbability?: boolean;
}): Promise<EmailPreferences> {
  const user = await getSessionUser();
  if (!user) throw new Error("Not signed in");

  const existing = await getEmailPreferences();

  if (!existing) {
    // Create new preferences
    const result = await queryOne<{
      id: string;
      user_id: string;
      enabled: boolean;
      email: string;
      send_time: string;
      include_swing_candidates: boolean;
      include_probability: boolean;
      last_sent_at: Date | null;
    }>(
      `insert into public.email_preferences (user_id, email, enabled, send_time,
        include_swing_candidates, include_probability)
       values ($1, $2, $3, $4, $5, $6)
       returning *`,
      [
        user.id,
        user.email,
        updates.enabled ?? false,
        updates.sendTime ?? "07:00",
        updates.includeSwingCandidates ?? true,
        updates.includeProbability ?? true,
      ],
    );

    if (!result) throw new Error("Failed to create email preferences");
    return mapEmailPreferences(result);
  }

  // Update existing
  const result = await queryOne<{
    id: string;
    user_id: string;
    enabled: boolean;
    email: string;
    send_time: string;
    include_swing_candidates: boolean;
    include_probability: boolean;
    last_sent_at: Date | null;
  }>(
    `update public.email_preferences
     set enabled = coalesce($2, enabled),
         send_time = coalesce($3, send_time),
         include_swing_candidates = coalesce($4, include_swing_candidates),
         include_probability = coalesce($5, include_probability),
         updated_at = now()
     where user_id = $1
     returning *`,
    [
      user.id,
      updates.enabled ?? null,
      updates.sendTime ?? null,
      updates.includeSwingCandidates ?? null,
      updates.includeProbability ?? null,
    ],
  );

  if (!result) throw new Error("Failed to update email preferences");
  return mapEmailPreferences(result);
}

function mapEmailPreferences(result: {
  id: string;
  user_id: string;
  enabled: boolean;
  email: string;
  send_time: string;
  include_swing_candidates: boolean;
  include_probability: boolean;
  last_sent_at: Date | null;
}): EmailPreferences {
  return {
    id: result.id,
    userId: result.user_id,
    enabled: result.enabled,
    email: result.email,
    sendTime: result.send_time,
    includeSwingCandidates: result.include_swing_candidates,
    includeProbability: result.include_probability,
    lastSentAt: result.last_sent_at,
  };
}

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

  // Swing candidates — the SAME source and args as the Swing Candidates screen:
  // runScreener() over the NSE universe, buy-only, capped at 20. We fetch the
  // full 20 (so SHORT-biased rows filtered out of the top scores don't starve
  // the list) and take the top 5 the screen would show first.
  const buyOnlySettings = { ...DEFAULT_SETTINGS, includeShort: false };
  const swingCandidates = prefs.include_swing_candidates
    ? (await runScreener("IN", buyOnlySettings, { exchange: "NSE", limit: 20 })).slice(0, 5)
    : [];

  // Probability forecasts — the SAME source as the Probability screen:
  // getProbabilitySummary(), already ranked by probability of an up move.
  const probabilityCandidates = prefs.include_probability
    ? (await getProbabilitySummary("IN")).rows.slice(0, 5)
    : [];

  const digestData: EmailDigestData = {
    userName: prefs.email.split("@")[0],
    userEmail: prefs.email,
    swingCandidates,
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
