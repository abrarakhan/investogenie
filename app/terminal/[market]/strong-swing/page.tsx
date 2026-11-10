import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/app/AppShell";
import MomentumIgnitionCandidates from "@/components/screener/MomentumIgnitionCandidates";
import MomentumIgnitionLegacyCandidates from "@/components/screener/MomentumIgnitionLegacyCandidates";
import TrendContinuationCandidates from "@/components/screener/TrendContinuationCandidates";
import StrongSwingCandidates from "@/components/screener/StrongSwingCandidates";
import { getSessionUser } from "@/lib/auth";
import { normalizeMarket } from "@/lib/markets";
import { getUserSwingSettings } from "@/lib/settings";
import { displayLegacyMomentum, displayMomentumV2, displayScanComputedAt, displayStrongSwing, displayTrendContinuation } from "@/lib/displayScanCache";
import { trimStrongSwingForDisplay } from "@/lib/candidateDisplay";
import { splitForLazyDisplay } from "@/lib/lazyCandidateGroups";
import { LazyGroupsVersion } from "@/components/screener/LazyCandidateGroup";
import MarketDataAutoRefresh from "@/components/app/MarketDataAutoRefresh";
import { markLiveMarketTargets } from "@/lib/liveMarketTargets";
import { zonedMarketClock } from "@/lib/market-calendar.mjs";
import { captureExecutionPlans, momentumExecutionPlanInputs, strongSwingExecutionPlanInputs, trendContinuationExecutionPlanInputs, type ExecutionPlanInput } from "@/lib/swingExecutionPlans";
import ReadySignalHistory from "@/components/screener/ReadySignalHistory";
import { getTodayReadySignalHistory } from "@/lib/candidateSignalHistory";

export const dynamic = "force-dynamic";

export default async function StrongSwingPage({
  params,
}: {
  params: Promise<{ market: string }>;
}) {
  const { market: marketParam } = await params;
  const market = normalizeMarket(marketParam);
  if (!market) notFound();
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const settings = await getUserSwingSettings();
  const [candidates, legacyMomentumIgnition, momentumIgnition, trendContinuation, readyHistory] = await Promise.all([
    displayStrongSwing(market, settings),
    displayLegacyMomentum(market, settings),
    displayMomentumV2(market, settings),
    displayTrendContinuation(market),
    getTodayReadySignalHistory(user.id, market),
  ]);
  const executionPlans: ExecutionPlanInput[] = [
    ...strongSwingExecutionPlanInputs(candidates, settings.trailAtrMult),
    ...momentumExecutionPlanInputs(legacyMomentumIgnition.candidates, "LEGACY"),
    ...momentumExecutionPlanInputs(momentumIgnition.candidates, "V2"),
    ...trendContinuationExecutionPlanInputs(trendContinuation),
  ];
  const planIds = await captureExecutionPlans(
    user.id, market, zonedMarketClock(market).date, executionPlans, settings.trailAtrMult,
  );
  // The browser receives only the cards it renders (exact group counts travel
  // separately); plans and live-stream targets above still cover every candidate.
  // Collapsed, never-buyable groups are fetched when opened.
  const strongDisplay = trimStrongSwingForDisplay(candidates);
  const strongShown = splitForLazyDisplay(strongDisplay.candidates, "strong").shown;
  const legacyShown = splitForLazyDisplay(legacyMomentumIgnition.candidates, "momentum-legacy");
  const v2Shown = splitForLazyDisplay(momentumIgnition.candidates, "momentum-v2");
  const trendShown = splitForLazyDisplay(trendContinuation, "trend");
  await markLiveMarketTargets(
    [
      ...candidates.map((candidate) => candidate.assetId),
      ...legacyMomentumIgnition.candidates.map((candidate) => candidate.assetId),
      ...momentumIgnition.candidates.map((candidate) => candidate.assetId),
      ...trendContinuation.map((candidate) => candidate.assetId),
    ],
    "strong_swing",
  );

  // Opened on-demand groups reload whenever the page re-renders with a recomputed scan.
  const scanVersion = Math.max(...[candidates, legacyMomentumIgnition, momentumIgnition, trendContinuation].map(displayScanComputedAt));

  return (
    <AppShell
      email={user.email}
      market={market}
      active="strong-swing"
      title="Strong Swing Candidates"
      subtitle="Execution-ready setups only after technical confirmation, entry discipline, volatility, stop-risk, liquidity and circuit-behaviour checks agree."
    >
      <MarketDataAutoRefresh market={market} assetIds={[
        ...strongDisplay.candidates.map((candidate) => candidate.assetId),
        ...legacyMomentumIgnition.candidates.map((candidate) => candidate.assetId),
        ...momentumIgnition.candidates.map((candidate) => candidate.assetId),
        ...trendContinuation.map((candidate) => candidate.assetId),
      ]} />
      <div className="mb-6 border-l-2 border-[var(--ig-accent)] pl-4 text-sm leading-relaxed text-white/52">
        {market === "IN"
          ? <>Buy &amp; Track is enabled only for green Execution Ready setups and records the frozen plan in your ledger. Breeze currently supplies live market data; it does not place the broker order, so confirm exchange restrictions in ICICI Direct before buying.</>
          : <>Buy &amp; Track is enabled only for green Execution Ready setups and records the frozen plan in your ledger. US setups use end-of-day and delayed quotes: there is no live quote, spread or circuit check, so confirm the live price and spread with your broker before buying.</>}
      </div>
      <ReadySignalHistory rows={readyHistory} market={market} />
      <LazyGroupsVersion value={scanVersion}>
      <section id="strong-swing" className="scroll-mt-6">
        <div className="mb-6">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">Base Swing lineage · confirmed execution engine</div>
          <h2 className="mt-1 text-2xl font-black">Strong Swing Confirmation</h2>
          <p className="mt-1 text-sm text-white/45">The same base Swing signals are re-ranked only after the two-close confirmation and execution-safety gates.</p>
        </div>
        <StrongSwingCandidates candidates={strongShown} counts={strongDisplay.counts} planIds={Object.fromEntries(planIds)} market={market} />
      </section>
      <section id="momentum-ignition" className="mt-12 scroll-mt-6 border-t border-white/10 pt-8">
        <MomentumIgnitionLegacyCandidates result={{ ...legacyMomentumIgnition, candidates: legacyShown.shown }} counts={legacyShown.counts} ranks={legacyShown.ranks} lazy planIds={Object.fromEntries(planIds)} />
      </section>
      <section id="momentum-ignition-v2" className="mt-12 scroll-mt-6 border-t border-white/10 pt-8">
        <MomentumIgnitionCandidates result={{ ...momentumIgnition, candidates: v2Shown.shown }} counts={v2Shown.counts} ranks={v2Shown.ranks} lazy planIds={Object.fromEntries(planIds)} />
      </section>
      {market === "IN" && <section id="trend-continuation" className="mt-12 scroll-mt-6 border-t border-white/10 pt-8">
        <TrendContinuationCandidates candidates={trendShown.shown} counts={trendShown.counts} ranks={trendShown.ranks} market={market} planIds={Object.fromEntries(planIds)} />
      </section>}
      </LazyGroupsVersion>
    </AppShell>
  );
}
