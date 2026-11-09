"use server";

import { getSessionUser } from "@/lib/auth";
import { queryOne } from "@/lib/db";

// Every export of this "use server" module is a browser-callable Server Action.
// Cross-user digest delivery lives in lib/email-digest.server.ts.

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
