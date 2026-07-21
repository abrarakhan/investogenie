import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/app/AppShell";
import MarketOverview from "@/components/market-overview/MarketOverview";
import { getSessionUser } from "@/lib/auth";
import { getMarketOverview } from "@/lib/marketOverview";
import { MARKETS, normalizeMarket } from "@/lib/markets";

export const dynamic = "force-dynamic";

export default async function MarketOverviewPage({
  params,
}: {
  params: Promise<{ market: string }>;
}) {
  const { market } = await params;
  const marketId = normalizeMarket(market);
  if (!marketId) notFound();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const cfg = MARKETS[marketId];
  return (
    <AppShell
      email={user.email ?? ""}
      market={marketId}
      active="overview"
      title="Market Overview"
      subtitle={`${cfg.label} breadth, leaders, performance, candidates, and freshness in one workspace.`}
      maxWidth="max-w-[1500px]"
    >
      <MarketOverview data={await getMarketOverview(marketId)} />
    </AppShell>
  );
}
