import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/app/AppShell";
import SwingTradeLedger from "@/components/trade-ledger/SwingTradeLedger";
import LedgerAutoRefresh from "@/components/trade-ledger/LedgerAutoRefresh";
import NewsRefreshButton from "@/components/screener/NewsRefreshButton";
import { getSessionUser } from "@/lib/auth";
import { getActiveNewsConfigs } from "@/lib/credentials-actions";
import { normalizeMarket } from "@/lib/markets";
import { getSwingTradeLedger } from "@/lib/swingTradeLedger";
import { markLiveMarketTargets } from "@/lib/liveMarketTargets";
import { getBreezeReconciliation } from "@/lib/breeze/broker";
import BreezeReconciliationPanel from "@/components/trade-ledger/BreezeReconciliationPanel";

export const dynamic = "force-dynamic";

export default async function SwingTradeLedgerPage({ params, searchParams }: {
  params: Promise<{ market: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { market: marketParam } = await params;
  const market = normalizeMarket(marketParam);
  if (!market) notFound();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const raw = await searchParams;
  const defaults = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  const [trades, newsConfig, breeze] = await Promise.all([
    getSwingTradeLedger(user.id, market),
    getActiveNewsConfigs(),
    market === "IN" ? getBreezeReconciliation(user.id) : Promise.resolve(null),
  ]);
  if (market === "IN") {
    await markLiveMarketTargets(
      trades.filter((trade) => trade.status === "OPEN").map((trade) => trade.assetId),
      "trade_ledger",
    );
  }
  return (
    <AppShell
      email={user.email}
      market={market}
      active="trade-ledger"
      title="Swing Trade Ledger"
      subtitle="Track real purchases against the exact target, stop, trail, and holding window recorded at entry."
      maxWidth="max-w-6xl"
      actions={<NewsRefreshButton market={market} configured={newsConfig.length > 0} />}
    >
      <LedgerAutoRefresh market={market} />
      {breeze && <BreezeReconciliationPanel data={breeze} />}
      <SwingTradeLedger market={market} trades={trades} defaults={defaults} />
    </AppShell>
  );
}
