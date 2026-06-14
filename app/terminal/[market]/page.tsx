import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import TerminalHeader from "@/components/terminal/TerminalHeader";
import ApplyMarketTheme from "@/components/terminal/ApplyMarketTheme";
import EngineSection from "@/components/dashboard/EngineSection";
import AssetPicker from "@/components/dashboard/AssetPicker";
import { getFundOverlap, getMacroMatrix, getTopSwingSetups } from "@/lib/engines-runtime";
import { getQuotesByAssetIds } from "@/lib/quotes";
import { MARKETS, MARKET_COUNTRY, normalizeMarket, formatMoney, formatPct } from "@/lib/markets";
import { addToWatchlist, ensureScaffold, recordTrade, removeWatchlistItem } from "@/app/dashboard/actions";

export const dynamic = "force-dynamic";

interface AssetLite {
  id: string;
  ticker: string;
  name: string | null;
  asset_class: string;
  currency: string;
  country: string;
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export default async function TerminalPage({
  params,
}: {
  params: Promise<{ market: string }>;
}) {
  const { market: marketParam } = await params;
  const marketId = normalizeMarket(marketParam);
  if (!marketId) notFound();
  const country = MARKET_COUNTRY[marketId];
  const cfg = MARKETS[marketId];

  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await ensureScaffold();

  const [holdingsRes, watchRes, swing, macro] = await Promise.all([
    supabase
      .from("holdings")
      .select("id, quantity, avg_cost, asset:assets(id,ticker,name,asset_class,currency,country)")
      .order("updated_at", { ascending: false }),
    supabase
      .from("watchlist_items")
      .select("id, asset:assets(id,ticker,name,asset_class,currency,country)")
      .order("created_at", { ascending: false }),
    getTopSwingSetups(supabase, country, 6),
    getMacroMatrix(supabase, marketId),
  ]);
  const overlap = marketId === "IN" ? await getFundOverlap(supabase) : null;

  // Scope holdings + watchlist to THIS market only.
  const holdings = (holdingsRes.data ?? [])
    .map((h) => ({
      id: h.id as string,
      quantity: Number(h.quantity),
      avgCost: Number(h.avg_cost ?? 0),
      asset: one<AssetLite>(h.asset as AssetLite | AssetLite[] | null),
    }))
    .filter((h) => h.asset?.country === country);
  const watch = (watchRes.data ?? [])
    .map((w) => ({
      id: w.id as string,
      asset: one<AssetLite>(w.asset as AssetLite | AssetLite[] | null),
    }))
    .filter((w) => w.asset?.country === country);

  const quoteIds = [
    ...holdings.map((h) => h.asset?.id),
    ...watch.map((w) => w.asset?.id),
  ].filter((x): x is string => Boolean(x));
  const quotes = await getQuotesByAssetIds(supabase, quoteIds);

  const ccy = cfg.currency;
  let invested = 0;
  let marketVal = 0;
  const valued = holdings.map((h) => {
    const quote = h.asset ? quotes.get(h.asset.id) : undefined;
    const last = quote?.price ?? h.avgCost;
    const inv = h.quantity * h.avgCost;
    const mv = h.quantity * last;
    invested += inv;
    marketVal += mv;
    return { ...h, last, changePct: quote?.changePct ?? null, market: mv, pnl: mv - inv };
  });
  const pnl = marketVal - invested;

  return (
    <div className="min-h-screen bg-[#05070d] text-white">
      <ApplyMarketTheme market={marketId} />
      <TerminalHeader email={user.email ?? ""} market={marketId} />

      <main className="mx-auto max-w-7xl space-y-10 px-6 py-10">
        {/* Portfolio value (single currency for this market) */}
        <section>
          <h2 className="mb-4 text-sm uppercase tracking-[0.25em] text-white/40">
            {cfg.label} portfolio
          </h2>
          {valued.length === 0 ? (
            <p className="text-white/50">
              No {ccy} positions yet — record your first {cfg.label} trade below.
            </p>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:w-80">
              <div className="text-xs uppercase tracking-widest text-white/40">{ccy} book</div>
              <div className="mt-1 text-3xl font-bold tabular-nums">{formatMoney(marketVal, ccy)}</div>
              <div className={`mt-1 text-sm tabular-nums ${pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {pnl >= 0 ? "▲" : "▼"} {formatMoney(Math.abs(pnl), ccy)} unrealized
              </div>
            </div>
          )}
        </section>

        {/* Market benchmarks (this market only) */}
        <section>
          <h2 className="mb-4 text-sm uppercase tracking-[0.25em] text-white/40">
            {cfg.label} benchmarks
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {cfg.benchmarks.map((b) => {
              const up = b.changePct >= 0;
              return (
                <div key={b.ticker} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="text-xs uppercase tracking-widest text-white/50">{b.name}</div>
                  <div className="mt-1 text-2xl font-bold tabular-nums">{formatMoney(b.last, ccy)}</div>
                  <div className={`mt-1 text-sm tabular-nums ${up ? "text-emerald-400" : "text-rose-400"}`}>
                    {up ? "▲" : "▼"} {formatPct(b.changePct)}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="grid gap-8 lg:grid-cols-[1.5fr_1fr]">
          {/* Holdings + trade ticket */}
          <section className="rounded-3xl border border-white/10 bg-white/[0.02] p-6">
            <h2 className="mb-4 text-lg font-bold">Holdings</h2>
            {valued.length === 0 ? (
              <p className="mb-6 text-sm text-white/50">No positions yet.</p>
            ) : (
              <div className="mb-6 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wider text-white/40">
                    <tr>
                      <th className="py-2">Asset</th>
                      <th className="py-2 text-right">Qty</th>
                      <th className="py-2 text-right">Avg</th>
                      <th className="py-2 text-right">Last</th>
                      <th className="py-2 text-right">Value</th>
                      <th className="py-2 text-right">P/L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {valued.map((h) => (
                      <tr key={h.id} className="border-t border-white/5">
                        <td className="py-2.5">
                          <span className="font-semibold">{h.asset?.ticker}</span>
                          <span className="ml-2 text-xs text-white/40">{h.asset?.asset_class}</span>
                        </td>
                        <td className="py-2.5 text-right tabular-nums">{h.quantity}</td>
                        <td className="py-2.5 text-right tabular-nums">{formatMoney(h.avgCost, ccy)}</td>
                        <td className="py-2.5 text-right tabular-nums">
                          {formatMoney(h.last, ccy)}
                          {h.changePct !== null && (
                            <span className={`ml-1 text-[10px] ${h.changePct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                              {h.changePct >= 0 ? "+" : ""}{h.changePct.toFixed(2)}%
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 text-right tabular-nums">{formatMoney(h.market, ccy)}</td>
                        <td className={`py-2.5 text-right tabular-nums ${h.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          {formatMoney(h.pnl, ccy)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <form action={recordTrade} className="grid grid-cols-2 gap-3 rounded-2xl border border-white/10 bg-black/30 p-4 sm:grid-cols-5">
              <div className="col-span-2">
                <AssetPicker name="assetId" placeholder={`Search ${cfg.label} ticker…`} country={marketId} />
              </div>
              <select name="side" className="rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm">
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </select>
              <input name="quantity" type="number" step="any" min="0" placeholder="Qty" required className="rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm" />
              <input name="price" type="number" step="any" min="0" placeholder="Price" required className="rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm" />
              <button type="submit" className="col-span-2 rounded-lg bg-gradient-to-r from-[var(--ig-primary)] to-[var(--ig-accent)] px-3 py-2 text-sm font-semibold text-black sm:col-span-5">
                Record trade
              </button>
            </form>
          </section>

          {/* Watchlist */}
          <section className="rounded-3xl border border-white/10 bg-white/[0.02] p-6">
            <h2 className="mb-4 text-lg font-bold">Watchlist</h2>
            <ul className="mb-5 space-y-2">
              {watch.length === 0 && <li className="text-sm text-white/50">Nothing watched yet.</li>}
              {watch.map((w) => {
                const quote = w.asset ? quotes.get(w.asset.id) : undefined;
                return (
                  <li key={w.id} className="flex items-center justify-between gap-2 rounded-xl border border-white/5 bg-black/20 px-3 py-2">
                    <span className="min-w-0">
                      <span className="font-semibold">{w.asset?.ticker}</span>
                      <span className="ml-2 block truncate text-xs text-white/40">{w.asset?.name}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      {quote && (
                        <span className="text-right tabular-nums">
                          <span className="text-sm">{formatMoney(quote.price, ccy)}</span>
                          {quote.changePct !== null && (
                            <span className={`block text-[10px] ${quote.changePct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                              {quote.changePct >= 0 ? "+" : ""}{quote.changePct.toFixed(2)}%
                            </span>
                          )}
                        </span>
                      )}
                      <form action={removeWatchlistItem}>
                        <input type="hidden" name="itemId" value={w.id} />
                        <button type="submit" className="text-xs text-white/40 hover:text-rose-400">✕</button>
                      </form>
                    </span>
                  </li>
                );
              })}
            </ul>
            <form action={addToWatchlist} className="flex gap-2">
              <div className="flex-1">
                <AssetPicker name="assetId" placeholder={`Add ${cfg.label} ticker…`} country={marketId} />
              </div>
              <button type="submit" className="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/10">
                Add
              </button>
            </form>
          </section>
        </div>

        <EngineSection swing={swing} overlap={overlap} macro={macro} />
      </main>
    </div>
  );
}
