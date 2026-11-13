import type { BacktestStats, EvidenceStats, LeaderboardRow, Verdict } from "@/lib/strategyLeaderboard";
import { ESTABLISHED_SESSIONS, ESTABLISHED_TRADES, MIN_TRADES } from "@/lib/strategyLeaderboard";

const NAMES: Record<string, string> = {
  STRONG_SWING: "Strong Swing",
  MOMENTUM_IGNITION: "Momentum Ignition",
  MOMENTUM_IGNITION_V2: "Momentum Ignition V2",
  TREND_CONTINUATION: "Trend Continuation",
  TREND_DAY_TWO: "Day-two continuation",
  TREND_DAY_TWO_WATCH: "Day-two continuation (held back)",
  ARMED_SWING: "Armed Swing",
  PROBABILITY: "Probability model",
  DEFAULT_SWING: "Default Swing",
  QULLAMAGGIE: "Qullamaggie",
  MINERVINI: "Minervini",
  DARVAS: "Darvas",
  SIMONS: "Simons",
  PTJ: "PTJ",
};
export const strategyName = (key: string) => NAMES[key] ?? key.replace(/_/g, " ");

const VERDICT: Record<Verdict, { label: string; className: string }> = {
  PROFITABLE: { label: "Profitable", className: "bg-emerald-400/15 text-emerald-300" },
  NEAR_BREAKEVEN: { label: "Near break-even", className: "bg-amber-400/15 text-amber-200" },
  LOSING: { label: "Losing", className: "bg-rose-400/15 text-rose-300" },
  NOT_ENOUGH_DATA: { label: "Not enough data", className: "bg-white/8 text-white/45" },
};

// Until the sample is large enough the verdict is shown only as a direction.
const EARLY: Record<Verdict, { label: string; className: string }> = {
  PROFITABLE: { label: "Early indication · positive", className: "bg-white/8 text-emerald-200/80" },
  NEAR_BREAKEVEN: { label: "Early indication · flat", className: "bg-white/8 text-amber-100/80" },
  LOSING: { label: "Early indication · negative", className: "bg-white/8 text-rose-200/80" },
  NOT_ENOUGH_DATA: VERDICT.NOT_ENOUGH_DATA,
};
const badge = (row: LeaderboardRow) => (row.established ? VERDICT : EARLY)[row.verdict];

const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
const tone = (v: number) => (v > 0 ? "text-emerald-300" : v < 0 ? "text-rose-300" : "text-white/70");

function Stat({ stats, extra }: { stats: EvidenceStats | null; extra?: string }) {
  if (!stats || stats.trades === 0) return <span className="text-white/25">—</span>;
  return (
    <div className="leading-tight">
      <span className={`font-semibold tabular-nums ${tone(stats.avgReturnPct)}`}>{pct(stats.avgReturnPct)}</span>
      <span className="ml-1.5 text-xs tabular-nums text-white/45">{stats.winRatePct.toFixed(0)}% win · {stats.trades}</span>
      {extra && <div className="text-[11px] text-white/35">{extra}</div>}
    </div>
  );
}

function Backtest({ rows }: { rows: BacktestStats[] }) {
  if (!rows.length) return <span className="text-white/25">—</span>;
  return (
    <div className="space-y-0.5">
      {rows.map((b) => (
        <div key={b.horizonSessions} className="whitespace-nowrap text-xs">
          <span className="inline-block w-8 text-white/35">{b.horizonSessions}d</span>
          <span className={`font-semibold tabular-nums ${tone(b.avgReturnPct)}`}>{pct(b.avgReturnPct)}</span>
          <span className="ml-1.5 tabular-nums text-white/40">{b.winRatePct.toFixed(0)}% · {b.trades}</span>
        </div>
      ))}
    </div>
  );
}

export default function StrategyLeaderboard({ rows }: { rows: LeaderboardRow[] }) {
  const ranked = rows.filter((r) => r.primary);
  const best = ranked[0];
  const profitable = ranked.filter((r) => r.verdict === "PROFITABLE" && r.established);
  const early = ranked.filter((r) => r.verdict === "PROFITABLE" && !r.established);
  const near = ranked.filter((r) => r.verdict === "NEAR_BREAKEVEN");

  return (
    <section className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
      <div>
        <p className="text-xs uppercase tracking-[0.22em] text-[var(--ig-accent)]">Strategy leaderboard</p>
        <h2 className="mt-2 text-2xl font-black">Which strategies are making money</h2>
        <p className="mt-2 max-w-4xl text-sm leading-relaxed text-white/55">
          Each strategy is ranked by its most trustworthy evidence: the forward test when it has at least {MIN_TRADES} closed
          calls, otherwise the backtest, otherwise your own trades. Profitable means an average of +0.5% or more per trade;
          near break-even is between −1% and +0.5%.
        </p>
        <p className="mt-2 max-w-4xl text-sm leading-relaxed text-amber-100/70">
          A verdict is only an early indication until it rests on at least {ESTABLISHED_TRADES} closed trades and, for
          forward tests, calls from {ESTABLISHED_SESSIONS} or more separate days. All returns are before brokerage, taxes
          and slippage, with no allowance for chance or for how a strategy behaves in a falling market. Use this to
          compare strategies, not to decide how much money to put behind one.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
          <p className="text-[11px] uppercase tracking-wider text-white/40">Top ranked</p>
          <p className="mt-1 text-lg font-bold">{best?.primary ? strategyName(best.strategy) : "—"}</p>
          {best?.primary && (
            <p className="text-xs text-white/45">
              <span className={tone(best.primary.avgReturnPct)}>{pct(best.primary.avgReturnPct)}</span> avg · {best.primary.trades} trades · {best.primary.label}
            </p>
          )}
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
          <p className="text-[11px] uppercase tracking-wider text-white/40">Profitable on an established sample</p>
          <p className="mt-1 text-lg font-bold">{profitable.length}</p>
          <p className="truncate text-xs text-white/45">{profitable.map((r) => strategyName(r.strategy)).join(", ") || "None yet"}</p>
          {early.length > 0 && <p className="mt-1 truncate text-[11px] text-white/35">Early positive: {early.map((r) => strategyName(r.strategy)).join(", ")}</p>}
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
          <p className="text-[11px] uppercase tracking-wider text-white/40">Closest to profit</p>
          <p className="mt-1 text-lg font-bold">{near.length}</p>
          <p className="truncate text-xs text-white/45">{near.map((r) => strategyName(r.strategy)).join(", ") || "None"}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/8">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-white/[0.035] text-left text-[11px] uppercase tracking-wider text-white/40">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Strategy</th>
                <th className="px-4 py-3">Verdict</th>
                <th className="px-4 py-3">Ranked on</th>
                <th className="px-4 py-3">Forward test</th>
                <th className="px-4 py-3">Backtest</th>
                <th className="px-4 py-3">Your trades</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-white/35">No graded results yet.</td></tr>
              )}
              {rows.map((r, i) => (
                <tr key={r.strategy} className="border-t border-white/5 align-top">
                  <td className="px-4 py-3 tabular-nums text-white/35">{r.primary ? i + 1 : "—"}</td>
                  <td className="px-4 py-3 font-semibold">{strategyName(r.strategy)}</td>
                  <td className="px-4 py-3">
                    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${badge(r).className}`}>{badge(r).label}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-white/50">
                    {r.primary ? (
                      <><span className={`font-semibold ${tone(r.primary.avgReturnPct)}`}>{pct(r.primary.avgReturnPct)}</span><br />{r.primary.label}</>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Stat
                      stats={r.forward}
                      extra={r.forward ? `${r.forward.stocks} stocks · ${r.forward.sessions} days · ${r.forward.targetHits} target · ${r.forward.stopHits} stop · ${r.forward.live} live` : undefined}
                    />
                  </td>
                  <td className="px-4 py-3"><Backtest rows={r.backtest} /></td>
                  <td className="px-4 py-3"><Stat stats={r.ledger} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-white/35">
        Returns are per trade, before costs. Forward-test calls are frozen when made and count only once their entry fills.
        Small samples swing a lot: one large winner can carry a whole strategy. These results describe past behaviour of
        the app&apos;s strategies, not a recommendation to trade any stock.
      </p>
    </section>
  );
}
