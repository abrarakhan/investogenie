import { query, queryOne } from "@/lib/db";

export interface SyncStatus {
  jobName: string;
  lastRun?: {
    status: "ok" | "error";
    detail?: unknown;
    error?: string;
    attempts: number;
    durationMs: number;
    createdAt: string;
  };
  errorCount: number;
  okCount: number;
  errorRate: number;
  averageDurationMs: number;
}

export interface SyncTrend {
  jobName: string;
  timeWindowHours: number;
  successCount: number;
  failureCount: number;
  skipCount: number;
  successRate: number; // 0-1
  failureRate: number; // 0-1
  averageDurationMs: number;
  trends: Array<{
    date: string;
    status: "ok" | "error" | "skipped";
    count: number;
    averageDurationMs: number;
  }>;
}

/**
 * Get the last sync attempt for a job.
 */
export async function getLastSyncStatus(
  jobName: string
): Promise<SyncStatus["lastRun"] | null> {
  try {
    const row = await queryOne<{
      status: "ok" | "error";
      detail: unknown;
      error: string | null;
      created_at: string;
      duration_ms: number;
    }>(
      `SELECT status, detail, error, created_at, duration_ms
       FROM public.cron_logs
       WHERE job = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [jobName]
    );

    if (!row) return null;

    return {
      status: row.status,
      detail: row.detail,
      error: row.error ?? undefined,
      attempts: (row.detail as any)?.attempts ?? 1,
      durationMs: row.duration_ms,
      createdAt: row.created_at,
    };
  } catch {
    return null;
  }
}

/**
 * Get sync health stats over a time window.
 */
export async function getSyncTrend(
  jobName: string,
  hours = 24
): Promise<SyncTrend> {
  try {
    const rows = await query<{
      status: "ok" | "error" | "skipped";
      count: number;
      avg_duration: number;
    }>(
      `SELECT
         status,
         COUNT(*) as count,
         AVG(duration_ms) as avg_duration
       FROM public.cron_logs
       WHERE job = $1
         AND created_at > NOW() - INTERVAL '${hours} hours'
       GROUP BY status`,
      [jobName]
    );

    let successCount = 0;
    let failureCount = 0;
    let skipCount = 0;
    let totalDuration = 0;
    let totalCount = 0;

    for (const row of rows) {
      if (row.status === "ok") successCount = row.count;
      else if (row.status === "error") failureCount = row.count;
      else if (row.status === "skipped") skipCount = row.count;

      totalDuration += (row.avg_duration ?? 0) * row.count;
      totalCount += row.count;
    }

    return {
      jobName,
      timeWindowHours: hours,
      successCount,
      failureCount,
      skipCount,
      successRate: totalCount > 0 ? successCount / totalCount : 1,
      failureRate: totalCount > 0 ? failureCount / totalCount : 0,
      averageDurationMs: totalCount > 0 ? Math.round(totalDuration / totalCount) : 0,
      trends: rows.map((r) => ({
        date: jobName,
        status: r.status,
        count: r.count,
        averageDurationMs: Math.round(r.avg_duration ?? 0),
      })),
    };
  } catch {
    return {
      jobName,
      timeWindowHours: hours,
      successCount: 0,
      failureCount: 0,
      skipCount: 0,
      successRate: 1,
      failureRate: 0,
      averageDurationMs: 0,
      trends: [],
    };
  }
}

/**
 * Check if a sync job is healthy (low failure rate).
 * Returns false if error rate exceeds threshold.
 */
export async function isSyncJobHealthy(
  jobName: string,
  timeWindowHours = 24,
  errorRateThreshold = 0.2 // 20% failure = unhealthy
): Promise<boolean> {
  try {
    const trend = await getSyncTrend(jobName, timeWindowHours);
    return trend.failureRate <= errorRateThreshold;
  } catch {
    return true; // Assume healthy if we can't check
  }
}

/**
 * Determine whether a dependent job should skip based on upstream health.
 * Returns true if upstream is too unhealthy to run dependent job.
 */
export async function shouldSkipDependentJob(
  upstreamJobName: string,
  successRateThreshold = 0.8 // 80% minimum success rate
): Promise<boolean> {
  try {
    const trend = await getSyncTrend(upstreamJobName, 24);
    const successRate = trend.successCount / (trend.successCount + trend.failureCount || 1);
    return successRate < successRateThreshold;
  } catch {
    return false; // Don't skip if we can't check
  }
}

/**
 * Print a summary of recent sync job health to console (for startup logging).
 */
export async function reportSyncHealthToConsole(jobNames: string[] = []): Promise<void> {
  try {
    // Fetch top jobs if none specified
    if (jobNames.length === 0) {
      const topJobs = await query<{ job: string }>(
        `SELECT DISTINCT job FROM public.cron_logs
         ORDER BY MAX(created_at) DESC LIMIT 10`,
        []
      );
      jobNames = topJobs.map((r) => r.job);
    }

    console.log("\n=== Sync Health Summary ===");

    for (const jobName of jobNames) {
      const trend = await getSyncTrend(jobName, 24);
      const lastStatus = await getLastSyncStatus(jobName);

      const statusEmoji =
        trend.failureRate === 0 ? "✓" : trend.failureRate < 0.2 ? "⚠" : "✗";
      const lastTime = lastStatus?.createdAt
        ? new Date(lastStatus.createdAt).toLocaleString("en-IN")
        : "never";

      console.log(
        `${statusEmoji} ${jobName}: ${trend.successCount}✓ ${trend.failureCount}✗ (${(trend.failureRate * 100).toFixed(0)}% fail) — last: ${lastTime}`
      );
    }

    console.log("=========================\n");
  } catch (error) {
    console.error("Failed to report sync health:", error);
  }
}

/**
 * Get detailed sync history for a job (for debugging).
 */
export async function getSyncHistory(
  jobName: string,
  limit = 10
): Promise<
  Array<{
    status: string;
    detail?: unknown;
    error?: string;
    durationMs: number;
    createdAt: string;
  }>
> {
  try {
    const rows = await query<{
      status: string;
      detail: unknown;
      error: string | null;
      duration_ms: number;
      created_at: string;
    }>(
      `SELECT status, detail, error, duration_ms, created_at
       FROM public.cron_logs
       WHERE job = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [jobName, limit]
    );

    return rows.map((r) => ({
      status: r.status,
      detail: r.detail,
      error: r.error ?? undefined,
      durationMs: r.duration_ms,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}
