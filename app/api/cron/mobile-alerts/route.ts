import { type NextRequest, NextResponse } from "next/server";
import { checkCronAuth, logCronRun } from "@/lib/ingest/cronLog";
import { dispatchMobileTradeAlerts } from "@/lib/mobileAlerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const started = Date.now();
  const auth = checkCronAuth(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.reason }, { status: auth.status });
  const requested = request.nextUrl.searchParams.get("market")?.toUpperCase();
  const markets: Array<"IN" | "US"> = requested === "IN" || requested === "US" ? [requested] : ["IN", "US"];
  try {
    const summary = await dispatchMobileTradeAlerts(markets);
    if (process.env.DATABASE_URL) await logCronRun(process.env.DATABASE_URL, {
      job: "mobile-alerts", status: "ok", detail: summary, durationMs: Date.now() - started,
    });
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (process.env.DATABASE_URL) await logCronRun(process.env.DATABASE_URL, {
      job: "mobile-alerts", status: "error", error: message, durationMs: Date.now() - started,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
