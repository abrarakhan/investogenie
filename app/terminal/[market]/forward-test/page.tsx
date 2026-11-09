import { redirect, notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import AppShell from "@/components/app/AppShell";
import ForwardTestDashboard from "@/components/forward-test/ForwardTestDashboard";
import RetrospectiveDashboard from "@/components/forward-test/RetrospectiveDashboard";
import { getForwardTestScorecard, getForwardTestPositions } from "@/lib/forwardTest";
import { getStrategyRetrospectiveScorecards } from "@/lib/strategyRetrospective";
import { normalizeMarket } from "@/lib/markets";

export const dynamic = "force-dynamic";

export default async function ForwardTestPage({
  params,
}: {
  params: Promise<{ market: string }>;
}) {
  const { market: marketParam } = await params;
  const marketId = normalizeMarket(marketParam);
  if (!marketId) notFound();
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [scorecard, positions, retrospective] = await Promise.all([
    getForwardTestScorecard(marketId),
    getForwardTestPositions(marketId),
    getStrategyRetrospectiveScorecards(marketId),
  ]);

  return (
    <AppShell
      email={user.email ?? ""}
      market={marketId}
      active="forward-test"
      title="Strategy Tests"
      subtitle="Compare true forward cohorts with backward-looking outcomes from recorded production signals."
    >
      <div className="space-y-8">
        <ForwardTestDashboard scorecard={scorecard} positions={positions} />
        <RetrospectiveDashboard rows={retrospective} />
      </div>
    </AppShell>
  );
}
