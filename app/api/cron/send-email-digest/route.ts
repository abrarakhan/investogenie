import { NextResponse } from "next/server";
import {
  claimEmailDigest,
  createEmailDigestBatchCache,
  finishEmailDigest,
  getEnabledEmailPreferences,
  sendEmailDigest,
} from "@/lib/email-digest.server";
import { logCronRun } from "@/lib/ingest/cronLog";
import { zonedMarketClock } from "@/lib/market-calendar.mjs";

export const maxDuration = 300; // 5 minutes

/**
 * Daily email digest sender. Runs at 7 AM IST.
 *
 * Sends an email with the top 5 stocks from Strong Swing and
 * probability screens to each user who has opted in.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  let sentCount = 0;
  let errorCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];
  const marketDate = zonedMarketClock("IN").date;

  try {
    const enabledUsers = await getEnabledEmailPreferences();
    const batchCache = createEmailDigestBatchCache();

    for (const user of enabledUsers) {
      if (!(await claimEmailDigest(user.userId, marketDate))) {
        skippedCount++;
        continue;
      }
      try {
        await sendEmailDigest(user.userId, batchCache);
        await finishEmailDigest(user.userId, marketDate, "SENT");
        sentCount++;
      } catch (err) {
        errorCount++;
        const msg = err instanceof Error ? err.message : String(err);
        await finishEmailDigest(user.userId, marketDate, "FAILED", msg).catch(() => undefined);
        errors.push(`${user.email}: ${msg}`);
        console.error(`Failed to send digest to ${user.email}:`, err);
      }
    }
  } catch (err) {
    console.error("Email digest cron failed:", err);
    const duration = Date.now() - startTime;
    await logCronRun(process.env.DATABASE_URL || "", {
      job: "send-email-digest",
      status: "error",
      durationMs: duration,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Unknown error",
        status: "failed",
      },
      { status: 500 },
    );
  }

  const duration = Date.now() - startTime;
  await logCronRun(process.env.DATABASE_URL || "", {
    job: "send-email-digest",
    status: errorCount === 0 ? "ok" : "error",
    durationMs: duration,
    detail: { sent: sentCount, skipped: skippedCount, errors: errorCount, errorList: errors },
  });

  return NextResponse.json({
    status: errorCount === 0 ? "success" : "partial",
    sent: sentCount,
    skipped: skippedCount,
    errors: errorCount,
    duration: `${duration}ms`,
    errorList: errors,
  });
}
