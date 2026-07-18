import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { getScreenerResults, getSectors, getUniverses, type Market } from "@/lib/screener/service";
import { listSavedScreens } from "@/app/screener/actions";
import StockScreener from "@/components/stock-screener/StockScreener";
import type { HeldPosition } from "@/components/stock-screener/ResultsTable";

export const dynamic = "force-dynamic";

const MARKETS: Market[] = ["IN", "US"];

/** User's holdings + watchlist, grouped by market (country), keyed by symbol. */
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

export default async function ScreenerPage() {
  const user = await getSessionUser();

  const [inSectors, usSectors, inUniverses, usUniverses, initial, savedScreens] = await Promise.all([
    getSectors("IN"),
    getSectors("US"),
    getUniverses("IN"),
    getUniverses("US"),
    getScreenerResults({ market: "IN", universe: "ALL", page: 1, pageSize: 50 }),
    user ? listSavedScreens() : Promise.resolve([]),
  ]);

  const positions = user
    ? await loadUserPositions(user.id)
    : { holdings: { IN: {}, US: {} } as Record<Market, Record<string, HeldPosition>>, watchlist: { IN: [], US: [] } as Record<Market, string[]> };

  return (
    <main className="min-h-screen bg-[#05070d] text-white">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#05070d]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-baseline gap-3">
            <Link href="/" className="text-xl font-black tracking-tight">
              Investo<span className="text-[var(--ig-accent,#22d3ee)]">Genie</span>
            </Link>
            <span className="text-sm font-semibold text-white/60">Stock Screener</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/swing-candidates" className="rounded-full border border-white/15 px-3 py-1.5 text-white/70 hover:bg-white/10 hover:text-white">Swing Candidates</Link>
            {user ? (
              <Link href="/terminal/in" className="rounded-full border border-white/15 px-3 py-1.5 text-white/70 hover:bg-white/10 hover:text-white">Terminal</Link>
            ) : (
              <Link href="/login" className="rounded-full border border-white/15 px-3 py-1.5 text-white/70 hover:bg-white/10 hover:text-white">Sign in</Link>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-6 py-6">
        <div className="mb-4">
          <h1 className="text-2xl font-bold">Stock Screener</h1>
          <p className="mt-1 text-sm text-white/50">
            Filter {MARKETS.length === 2 ? "US & Indian" : ""} equities on price action and fundamentals. Apply a preset, layer filters, save your screen.
            {!user && <span className="ml-1 text-white/40">Sign in to save screens and see portfolio P&amp;L.</span>}
          </p>
        </div>

        <StockScreener
          isAuthed={Boolean(user)}
          initialMarket="IN"
          meta={{ IN: { sectors: inSectors, universes: inUniverses }, US: { sectors: usSectors, universes: usUniverses } }}
          holdings={positions.holdings}
          watchlist={positions.watchlist}
          initial={initial}
          savedScreens={savedScreens}
        />
      </div>
    </main>
  );
}
