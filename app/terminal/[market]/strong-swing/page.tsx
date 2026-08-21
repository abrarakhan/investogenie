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
      subtitle="Confirmed execution-quality setups. Structural signals remain on watch until trend, liquidity, breakout, follow-through, regime and OI/cash validation agree."
    >
      <div className="mb-6 border-l-2 border-[var(--ig-accent)] pl-4 text-sm leading-relaxed text-white/52">
        A strength score reports gates passed, not a guaranteed win probability. Only the green Confirmed state is actionable; amber rows are monitoring candidates.
      </div>
      <StrongSwingCandidates candidates={candidates} />
    </AppShell>
  );
}
