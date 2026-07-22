// Best-effort persistent logger for scheduled cron runs. Writes one row per
// execution to public.cron_logs over the direct Postgres connection (bypassing
// RLS). Deliberately swallows its own errors: a logging failure must never be
// the reason a job reports failure.
import { Client } from "pg";

export type CronJob =
  | "refresh-quotes"
  | "scan"
  | "backfill-us"
  | "backfill-us-expand"
  | "backfill-nse"
  | "backfill-bse"
  | "backfill_ohlcv"
  | "backfill_ohlcv_cron"
  | "refresh-screener"
  | "forward-test";
export type CronStatus = "ok" | "error" | "skipped";

export interface CronLogEntry {
  job: CronJob;
  status: CronStatus;
  detail?: Record<string, unknown>;
  error?: string | null;
  durationMs?: number | null;
}

export async function logCronRun(databaseUrl: string, entry: CronLogEntry): Promise<void> {
  let client: Client | null = null;
  try {
    client = new Client({ connectionString: databaseUrl, ssl: /127\.0\.0\.1|localhost/.test(databaseUrl) ? false : { rejectUnauthorized: false } });
    await client.connect();
    await client.query(
      `insert into public.cron_logs (job, status, detail, error, duration_ms)
       values ($1, $2, $3::jsonb, $4, $5)`,
      [
        entry.job,
        entry.status,
        JSON.stringify(entry.detail ?? {}),
        entry.error ?? null,
        entry.durationMs ?? null,
      ],
    );
  } catch (err) {
    // Never throw from the logger — surface to stderr for Vercel logs and move on.
    console.error(`[cronLog] failed to record ${entry.job}/${entry.status}:`, err);
  } finally {
    if (client) await client.end().catch(() => {});
  }
}

/**
 * Strict CRON_SECRET gate. Returns null when authorized, or a reason string when
 * not (caller maps reason -> 401/500). Requires the secret to be CONFIGURED:
 * an unset secret is treated as a misconfiguration, never as "open".
 */
export function checkCronAuth(
  authHeader: string | null,
  secret: string | undefined,
): { ok: true } | { ok: false; status: number; reason: string } {
  if (!secret) {
    return { ok: false, status: 500, reason: "CRON_SECRET not configured" };
  }
  if (authHeader !== `Bearer ${secret}`) {
    return { ok: false, status: 401, reason: "unauthorized" };
  }
  return { ok: true };
}
