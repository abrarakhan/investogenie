import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { normalizeMarket } from "@/lib/markets";
import { getScreenerResults, getSectors, getUniverses, type Market } from "@/lib/screener/service";
import { listSavedScreens } from "@/app/screener/actions";
import AppShell from "@/components/app/AppShell";
import StockScreener from "@/components/stock-screener/StockScreener";
import type { HeldPosition } from "@/components/stock-screener/ResultsTable";

export const dynamic = "force-dynamic";

async function loadUserPositions(userId: string) {
  const holdings: Record<Market, Record<string, HeldPosition>> = { IN: {}, US: {} };
  const watchlist: Record<Market, string[]> = { IN: [], US: [] };

  const hrows = await query<{ country: string; ticker: string; quantity: string | number; avg_cost: string | number | null }>(
    `select a.country, a.ticker, h.quantity, h.avg_cost
       from public.holdings h join public.assets a on a.id = h.asset_id
      where h.user_id = $1 and a.asset_class = 'STOCK'`,
    [userId],
  );
  for (const r of hrows) {
    const m = (r.country === "US" ? "US" : "IN") as Market;
    holdings[m][r.ticker.toUpperCase()] = { quantity: Number(r.quantity), avgCost: r.avg_cost === null ? null : Number(r.avg_cost) };
  }

  const wrows = await query<{ country: string; ticker: string }>(
    `select a.country, a.ticker
       from public.watchlist_items w join public.assets a on a.id = w.asset_id
      where w.user_id = $1`,
    [userId],
  );
  for (const r of wrows) {
    const m = (r.country === "US" ? "US" : "IN") as Market;
    watchlist[m].push(r.ticker.toUpperCase());
  }
  return { holdings, watchlist };
}

export default async function MarketStockScreenerPage({
  params,
}: {
  params: Promise<{ market: string }>;
}) {
  const { market } = await params;
  const marketId = normalizeMarket(market);
  if (!marketId) notFound();
  const user = await getSessionUser();

  const [inSectors, usSectors, inUniverses, usUniverses, initial, savedScreens] = await Promise.all([
    getSectors("IN"),
    getSectors("US"),
    getUniverses("IN"),
    getUniverses("US"),
    getScreenerResults({ market: marketId, universe: "ALL", page: 1, pageSize: 50 }),
    user ? listSavedScreens() : Promise.resolve([]),
  ]);

  const positions = user
    ? await loadUserPositions(user.id)
    : { holdings: { IN: {}, US: {} } as Record<Market, Record<string, HeldPosition>>, watchlist: { IN: [], US: [] } as Record<Market, string[]> };

  return (
    <AppShell
      email={user?.email ?? ""}
      market={marketId}
      active="stock-screener"
      title="Stock Screener"
      subtitle="Filter equities on price action and fundamentals, apply presets, layer filters, and save reusable screens."
      maxWidth="max-w-[1600px]"
    >
      <StockScreener
        isAuthed={Boolean(user)}
        initialMarket={marketId}
        meta={{ IN: { sectors: inSectors, universes: inUniverses }, US: { sectors: usSectors, universes: usUniverses } }}
        holdings={positions.holdings}
        watchlist={positions.watchlist}
        initial={initial}
        savedScreens={savedScreens}
      />
    </AppShell>
  );
}
