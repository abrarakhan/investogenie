"use client";

import { useMarket } from "@/context/MarketProvider";
import { formatPct, formatPrice } from "@/lib/markets";
import type { TickerQuote } from "@/lib/types";

function QuoteCell({ q, marketId }: { q: TickerQuote; marketId: "US" | "IN" }) {
  const up = q.changePct >= 0;
  return (
    <span className="inline-flex items-center gap-2 px-5 py-2 text-sm whitespace-nowrap">
      <span className="font-semibold tracking-wide text-white/90">{q.ticker}</span>
      <span className="tabular-nums text-white/70">{formatPrice(q.last, marketId)}</span>
      <span
        className={`tabular-nums font-medium ${up ? "text-emerald-400" : "text-rose-400"}`}
      >
        {up ? "▲" : "▼"} {formatPct(q.changePct)}
      </span>
    </span>
  );
}

/** Infinite marquee of the active market's tickers. */
export default function TickerTape() {
  const { market, marketId } = useMarket();
  const row = [...market.tickers, ...market.benchmarks];
  // Duplicate the row so the CSS marquee loops seamlessly.
  const doubled = [...row, ...row];

  return (
    <div className="relative w-full overflow-hidden border-y border-white/10 bg-black/30 backdrop-blur">
      <div className="ig-marquee flex w-max">
        {doubled.map((q, i) => (
          <QuoteCell key={`${q.ticker}-${i}`} q={q} marketId={marketId} />
        ))}
      </div>
      {/* Edge fades */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-black to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-black to-transparent" />
    </div>
  );
}

/** Static benchmark trio (S&P/Nasdaq/10Y vs Nifty/Sensex/USDINR). */
export function MacroBenchmarks() {
  const { market, marketId } = useMarket();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {market.benchmarks.map((b) => {
        const up = b.changePct >= 0;
        return (
          <div
            key={b.ticker}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-md"
          >
            <div className="text-xs uppercase tracking-widest text-white/50">{b.name}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-white">
              {formatPrice(b.last, marketId)}
            </div>
            <div
              className={`mt-1 text-sm font-medium tabular-nums ${
                up ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {up ? "▲" : "▼"} {formatPct(b.changePct)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
