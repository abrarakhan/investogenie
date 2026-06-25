import { redirect, notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import TerminalHeader from "@/components/terminal/TerminalHeader";
import ApplyMarketTheme from "@/components/terminal/ApplyMarketTheme";
import EngineSection from "@/components/dashboard/EngineSection";
import AssetPicker from "@/components/dashboard/AssetPicker";
import { getFundOverlap, getMacroMatrix, getTopSwingSetups } from "@/lib/engines-runtime";
import { getUserSwingSettings } from "@/lib/settings";
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

interface HoldingRow extends AssetLite {
  hid: string;
  quantity: string | number;
  avg_cost: string | number | null;
}
interface WatchRow extends AssetLite {
  wid: string;
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

  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureScaffold();
  const settings = await getUserSwingSettings();

  const [holdingRows, watchRows, swing, macro] = await Promise.all([
    query<HoldingRow>(
      `select h.id as hid, h.quantity, h.avg_cost,
              a.id, a.ticker, a.name, a.asset_class, a.currency, a.country
         from public.holdings h join public.assets a on a.id = h.asset_id
        where h.user_id = $1 order by h.updated_at desc`,
      [user.id],
    ),
    query<WatchRow>(
      `select w.id as wid, a.id, a.ticker, a.name, a.asset_class, a.currency, a.country
         from public.watchlist_items w join public.assets a on a.id = w.asset_id
        where w.user_id = $1 order by w.created_at desc`,
      [user.id],
    ),
    getTopSwingSetups(country, settings, 6),
    getMacroMatrix(marketId),
  ]);
  const overlap = marketId === "IN" ? await getFundOverlap() : null;

  const asset = (r: AssetLite): AssetLite => ({
    id: r.id, ticker: r.ticker, name: r.name, asset_class: r.asset_class,
    currency: r.currency, country: r.country,
  });
  // Scope holdings + watchlist to THIS market only.
  const holdings = holdingRows
    .map((h) => ({ id: h.hid, quantity: Number(h.quantity), avgCost: Number(h.avg_cost ?? 0), asset: asset(h) }))
    .filter((h) => h.asset.country === country);
  const watch = watchRows
    .map((w) => ({ id: w.wid, asset: asset(w) }))
    .filter((w) => w.asset.country === country);

  const quoteIds = [
    ...holdings.map((h) => h.asset?.id),
    ...watch.map((w) => w.asset?.id),
  ].filter((x): x is string => Boolean(x));
  const quotes = await getQuotesByAssetIds(quoteIds);

  const ccy = cfg.currency;
  const valued = holdings.map((h) => {
    const quote = h.asset ? quotes.get(h.asset.id) : undefined;
    const last = quote?.price ?? h.avgCost;
    const inv = h.quantity * h.avgCost;
    const mv = h.quantity * last;
    return { ...h, last, changePct: quote?.changePct ?? null, invested: inv, market: mv, pnl: mv - inv };
  });
  const invested = valued.reduce((s, v) => s + v.invested, 0);
  const marketVal = valued.reduce((s, v) => s + v.market, 0);
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
