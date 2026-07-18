import { redirect } from "next/navigation";
import { normalizeMarket } from "@/lib/markets";

export default async function CommercialSwingCandidates({ params }: { params: Promise<{ market: string }> }) {
  const { market } = await params;
  const marketId = normalizeMarket(market);
  redirect(marketId ? `/terminal/${marketId.toLowerCase()}/screener` : "/terminal/us/screener");
}
