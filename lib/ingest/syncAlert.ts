/**
 * Optional alerting for sync job failures.
 * Supports Slack webhooks, email, or log file.
 * Rate-limited to prevent alert spam.
 */

interface AlertConfig {
  webhookUrl?: string; // Slack webhook or generic HTTP endpoint
  emailRecipients?: string[];
  logFilePath?: string;
  cooldownMinutes?: number; // Min time between alerts for same job
  failureThreshold?: number; // Alert if error rate > this (0-1)
}

interface AlertContext {
  jobName: string;
  error: string;
  attempts: number;
  durationMs: number;
  errorRate: number;
  isCritical: boolean;
}

const ALERT_COOLDOWNS = new Map<string, number>(); // jobName -> timestamp

function isOnCooldown(jobName: string, cooldownMinutes = 60): boolean {
  const lastAlertTime = ALERT_COOLDOWNS.get(jobName);
  if (!lastAlertTime) return false;

  const elapsedMinutes = (Date.now() - lastAlertTime) / (1000 * 60);
  return elapsedMinutes < cooldownMinutes;
}

function updateCooldown(jobName: string): void {
  ALERT_COOLDOWNS.set(jobName, Date.now());
}

/**
 * Send alert via Slack webhook (if configured).
 */
async function sendSlackAlert(
  webhookUrl: string,
  context: AlertContext
): Promise<void> {
  const color = context.isCritical ? "danger" : "warning";
  const emoji = context.isCritical ? "🚨" : "⚠️";

  const payload = {
    attachments: [
      {
        color,
        title: `${emoji} Sync Job Failed: ${context.jobName}`,
        text: context.error,
        fields: [
          {
            title: "Attempts",
            value: String(context.attempts),
            short: true,
          },
          {
            title: "Duration",
            value: `${context.durationMs}ms`,
            short: true,
          },
          {
            title: "Error Rate (24h)",
            value: `${(context.errorRate * 100).toFixed(1)}%`,
            short: true,
          },
          {
            title: "Severity",
            value: context.isCritical ? "Critical" : "Warning",
            short: true,
          },
        ],
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`Slack alert failed: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.error("Failed to send Slack alert:", error);
  }
}

/**
 * Log alert to file.
 */
async function logAlert(filePath: string, context: AlertContext): Promise<void> {
  try {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${context.jobName}: ${context.error} (${(context.errorRate * 100).toFixed(1)}% fail rate)\n`;

    // Use dynamic import to avoid adding fs dependency at module level
    const { appendFile } = await import("node:fs/promises");
    await appendFile(filePath, line);
  } catch (error) {
    console.error(`Failed to log alert to ${filePath}:`, error);
  }
}

/**
 * Notify on sync failure.
 * Rate-limited and configurable per channel.
 */
export async function notifyOnSyncFailure(
  context: AlertContext,
  config: AlertConfig = {}
): Promise<void> {
  const {
    webhookUrl,
    emailRecipients,
    logFilePath,
    cooldownMinutes = 60,
    failureThreshold = 0.5,
  } = config;

  // Determine criticality (tier 1 jobs block startup)
  const criticalJobs = [
    "security-listings",
    "nse-bhavcopy",
    "bse-bhavcopy",
    "refresh-quotes",
  ];
  context.isCritical =
    criticalJobs.includes(context.jobName) || context.errorRate > failureThreshold;

  // Check cooldown (prevent alert spam)
  if (isOnCooldown(context.jobName, cooldownMinutes)) {
    console.log(
      `[${context.jobName}] Still on cooldown, skipping alert (will try again after ${cooldownMinutes}m)`
    );
    return;
  }

  // Send alerts via configured channels
  if (webhookUrl) {
    await sendSlackAlert(webhookUrl, context);
  }

  if (logFilePath) {
    await logAlert(logFilePath, context);
  }

  if (emailRecipients && emailRecipients.length > 0) {
    // TODO: Implement email alerting
    console.log(`Would send email to ${emailRecipients.join(", ")}`);
  }

  // Update cooldown
  updateCooldown(context.jobName);
}

/**
 * Get alert config from environment variables.
 */
export function getAlertConfigFromEnv(): AlertConfig {
  return {
    webhookUrl: process.env.SYNC_ALERT_WEBHOOK_URL,
    emailRecipients: process.env.SYNC_ALERT_EMAIL_RECIPIENTS?.split(",").map((e) => e.trim()),
    logFilePath: process.env.SYNC_ALERT_LOG_FILE,
    cooldownMinutes: parseInt(process.env.SYNC_ALERT_COOLDOWN_MINUTES ?? "60", 10),
    failureThreshold: parseFloat(process.env.SYNC_FAILURE_THRESHOLD ?? "0.5"),
  };
}

/**
 * Clear cooldown for a job (useful for testing).
 */
export function clearCooldown(jobName: string): void {
  ALERT_COOLDOWNS.delete(jobName);
}

/**
 * Get current cooldown status (useful for testing).
 */
export function getCooldownStatus(jobName: string): { onCooldown: boolean; minutesRemaining: number } {
  const lastAlertTime = ALERT_COOLDOWNS.get(jobName);
  if (!lastAlertTime) {
    return { onCooldown: false, minutesRemaining: 0 };
  }

  const elapsedMinutes = (Date.now() - lastAlertTime) / (1000 * 60);
  const minutesRemaining = Math.max(0, Math.ceil(60 - elapsedMinutes));

  return {
    onCooldown: minutesRemaining > 0,
    minutesRemaining,
  };
}
