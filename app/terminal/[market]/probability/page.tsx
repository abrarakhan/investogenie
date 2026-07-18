import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import ApplyMarketTheme from "@/components/terminal/ApplyMarketTheme";
import TerminalHeader from "@/components/terminal/TerminalHeader";
import ProbabilityDashboard from "@/components/probability/ProbabilityDashboard";
import { getProbabilitySummary } from "@/lib/probability-runtime";
import { MARKETS, normalizeMarket } from "@/lib/markets";

export const dynamic = "force-dynamic";

export default async function ProbabilityPage({
  params,
}: {
  params: Promise<{ market: string }>;
}) {
  const { market: marketParam } = await params;
  const marketId = normalizeMarket(marketParam);
  if (!marketId) notFound();
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const cfg = MARKETS[marketId];
  const summary = await getProbabilitySummary(marketId);

  return (
    <div className="min-h-screen bg-[#05070d] text-white">
      <ApplyMarketTheme market={marketId} />
      <TerminalHeader email={user.email ?? ""} market={marketId} />
      <main className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <Link href={`/terminal/${marketId.toLowerCase()}`} className="text-sm text-white/45 hover:text-white">
              Back to terminal
            </Link>
            <h1 className="mt-4 text-3xl font-black">
              {cfg.flag} {cfg.label} Probability
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/50">
              A market-scoped probability workspace for 21 trading-day return ranges, built from the existing local OHLCV store.
            </p>
          </div>
          <Link
            href={`/terminal/${marketId.toLowerCase()}/screener`}
            className="rounded-lg border border-white/10 bg-white/[0.035] px-4 py-2 text-sm font-semibold text-white/65 hover:bg-white/[0.07] hover:text-white"
          >
            Swing Candidates
          </Link>
        </div>

        <ProbabilityDashboard summary={summary} />
      </main>
    </div>
  );
}
