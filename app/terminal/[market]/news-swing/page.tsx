import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/app/AppShell";
import NewsRefreshButton from "@/components/screener/NewsRefreshButton";
import NewsSwingCandidates from "@/components/screener/NewsSwingCandidates";
import { getSessionUser } from "@/lib/auth";
import { getActiveAIConfig, getActiveNewsConfigs } from "@/lib/credentials.server";
import { normalizeMarket } from "@/lib/markets";
import { getNewsSwingWorkspace, type NewsSourcePool } from "@/lib/newsSwing";
import { getUserSwingSettings } from "@/lib/settings";
import MarketDataAutoRefresh from "@/components/app/MarketDataAutoRefresh";
import { markLiveMarketTargets } from "@/lib/liveMarketTargets";

export const dynamic = "force-dynamic";

function parseSource(raw: string | undefined, market: "IN" | "US"): NewsSourcePool {
  if (raw === "SWING") return "SWING";
  if (raw === "TREND_CONTINUATION" && market === "IN") return "TREND_CONTINUATION";
  return "STRONG_SWING";
}

export default async function NewsSwingPage({
  params,
  searchParams,
}: {
  params: Promise<{ market: string }>;
  searchParams: Promise<{ source?: string }>;
}) {
  const { market: marketParam } = await params;
  const { source: rawSource } = await searchParams;
  const market = normalizeMarket(marketParam);
  if (!market) notFound();
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const source = parseSource(rawSource, market);
  const [settings, newsConfig, aiConfig] = await Promise.all([
    getUserSwingSettings(), getActiveNewsConfigs(), getActiveAIConfig(),
  ]);
  const workspace = await getNewsSwingWorkspace(market, settings, source);
  await markLiveMarketTargets(workspace.candidates.map((candidate) => candidate.assetId), "news_swing");
  const lastSync = workspace.lastFetchedAt
    ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(workspace.lastFetchedAt))
    : "Never";

  const sourceTabs: Array<{ key: NewsSourcePool; label: string }> = [
    { key: "STRONG_SWING", label: "Strong Swing" },
    { key: "SWING", label: "Swing" },
    ...(market === "IN" ? [{ key: "TREND_CONTINUATION" as const, label: "Mid-Way / Continuation" }] : []),
  ];

  return (
    <AppShell
      email={user.email}
      market={market}
      active="news-swing"
      title="News & AI Swing"
      subtitle="Filter Swing, Strong Swing, and Mid-Way candidates through time-decayed market news, AI sentiment, and upcoming results risk."
      actions={<NewsRefreshButton market={market} configured={newsConfig.length > 0} />}
    >
      <MarketDataAutoRefresh market={market} assetIds={workspace.candidates.map((candidate) => candidate.assetId)} />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {sourceTabs.map((tab) => {
          const active = tab.key === workspace.source;
          return (
            <Link
              key={tab.key}
              href={`/terminal/${marketParam.toLowerCase()}/news-swing?source=${tab.key}`}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                active
                  ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-200"
                  : "border-white/10 text-white/55 hover:border-white/25 hover:text-white"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <div className="mb-6 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-start">
        <div className="border-l-2 border-[var(--ig-accent)] pl-4 text-sm leading-relaxed text-white/52">
          Technical engines define the setup and frozen levels; News &amp; AI adjusts rank by at most ±20 points, flags upcoming results within 3 days, and separates <strong className="text-emerald-300">Keep / Favored</strong> setups from <strong className="text-amber-200">Caution</strong> and <strong className="text-rose-300">Filtered-out (Risk-off)</strong> stocks.
        </div>
        <div className="text-xs text-white/38 lg:text-right">
          <div>{workspace.articleCount} recent articles · {workspace.impactCount} classified impacts</div>
          <div>Last fetched: {lastSync}</div>
        </div>
      </div>

      {!newsConfig.length && (
        <div className="mb-6 rounded-lg border border-amber-400/25 bg-amber-400/[0.05] p-4 text-sm text-amber-100/75">
          News ingestion is not configured. Add an Alpha Vantage, GNews, or NewsAPI key in <Link href="/settings" className="font-semibold text-[var(--ig-accent)] underline">Settings</Link>. Technical candidates remain visible with a zero news adjustment.
        </div>
      )}
      {newsConfig.length > 0 && !aiConfig && (
        <div className="mb-6 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.04] p-4 text-sm text-cyan-100/70">
          No AI model key is configured. Headlines are linked with provider sentiment and a transparent keyword fallback until an AI model is added in Settings.
        </div>
      )}

      <NewsSwingCandidates candidates={workspace.candidates} />
    </AppShell>
  );
}
