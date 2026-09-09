import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/app/AppShell";
import StrongSwingCandidates from "@/components/screener/StrongSwingCandidates";
import { getSessionUser } from "@/lib/auth";
import { normalizeMarket } from "@/lib/markets";
import { getUserSwingSettings } from "@/lib/settings";
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
  const candidates = await getStrongSwingCandidates(market, settings);

  return (
    <AppShell
      email={user.email}
      market={market}
      active="strong-swing"
      title="Strong Swing Candidates"
      subtitle="Execution-ready setups only after technical confirmation, entry discipline, volatility, stop-risk, liquidity and circuit-behaviour checks agree."
    >
      <div className="mb-6 border-l-2 border-[var(--ig-accent)] pl-4 text-sm leading-relaxed text-white/52">
        Swing Candidates is the discovery surface. Here, only the green Execution Ready state is actionable. Broker RTCM/GTT validation will be added with the broker API; until then, verify exchange restrictions before placing an order.
      </div>
      <StrongSwingCandidates candidates={candidates} />
    </AppShell>
  );
}
