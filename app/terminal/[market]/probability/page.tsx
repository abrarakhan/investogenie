import { redirect, notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import AppShell from "@/components/app/AppShell";
import ProbabilityDashboard from "@/components/probability/ProbabilityDashboard";
import { getProbabilitySummary } from "@/lib/probability-runtime";
import { normalizeMarket } from "@/lib/markets";

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

  const summary = await getProbabilitySummary(marketId);

  return (
    <AppShell
      email={user.email ?? ""}
      market={marketId}
      active="probability"
      title="Probability"
      subtitle="21 trading-day return distributions, scenario ranges, and risk estimates from the local OHLCV store."
    >
      <ProbabilityDashboard summary={summary} />
    </AppShell>
  );
}
