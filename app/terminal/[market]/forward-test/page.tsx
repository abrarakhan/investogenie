import { redirect, notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import AppShell from "@/components/app/AppShell";
import ForwardTestDashboard from "@/components/forward-test/ForwardTestDashboard";
import { getForwardTestScorecard, getForwardTestPositions } from "@/lib/forwardTest";
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

  const [scorecard, positions] = await Promise.all([
    getForwardTestScorecard(marketId),
    getForwardTestPositions(marketId),
  ]);

  return (
    <AppShell
      email={user.email ?? ""}
      market={marketId}
      active="forward-test"
      title="Forward test"
      subtitle="Frozen predictions graded against realised outcomes, per method."
    >
      <ForwardTestDashboard scorecard={scorecard} positions={positions} />
    </AppShell>
  );
}
