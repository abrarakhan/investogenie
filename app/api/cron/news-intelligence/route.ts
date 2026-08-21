import { type NextRequest, NextResponse } from "next/server";
import { getSystemAIConfig, getSystemNewsConfig } from "@/lib/credentials-actions";
import { checkCronAuth, logCronRun } from "@/lib/ingest/cronLog";
import { refreshNewsIntelligence } from "@/lib/news/sync";
import type { MarketId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(request: NextRequest) {
  const started = Date.now();
  const auth = checkCronAuth(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.reason }, { status: auth.status });
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return NextResponse.json({ ok: false, error: "DATABASE_URL not configured" }, { status: 500 });
  const requested = request.nextUrl.searchParams.get("market")?.toUpperCase();
  const markets: MarketId[] = requested === "IN" || requested === "US" ? [requested] : ["IN", "US"];
  try {
    const [news, ai] = await Promise.all([getSystemNewsConfig(), getSystemAIConfig()]);
    if (!news) {
      await logCronRun(databaseUrl, {
        job: "news-intelligence", status: "skipped",
        detail: { reason: "news API not configured" }, durationMs: Date.now() - started,
      });
      return NextResponse.json({ ok: true, skipped: true, reason: "news API not configured" });
    }
    const summaries = [];
    for (const market of markets) summaries.push(await refreshNewsIntelligence(market, news, ai));
    await logCronRun(databaseUrl, {
      job: "news-intelligence", status: "ok", detail: { summaries }, durationMs: Date.now() - started,
    });
    return NextResponse.json({ ok: true, summaries });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logCronRun(databaseUrl, {
      job: "news-intelligence", status: "error", error: message, durationMs: Date.now() - started,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
