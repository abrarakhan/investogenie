import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/app/AppShell";
import NewsRefreshButton from "@/components/screener/NewsRefreshButton";
import NewsSwingCandidates from "@/components/screener/NewsSwingCandidates";
import { getSessionUser } from "@/lib/auth";
import { getActiveAIConfig, getActiveNewsConfig } from "@/lib/credentials-actions";
import { normalizeMarket } from "@/lib/markets";
import { getNewsSwingWorkspace } from "@/lib/newsSwing";
import { getUserSwingSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function NewsSwingPage({ params }: { params: Promise<{ market: string }> }) {
  const { market: marketParam } = await params;
  const market = normalizeMarket(marketParam);
  if (!market) notFound();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const [settings, newsConfig, aiConfig] = await Promise.all([
    getUserSwingSettings(), getActiveNewsConfig(), getActiveAIConfig(),
  ]);
  const workspace = await getNewsSwingWorkspace(market, settings);
  const lastSync = workspace.lastFetchedAt
    ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(workspace.lastFetchedAt))
    : "Never";

  return (
    <AppShell
      email={user.email}
      market={market}
      active="news-swing"
      title="News & AI Swing"
      subtitle="Existing swing calculations, ranked through a time-decayed and source-linked event-risk overlay."
      actions={<NewsRefreshButton market={market} configured={Boolean(newsConfig)} />}
    >
      <div className="mb-6 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-start">
        <div className="border-l-2 border-[var(--ig-accent)] pl-4 text-sm leading-relaxed text-white/52">
          News can adjust rank by at most 20 points. It never creates a setup or changes technical entry, target, stop, OI, volume, or breakout calculations. Severe verified negatives can mark a candidate Risk-off.
        </div>
        <div className="text-xs text-white/38 lg:text-right">
          <div>{workspace.articleCount} recent articles · {workspace.impactCount} classified impacts</div>
          <div>Last fetched: {lastSync}</div>
        </div>
      </div>

      {!newsConfig && (
        <div className="mb-6 rounded-lg border border-amber-400/25 bg-amber-400/[0.05] p-4 text-sm text-amber-100/75">
          News ingestion is not configured. Add an Alpha Vantage, GNews, or NewsAPI key in <Link href="/settings" className="font-semibold text-[var(--ig-accent)] underline">Settings</Link>. Technical candidates remain visible with a zero news adjustment.
        </div>
      )}
      {newsConfig && !aiConfig && (
        <div className="mb-6 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.04] p-4 text-sm text-cyan-100/70">
          No AI model key is configured. Headlines are linked with provider sentiment and a transparent keyword fallback until an AI model is added in Settings.
        </div>
      )}

      <NewsSwingCandidates candidates={workspace.candidates} />
    </AppShell>
  );
}
