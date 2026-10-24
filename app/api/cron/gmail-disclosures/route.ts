import { type NextRequest, NextResponse } from "next/server";
import { scanAllConnectedGmailDisclosures } from "@/lib/gmail/disclosures";
import { checkCronAuth, logCronRun } from "@/lib/ingest/cronLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(request: NextRequest) {
  const started = Date.now();
  const auth = checkCronAuth(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.reason }, { status: auth.status });
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return NextResponse.json({ ok: false, error: "DATABASE_URL not configured" }, { status: 500 });

  try {
    const result = await scanAllConnectedGmailDisclosures();
    const status = result.connections === 0 ? "skipped" : result.failed > 0 ? "error" : "ok";
    const detail = {
      connections: result.connections,
      successful: result.successful,
      failed: result.failed,
      messages: result.messages,
      attachments: result.attachments,
      processed: result.processed,
      imported: result.imported,
      review: result.review,
    };
    // Google's messages only; they carry no tokens. Without them the log said "failed=1" for weeks.
    const errors = result.results.filter((item) => item.error).map((item) => item.error!.slice(0, 300));
    await logCronRun(databaseUrl, {
      job: "gmail-disclosures",
      status,
      detail: { ...detail, errors },
      error: result.failed > 0 ? `${result.failed} Gmail connection(s) failed: ${errors.join(" | ")}`.slice(0, 1000) : null,
      durationMs: Date.now() - started,
    });
    return NextResponse.json({ ok: result.failed === 0, skipped: result.connections === 0, ...detail, errors });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await logCronRun(databaseUrl, {
      job: "gmail-disclosures", status: "error", error: message, durationMs: Date.now() - started,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
