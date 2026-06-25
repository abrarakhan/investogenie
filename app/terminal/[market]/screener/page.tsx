import Link from "next/link";
import { notFound } from "next/navigation";
import { runScreener } from "@/lib/screener";
import { getUserSwingSettings } from "@/lib/settings";
import ScreenerTable from "@/components/screener/ScreenerTable";
import ApplyMarketTheme from "@/components/terminal/ApplyMarketTheme";
import { MARKETS, MARKET_COUNTRY, normalizeMarket } from "@/lib/markets";

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
  const cfg = MARKETS[marketId];

  const isUS = marketId === "US";
  const settings = await getUserSwingSettings();
  // India: NSE only, capped to the 20 highest-conviction swing candidates.
  const rows = await runScreener(
    country,
    settings,
    isUS ? {} : { exchange: "NSE", limit: 20 },
  );

  return (
    <div className="min-h-screen bg-[#05070d] text-white">
      <ApplyMarketTheme market={marketId} />
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#05070d]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-xl font-black tracking-tight">
            Investo<span className="text-[var(--ig-accent)]">Genie</span>
            <span className="ml-2 align-middle text-[10px] uppercase tracking-widest text-white/40">
              {cfg.label} Screener
            </span>
          </Link>
          <nav className="flex gap-5 text-sm text-white/60">
            <Link href={`/terminal/${marketId.toLowerCase()}`} className="hover:text-white">Terminal</Link>
            <Link href={`/terminal/${isUS ? "in" : "us"}/screener`} className="hover:text-white">
              {isUS ? "🇮🇳 India" : "🇺🇸 US"} screener
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">
            {cfg.flag} {cfg.label} Swing Screener{!isUS && " — Top 20"}
          </h1>
          <p className="mt-2 max-w-2xl text-white/50">
            {isUS ? (
              <>
                The derivative-aided swing classifier, precomputed nightly across
                the S&P 100 subset. Breakouts and volatility squeezes are flagged;
                an OI build-up upgrades a breakout to a validated long.
              </>
            ) : (
              <>
                The 20 highest-conviction swing candidates from the NSE universe,
                ranked by the derivative-aided classifier on 10 years of EOD data.
                Use the strategy ribbon to filter by a legendary system —
                Qullamaggie, Minervini, Darvas, PTJ, or Simons.
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

        <ScreenerTable rows={rows} scoped />
      </main>
    </div>
  );
}
