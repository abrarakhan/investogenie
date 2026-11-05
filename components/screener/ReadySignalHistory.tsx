import type { ReadySignalHistoryRow } from "@/lib/candidateSignalHistory";

const ENGINE = {
  STRONG_SWING: { label: "Strong Swing", anchor: "strong-swing" },
  MOMENTUM_IGNITION: { label: "Momentum Ignition", anchor: "momentum-ignition" },
  MOMENTUM_IGNITION_V2: { label: "Momentum Ignition V2", anchor: "momentum-ignition-v2" },
  TREND_CONTINUATION: { label: "Trend Continuation", anchor: "trend-continuation" },
} as const;

export default function ReadySignalHistory({ rows, market }: { rows: ReadySignalHistoryRow[]; market: "IN" | "US" }) {
  if (!rows.length) return null;
  const timeZone = market === "IN" ? "Asia/Kolkata" : "America/New_York";
  return <section className="mb-8 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.04] p-4">
    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">Detected earlier today</div>
    <p className="mt-1 text-xs leading-relaxed text-white/50">
      Readiness transitions are retained even if a live classifier later changes. A historical row is not a current buy signal; open its section and use the current status.
    </p>
    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => {
        const engine = ENGINE[row.engine];
        const time = new Intl.DateTimeFormat("en-IN", { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(row.firstReadyAt));
        return <a key={`${row.engine}-${row.assetId}`} href={`#${engine.anchor}`}
          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 transition hover:border-emerald-300/40">
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold text-white">{row.ticker}</span>
            <span className="text-[10px] uppercase tracking-wide text-emerald-300">{time}</span>
          </div>
          <div className="mt-1 text-[11px] text-white/45">{engine.label} · first {row.firstReadyStatus.replaceAll("_", " ")}</div>
          <div className={`mt-1 text-[11px] ${row.currentlyReady ? "text-emerald-300" : "text-amber-200"}`}>
            {row.currentlyReady ? "Still ready now" : `Now ${row.latestStatus.replaceAll("_", " ")}`}
          </div>
        </a>;
      })}
    </div>
  </section>;
}
