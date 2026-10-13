import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/app/AppShell";
import ArmedSwingCandidates from "@/components/screener/ArmedSwingCandidates";
import MarketDataAutoRefresh from "@/components/app/MarketDataAutoRefresh";
import { getSessionUser } from "@/lib/auth";
import { getArmedSwingCandidates } from "@/lib/armedSwing";
import { captureArmedSwingPlans } from "@/lib/armedSwingPlans";
import { markLiveMarketTargets } from "@/lib/liveMarketTargets";
import { normalizeMarket } from "@/lib/markets";
import { getUserSwingSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function ArmedSwingPage({ params }: { params: Promise<{ market: string }> }) {
  const { market: marketParam } = await params;
  const market = normalizeMarket(marketParam);
  if (!market) notFound();
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const settings = await getUserSwingSettings();
  const result = await getArmedSwingCandidates(market, settings);
  // Actionable names, and qualifying setups still waiting on live execution data, need the
  // five-minute live quote that the execution gates require.
  const liveIds = result.candidates
    .filter((candidate) => ["BUY_ZONE", "TRIGGERED_UNCONFIRMED", "ARMED", "UNVERIFIED"].includes(candidate.status))
    .map((candidate) => candidate.assetId);
  // Actions reference these server-held plans by id; the browser never supplies the levels.
  const [planIds] = await Promise.all([
    captureArmedSwingPlans(user.id, market, result.sessionDate, result.candidates, settings.trailAtrMult),
    markLiveMarketTargets(liveIds, "strong_swing"),
  ]);

  return (
    <AppShell
      email={user.email}
      market={market}
      active="armed-swing"
      title="Armed Strong Swing"
      subtitle="Pre-breakout entries: stage-2 leaders in tight bases just under their pivot, with a buy-stop plan that fills on the breakout instead of after two confirming closes."
    >
      <MarketDataAutoRefresh market={market} assetIds={liveIds} />
      <div className="mb-6 border-l-2 border-[var(--ig-accent)] pl-4 text-sm leading-relaxed text-white/52">
        Armed enters earlier than Strong Swing, so it accepts more failed breakouts in exchange for a lower entry and a tighter structure stop.
        Projections are model estimates, not guarantees. Strong Swing&apos;s gates and rankings are unchanged.
      </div>
      <ArmedSwingCandidates result={result} planIds={Object.fromEntries(planIds)} />
    </AppShell>
  );
}
