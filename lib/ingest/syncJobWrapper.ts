export interface SyncJobResult {
  success: boolean;
  detail?: unknown;
  error?: string;
  attempts: number;
  durationMs: number;
}

export interface SyncJobHealth {
  healthy: boolean;
  errorCount: number;
  okCount: number;
  errorRate: number;
}

export interface SyncJobOptions {
  maxRetries?: number;
  backoffMs?: number;
  timeoutMs?: number;
  allowPartialSuccess?: boolean;
  databaseUrl?: string; // Optional: for logging to cron_logs
}

const DEFAULT_OPTIONS = {
  maxRetries: 2,
  backoffMs: 1000,
  timeoutMs: 60000,
  allowPartialSuccess: false,
} as const;

/**
 * Exponential backoff with jitter: 1s, 2s, 4s, etc.
 * Jitter prevents thundering herd on distributed failures.
 */
function calculateBackoff(attempt: number, baseMs: number): number {
  const exponential = baseMs * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 0.1 * exponential; // ±10% jitter
  return exponential + jitter;
}

/**
 * Create a timeout promise that rejects after a delay.
 */
function createTimeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
  );
}

/**
 * Execute async function with exponential backoff retries, timeout, and logging.
 * Logs to cron_logs table if databaseUrl is provided.
 * Errors in logging are swallowed (never block the job).
 */
export async function runSyncJobWithRetry<T>(
  jobName: string,
  fn: () => Promise<T>,
  options: SyncJobOptions = {}
): Promise<SyncJobResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
    try {
      // Race the function against timeout
      const result = await Promise.race([
        fn(),
        createTimeout(opts.timeoutMs),
      ]);

      const durationMs = Date.now() - startTime;

      // Log successful attempt to cron_logs (if database URL provided)
      if (opts.databaseUrl) {
        await logSyncToDatabase(opts.databaseUrl, jobName, "ok", {
          detail: result,
          attempts: attempt,
        }, undefined, durationMs).catch(() => null);
      }

      return {
        success: true,
        detail: result,
        attempts: attempt,
        durationMs,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if this was the last attempt
      if (attempt === opts.maxRetries + 1) {
        const durationMs = Date.now() - startTime;

        // Log final failure to cron_logs (if database URL provided)
        if (opts.databaseUrl) {
          await logSyncToDatabase(opts.databaseUrl, jobName, "error", undefined, lastError.message, durationMs).catch(() => null);
        }

        return {
          success: false,
          error: lastError.message,
          attempts: attempt,
          durationMs,
        };
      }

      // Calculate backoff before next retry
      const backoffMs = calculateBackoff(attempt, opts.backoffMs);
      console.warn(
        `[${jobName}] Attempt ${attempt} failed: ${lastError.message}. Retrying in ${Math.round(backoffMs)}ms...`
      );

      // Wait before next attempt
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  // Should never reach here, but satisfy TypeScript
  throw lastError || new Error("Unknown error in sync job");
}

/**
 * Log sync result to cron_logs table.
 * Errors are swallowed (logging must never block or fail a job).
 */
async function logSyncToDatabase(
  databaseUrl: string,
  jobName: string,
  status: "ok" | "error",
  detail?: unknown,
  error?: string,
  durationMs?: number
): Promise<void> {
  const { logCronRun } = await import("@/lib/ingest/cronLog");

  try {
    await logCronRun(databaseUrl, {
      job: jobName as any,
      status,
      detail: detail as Record<string, unknown>,
      error: error ?? null,
      durationMs,
    });
  } catch {
    // Intentionally swallow logging errors
    console.debug(`[${jobName}] Failed to log to cron_logs (non-blocking)`);
  }
}

/**
 * Consistent error handling for sync failures.
 * Returns appropriate HTTP status code.
 * Note: Caller should log to cron_logs separately if needed.
 */
export function handleSyncFailure(
  error: Error | unknown,
  shouldBlock = false
): Response {
  const errorMessage = error instanceof Error ? error.message : String(error);

  if (shouldBlock) {
    // Return 503 for critical failures (blocks dependent jobs)
    return Response.json(
      { ok: false, error: errorMessage },
      { status: 503 }
    );
  }

  // Return 207 Partial Content for non-critical failures
  return Response.json(
    { ok: false, error: errorMessage, partial: true },
    { status: 207 }
  );
}

/**
 * Check if a sync job is healthy based on recent runs.
 * Note: Use syncMonitor.isSyncJobHealthy() for actual health checks.
 * This is kept for backward compatibility but delegates to syncMonitor.
 */
export async function isSyncJobHealthy(
  jobName: string,
  timeWindowHours = 24
): Promise<SyncJobHealth> {
  const { isSyncJobHealthy: checkHealth, getSyncTrend } = await import("@/lib/ingest/syncMonitor");

  try {
    const healthy = await checkHealth(jobName, timeWindowHours);
    const trend = await getSyncTrend(jobName, timeWindowHours);

    return {
      healthy,
      errorCount: trend.failureCount,
      okCount: trend.successCount,
      errorRate: trend.failureRate,
    };
  } catch {
    // Assume healthy if we can't check
    return {
      healthy: true,
      errorCount: 0,
      okCount: 0,
      errorRate: 0,
    };
  }
}

/**
 * Determine whether a dependent job should run based on upstream health.
 * Returns true if upstream is too unhealthy (should skip dependent job).
 */
export async function shouldSkipDependentJob(
  upstreamJobName: string,
  successRateThreshold = 0.8 // 80% success rate minimum
): Promise<boolean> {
  const { shouldSkipDependentJob: checkSkip } = await import("@/lib/ingest/syncMonitor");
  return checkSkip(upstreamJobName, successRateThreshold);
}
