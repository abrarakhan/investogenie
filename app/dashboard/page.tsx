import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { MacroBenchmarks } from "@/components/landing/TickerTape";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EngineSection from "@/components/dashboard/EngineSection";
import {
  getFundOverlap,
  getMacroMatrix,
  getSwingSignals,
} from "@/lib/engines-runtime";
import { formatMoney, lastPriceFor } from "@/lib/markets";
import {
  addToWatchlist,
  ensureScaffold,
  recordTrade,
  removeWatchlistItem,
} from "./actions";

export const dynamic = "force-dynamic"; // always reflects the live session

interface AssetLite {
  id: string;
  ticker: string;
  name: string | null;
  asset_class: string;
  currency: string;
}

// Supabase embeds a to-one relation as an object, but the loose client can type
// it as an array — normalize either shape.
function one<T>(v: T | T[] | null): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export default async function DashboardPage() {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await ensureScaffold();

  const [holdingsRes, watchRes, assetsRes, swing, overlap, macro] =
    await Promise.all([
      supabase
        .from("holdings")
        .select(
          "id, quantity, avg_cost, asset:assets(id,ticker,name,asset_class,currency)",
        )
        .order("updated_at", { ascending: false }),
      supabase
        .from("watchlist_items")
        .select("id, asset:assets(id,ticker,name,asset_class,currency)")
        .order("created_at", { ascending: false }),
      supabase
        .from("assets")
        .select("id,ticker,name,asset_class,currency")
        .order("ticker"),
      getSwingSignals(supabase),
      getFundOverlap(supabase),
      getMacroMatrix(supabase),
    ]);

  const assets = (assetsRes.data ?? []) as AssetLite[];
  const holdings = (holdingsRes.data ?? []).map((h) => ({
    id: h.id as string,
    quantity: Number(h.quantity),
    avgCost: Number(h.avg_cost ?? 0),
    asset: one<AssetLite>(h.asset as AssetLite | AssetLite[] | null),
  }));
  const watch = (watchRes.data ?? []).map((w) => ({
    id: w.id as string,
    asset: one<AssetLite>(w.asset as AssetLite | AssetLite[] | null),
  }));

  // Per-currency portfolio totals (no cross-currency summing).
  const totals: Record<string, { invested: number; market: number }> = {};
  const valued = holdings.map((h) => {
    const ccy = h.asset?.currency ?? "USD";
    const last = (h.asset && lastPriceFor(h.asset.ticker)) ?? h.avgCost;
    const invested = h.quantity * h.avgCost;
    const market = h.quantity * last;
    totals[ccy] ??= { invested: 0, market: 0 };
    totals[ccy].invested += invested;
    totals[ccy].market += market;
    return { ...h, last, invested, market, pnl: market - invested, ccy };
  });

  return (
    <div className="min-h-screen bg-[#05070d] text-white">
      <DashboardHeader email={user.email ?? ""} />

      <main className="mx-auto max-w-7xl space-y-10 px-6 py-10">
        {/* Portfolio value summary (per currency) */}
        <section>
          <h2 className="mb-4 text-sm uppercase tracking-[0.25em] text-white/40">
            Portfolio value
          </h2>
          {Object.keys(totals).length === 0 ? (
            <p className="text-white/50">
              No holdings yet — record your first trade below.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(totals).map(([ccy, t]) => {
                const pnl = t.market - t.invested;
                const up = pnl >= 0;
                return (
                  <div
                    key={ccy}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
                  >
                    <div className="text-xs uppercase tracking-widest text-white/40">
                      {ccy} book
                    </div>
                    <div className="mt-1 text-3xl font-bold tabular-nums">
                      {formatMoney(t.market, ccy)}
                    </div>
                    <div
                      className={`mt-1 text-sm tabular-nums ${up ? "text-emerald-400" : "text-rose-400"}`}
                    >
                      {up ? "▲" : "▼"} {formatMoney(Math.abs(pnl), ccy)} unrealized
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Macro benchmarks for the active market */}
        <section>
          <h2 className="mb-4 text-sm uppercase tracking-[0.25em] text-white/40">
            Macro benchmarks
          </h2>
          <MacroBenchmarks />
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
                          <span className="ml-2 text-xs text-white/40">
                            {h.asset?.asset_class}
                          </span>
                        </td>
                        <td className="py-2.5 text-right tabular-nums">{h.quantity}</td>
                        <td className="py-2.5 text-right tabular-nums">
                          {formatMoney(h.avgCost, h.ccy)}
                        </td>
                        <td className="py-2.5 text-right tabular-nums">
                          {formatMoney(h.last, h.ccy)}
                        </td>
                        <td className="py-2.5 text-right tabular-nums">
                          {formatMoney(h.market, h.ccy)}
                        </td>
                        <td
                          className={`py-2.5 text-right tabular-nums ${h.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                        >
                          {formatMoney(h.pnl, h.ccy)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Trade ticket */}
            <form
              action={recordTrade}
              className="grid grid-cols-2 gap-3 rounded-2xl border border-white/10 bg-black/30 p-4 sm:grid-cols-5"
            >
              <select
                name="assetId"
                required
                className="col-span-2 rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm"
              >
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.ticker} · {a.asset_class}
                  </option>
                ))}
              </select>
              <select
                name="side"
                className="rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm"
              >
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </select>
              <input
                name="quantity"
                type="number"
                step="any"
                min="0"
                placeholder="Qty"
                required
                className="rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm"
              />
              <input
                name="price"
                type="number"
                step="any"
                min="0"
                placeholder="Price"
                required
                className="rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                className="col-span-2 rounded-lg bg-gradient-to-r from-[var(--ig-primary)] to-[var(--ig-accent)] px-3 py-2 text-sm font-semibold text-black sm:col-span-5"
              >
                Record trade
              </button>
            </form>
          </section>

          {/* Watchlist */}
          <section className="rounded-3xl border border-white/10 bg-white/[0.02] p-6">
            <h2 className="mb-4 text-lg font-bold">Watchlist</h2>
            <ul className="mb-5 space-y-2">
              {watch.length === 0 && (
                <li className="text-sm text-white/50">Nothing watched yet.</li>
              )}
              {watch.map((w) => (
                <li
                  key={w.id}
                  className="flex items-center justify-between rounded-xl border border-white/5 bg-black/20 px-3 py-2"
                >
                  <span>
                    <span className="font-semibold">{w.asset?.ticker}</span>
                    <span className="ml-2 text-xs text-white/40">
                      {w.asset?.name}
                    </span>
                  </span>
                  <form action={removeWatchlistItem}>
                    <input type="hidden" name="itemId" value={w.id} />
                    <button
                      type="submit"
                      className="text-xs text-white/40 hover:text-rose-400"
                    >
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
            <form action={addToWatchlist} className="flex gap-2">
              <select
                name="assetId"
                required
                className="flex-1 rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm"
              >
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.ticker} · {a.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/10"
              >
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
