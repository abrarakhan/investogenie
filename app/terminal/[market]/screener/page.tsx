import { notFound, redirect } from "next/navigation";
import { runScreener } from "@/lib/screener";
import { getUserSwingSettings } from "@/lib/settings";
import ScreenerTable from "@/components/screener/ScreenerTable";
import AppShell from "@/components/app/AppShell";
import MarketDataAutoRefresh from "@/components/app/MarketDataAutoRefresh";
import { getSessionUser } from "@/lib/auth";
import { MARKET_COUNTRY, normalizeMarket } from "@/lib/markets";
import { markLiveMarketTargets } from "@/lib/liveMarketTargets";

export const dynamic = "force-dynamic";

export default async function TerminalScreener({
  params,
}: {
  params: Promise<{ market: string }>;
}) {
  const { market: marketParam } = await params;
  const marketId = normalizeMarket(marketParam);
  if (!marketId) notFound();
  const country = MARKET_COUNTRY[marketId];
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const isUS = marketId === "US";
  const settings = await getUserSwingSettings();
  const buyOnlySettings = { ...settings, includeShort: false };
  // India: NSE only, every buy-side classifier setup (no row cap), ranked by
  // score and then by normalized breakout quality.
  // Strategy views are selected from each strategy's own buy matches, uncapped,
  // so a match the default classifier ranks low (or flags no setup) still shows.
  const [rows, strategyRows] = await Promise.all([
    runScreener(country, buyOnlySettings, isUS ? {} : { exchange: "NSE", setupsOnly: true }),
    runScreener(country, buyOnlySettings, isUS ? { strategyMatches: true } : { exchange: "NSE", strategyMatches: true }),
  ]);
  // Every listed match joins the bounded live WebSocket feed, which keeps its quote fresh
  // enough to pass the screener's intraday freshness gate.
  await markLiveMarketTargets([...rows, ...strategyRows].map((row) => row.assetId), "swing");

  return (
    <AppShell
      email={user.email ?? ""}
      market={marketId}
      active="swing"
      title="Swing Candidates"
      subtitle="Buy-side swing candidates ranked inside the selected market workspace."
    >
      {/* The browser's Breeze REST refresh stays on the default top rows to bound API calls. */}
      <MarketDataAutoRefresh market={marketId} assetIds={rows.slice(0, 20).map((row) => row.assetId)} />
      <div className="mb-8">
        <p className="max-w-2xl text-white/50">
            {isUS ? (
              <>
                Buy-side swing candidates, precomputed nightly across the S&P 100
                subset. Breakouts and volatility squeezes are flagged; an OI
                build-up upgrades a breakout to a confirmed buy candidate.
              </>
            ) : (
              <>
                Every buy-side setup the classifier finds across the NSE universe,
                ranked by score and then by breakout clearance, volume expansion
                and relative strength. Cash stocks have no open interest, so a
                volume build-up confirms them instead.
                The strategy ribbon lists every NSE buy match of a legendary
                system — Qullamaggie, Minervini, Darvas, PTJ, or Simons.
              </>
            )}
        </p>
        {isUS && (
          <p className="mt-2 text-xs text-amber-300/70">
            Note: US bars are an anchored demo feed (free US EOD providers block
            scripted access here).
          </p>
        )}
      </div>

      <ScreenerTable rows={rows} strategyRows={strategyRows} scoped />
    </AppShell>
  );
}
