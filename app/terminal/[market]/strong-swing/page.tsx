import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/app/AppShell";
import MomentumIgnitionCandidates from "@/components/screener/MomentumIgnitionCandidates";
import StrongSwingCandidates from "@/components/screener/StrongSwingCandidates";
import { getSessionUser } from "@/lib/auth";
import { normalizeMarket } from "@/lib/markets";
import { getUserSwingSettings } from "@/lib/settings";
import { getMomentumIgnitionCandidates } from "@/lib/momentumIgnition";
import { getStrongSwingCandidates } from "@/lib/strongSwing";

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
  const [candidates, momentumIgnition] = await Promise.all([
    getStrongSwingCandidates(market, settings),
    getMomentumIgnitionCandidates(market, settings),
  ]);

  return (
    <AppShell
      email={user.email}
      market={market}
      active="strong-swing"
      title="Strong Swing Candidates"
      subtitle="Execution-ready setups only after technical confirmation, entry discipline, volatility, stop-risk, liquidity and circuit-behaviour checks agree."
    >
      <div className="mb-6 border-l-2 border-[var(--ig-accent)] pl-4 text-sm leading-relaxed text-white/52">
        Buy &amp; Track is enabled only for green Execution Ready setups and records the frozen plan in your ledger. Breeze currently supplies live market data; it does not place the broker order, so confirm exchange restrictions in ICICI Direct before buying.
      </div>
      {market === "IN" && <MomentumIgnitionCandidates result={momentumIgnition} />}
      <section className={market === "IN" ? "mt-12 border-t border-white/10 pt-8" : ""}>
        {market === "IN" && <div className="mb-6">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">Confirmed execution engine</div>
          <h2 className="mt-1 text-2xl font-black">Strong Swing Confirmation</h2>
          <p className="mt-1 text-sm text-white/45">The existing calculations and two-close execution gates are unchanged.</p>
        </div>}
        <StrongSwingCandidates candidates={candidates} />
      </section>
    </AppShell>
  );
}
