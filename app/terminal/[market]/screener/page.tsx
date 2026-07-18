import { notFound, redirect } from "next/navigation";
import { runScreener } from "@/lib/screener";
import { getUserSwingSettings } from "@/lib/settings";
import ScreenerTable from "@/components/screener/ScreenerTable";
import AppShell from "@/components/app/AppShell";
import { getSessionUser } from "@/lib/auth";
import { MARKET_COUNTRY, normalizeMarket } from "@/lib/markets";

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
  // India: NSE only, capped to the 20 highest-conviction buy candidates.
  const rows = await runScreener(
    country,
    buyOnlySettings,
    isUS ? {} : { exchange: "NSE", limit: 20 },
  );

  return (
    <AppShell
      email={user.email ?? ""}
      market={marketId}
      active="swing"
      title={`Swing Candidates${!isUS ? " - Top 20" : ""}`}
      subtitle="Buy-side swing candidates ranked inside the selected market workspace."
    >
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
                The 20 highest-conviction buy candidates from the NSE universe,
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
    </AppShell>
  );
}
