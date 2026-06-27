import { notFound } from "next/navigation";
import MarketOverview from "@/components/market-overview/MarketOverview";
import { getMarketOverview } from "@/lib/marketOverview";
import { normalizeMarket } from "@/lib/markets";

export const dynamic = "force-dynamic";

export default async function MarketOverviewPage({
  params,
}: {
  params: Promise<{ market: string }>;
}) {
  const { market } = await params;
  const marketId = normalizeMarket(market);
  if (!marketId) notFound();
  return <MarketOverview data={await getMarketOverview(marketId)} />;
}
