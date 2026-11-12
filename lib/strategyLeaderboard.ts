// One table that answers "which strategy is closest to making money?" by
// putting the three kinds of evidence side by side:
//   forward  — frozen calls graded after the fact (true out-of-sample);
//   backtest — recorded production-ready signals, next-open entry (retrospective);
//   ledger   — the signed-in user's own closed trades.
// Nothing is recomputed here: it only aggregates stored outcomes.
import { query } from "@/lib/db";
import type { MarketId } from "@/lib/types";

export interface EvidenceStats {
  trades: number;
  avgReturnPct: number;
  medianReturnPct: number | null;
  winRatePct: number;
}
export interface ForwardStats extends EvidenceStats {
  targetHits: number;
  stopHits: number;
  live: number;
  /** Distinct stocks behind the closed calls: a low count means one name may be carrying the result. */
  stocks: number;
}
export interface BacktestStats extends EvidenceStats { horizonSessions: number }

export type Verdict = "PROFITABLE" | "NEAR_BREAKEVEN" | "LOSING" | "NOT_ENOUGH_DATA";

export interface LeaderboardRow {
  strategy: string;
  forward: ForwardStats | null;
  backtest: BacktestStats[];
  ledger: EvidenceStats | null;
  /** The evidence used to rank the row, most trustworthy first. */
  primary: { source: "forward" | "backtest" | "ledger"; avgReturnPct: number; trades: number; label: string } | null;
  verdict: Verdict;
}

export const MIN_TRADES = 5;
const PROFIT_THRESHOLD_PCT = 0.5;
const LOSS_THRESHOLD_PCT = -1;

export function strategyKey(method: string): string {
  return method.replace(/^(SWING|ENGINE):/, "");
}

export function verdictFor(avgReturnPct: number, trades: number): Verdict {
  if (trades < MIN_TRADES) return "NOT_ENOUGH_DATA";
  if (avgReturnPct >= PROFIT_THRESHOLD_PCT) return "PROFITABLE";
  if (avgReturnPct > LOSS_THRESHOLD_PCT) return "NEAR_BREAKEVEN";
  return "LOSING";
}

export function buildLeaderboard(
  forward: Map<string, ForwardStats>,
  backtest: Map<string, BacktestStats[]>,
  ledger: Map<string, EvidenceStats>,
): LeaderboardRow[] {
  const keys = new Set([...forward.keys(), ...backtest.keys(), ...ledger.keys()]);
  const rows: LeaderboardRow[] = [...keys].map((strategy) => {
    const fwd = forward.get(strategy) ?? null;
    const bt = (backtest.get(strategy) ?? []).slice().sort((a, b) => a.horizonSessions - b.horizonSessions);
    const own = ledger.get(strategy) ?? null;
    // Forward test first; else the backtest horizon with the most observations; else the user's trades.
    const btBest = bt.filter((b) => b.trades >= MIN_TRADES).sort((a, b) => b.trades - a.trades)[0];
    const primary = fwd && fwd.trades >= MIN_TRADES
      ? { source: "forward" as const, avgReturnPct: fwd.avgReturnPct, trades: fwd.trades, label: "Forward test" }
      : btBest
        ? { source: "backtest" as const, avgReturnPct: btBest.avgReturnPct, trades: btBest.trades, label: `Backtest, ${btBest.horizonSessions} sessions` }
        : own && own.trades >= MIN_TRADES
          ? { source: "ledger" as const, avgReturnPct: own.avgReturnPct, trades: own.trades, label: "Your trades" }
          : null;
    return {
      strategy, forward: fwd, backtest: bt, ledger: own, primary,
      verdict: primary ? verdictFor(primary.avgReturnPct, primary.trades) : "NOT_ENOUGH_DATA",
    };
  });
  return rows.sort((a, b) => {
    if (!a.primary || !b.primary) return a.primary ? -1 : b.primary ? 1 : a.strategy.localeCompare(b.strategy);
    return b.primary.avgReturnPct - a.primary.avgReturnPct;
  });
}

const n = (value: unknown) => Number(value);
const nOrNull = (value: unknown) => (value === null || value === undefined ? null : Number(value));

export async function getStrategyLeaderboard(market: MarketId, userId: string): Promise<LeaderboardRow[]> {
  const [forwardRows, backtestRows, ledgerRows] = await Promise.all([
    query<Record<string, unknown>>(
      `select method,
              count(*) filter (where status in ('TARGET_HIT','STOP_HIT','EXPIRED')) trades,
              avg(realized_return_pct) filter (where status in ('TARGET_HIT','STOP_HIT','EXPIRED')) avg_ret,
              percentile_cont(0.5) within group (order by realized_return_pct)
                filter (where status in ('TARGET_HIT','STOP_HIT','EXPIRED')) med_ret,
              100.0 * avg((realized_return_pct > 0)::int)
                filter (where status in ('TARGET_HIT','STOP_HIT','EXPIRED')) win,
              count(*) filter (where status = 'TARGET_HIT') target_hits,
              count(*) filter (where status = 'STOP_HIT') stop_hits,
              count(*) filter (where status in ('PENDING','OPEN')) live,
              count(distinct asset_id) filter (where status in ('TARGET_HIT','STOP_HIT','EXPIRED')) stocks
         from public.forward_test_positions where market = $1 group by method`,
      [market],
    ),
    query<Record<string, unknown>>(
      `select engine, horizon_sessions, observations, win_rate_pct, average_return_pct, median_return_pct
         from public.strategy_retrospective_scorecards where market = $1`,
      [market],
    ),
    query<Record<string, unknown>>(
      `select coalesce(strategy_key, 'DEFAULT_SWING') strategy,
              count(*) trades,
              avg((exit_price / buy_price - 1) * 100) avg_ret,
              percentile_cont(0.5) within group (order by (exit_price / buy_price - 1) * 100) med_ret,
              100.0 * avg((exit_price > buy_price)::int) win
         from public.swing_trade_ledger
        where user_id = $1 and market = $2 and exit_price is not null and buy_price > 0
        group by 1`,
      [userId, market],
    ),
  ]);

  const forward = new Map<string, ForwardStats>();
  for (const r of forwardRows) {
    forward.set(strategyKey(String(r.method)), {
      trades: n(r.trades), avgReturnPct: n(r.avg_ret ?? 0), medianReturnPct: nOrNull(r.med_ret),
      winRatePct: n(r.win ?? 0), targetHits: n(r.target_hits), stopHits: n(r.stop_hits), live: n(r.live), stocks: n(r.stocks),
    });
  }
  const backtest = new Map<string, BacktestStats[]>();
  for (const r of backtestRows) {
    const key = String(r.engine);
    backtest.set(key, [...(backtest.get(key) ?? []), {
      horizonSessions: n(r.horizon_sessions), trades: n(r.observations), avgReturnPct: n(r.average_return_pct),
      medianReturnPct: nOrNull(r.median_return_pct), winRatePct: n(r.win_rate_pct),
    }]);
  }
  const ledger = new Map<string, EvidenceStats>();
  for (const r of ledgerRows) {
    ledger.set(String(r.strategy), {
      trades: n(r.trades), avgReturnPct: n(r.avg_ret), medianReturnPct: nOrNull(r.med_ret), winRatePct: n(r.win),
    });
  }
  return buildLeaderboard(forward, backtest, ledger);
}
