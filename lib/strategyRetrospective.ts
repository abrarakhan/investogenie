import { query } from "@/lib/db";
import type { MarketId } from "@/lib/types";

export interface StrategyRetrospectiveScorecard {
  market: string;
  engine: string;
  horizonSessions: number;
  observations: number;
  positiveOutcomes: number;
  winRatePct: number;
  averageReturnPct: number;
  medianReturnPct: number;
  averageMaxFavorablePct: number;
  averageMaxAdversePct: number;
  methodologyVersion: string;
  computedAt: string;
}

export async function getStrategyRetrospectiveScorecards(
  market: MarketId,
): Promise<StrategyRetrospectiveScorecard[]> {
  const rows = await query<Record<string, unknown>>(
    `select market,engine,horizon_sessions,observations,positive_outcomes,win_rate_pct,
            average_return_pct,median_return_pct,average_max_favorable_pct,
            average_max_adverse_pct,methodology_version,computed_at::text
       from public.strategy_retrospective_scorecards
      where market=$1
      order by horizon_sessions,average_return_pct desc nulls last,engine`,
    [market],
  );
  return rows.map((row) => ({
    market: String(row.market),
    engine: String(row.engine),
    horizonSessions: Number(row.horizon_sessions),
    observations: Number(row.observations),
    positiveOutcomes: Number(row.positive_outcomes),
    winRatePct: Number(row.win_rate_pct),
    averageReturnPct: Number(row.average_return_pct),
    medianReturnPct: Number(row.median_return_pct),
    averageMaxFavorablePct: Number(row.average_max_favorable_pct),
    averageMaxAdversePct: Number(row.average_max_adverse_pct),
    methodologyVersion: String(row.methodology_version),
    computedAt: String(row.computed_at),
  }));
}
