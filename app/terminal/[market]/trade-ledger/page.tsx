import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/app/AppShell";
import SwingTradeLedger from "@/components/trade-ledger/SwingTradeLedger";
import LedgerAutoRefresh from "@/components/trade-ledger/LedgerAutoRefresh";
import NewsRefreshButton from "@/components/screener/NewsRefreshButton";
import { getSessionUser } from "@/lib/auth";
import { getActiveNewsConfig } from "@/lib/credentials-actions";
import { normalizeMarket } from "@/lib/markets";
import { getSwingTradeLedger } from "@/lib/swingTradeLedger";

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
  const [trades, newsConfig] = await Promise.all([
    getSwingTradeLedger(user.id, market),
    getActiveNewsConfig(),
  ]);
  return (
    <AppShell
      email={user.email}
      market={market}
      active="trade-ledger"
      title="Swing Trade Ledger"
      subtitle="Track real purchases against the exact target, stop, trail, and holding window recorded at entry."
      maxWidth="max-w-6xl"
      actions={<NewsRefreshButton market={market} configured={Boolean(newsConfig)} />}
    >
      <LedgerAutoRefresh market={market} />
      <SwingTradeLedger market={market} trades={trades} defaults={defaults} />
    </AppShell>
  );
}
