import { query } from "@/lib/db";

export type TrendContinuationStatus = "IMPULSE_DETECTED" | "CONTINUATION_WATCH" | "TREND_CONTINUATION_READY" | "EXTENDED_RISK";
export interface TrendContinuationCandidate {
  assetId: string; ticker: string; name: string | null; status: TrendContinuationStatus;
  ready: boolean; observationOnly: true; score: number; entry: number | null;
  stop: number | null; target: number | null; asOfMarketDate: string;
  computedAt: string; metrics: Record<string, number | boolean | number[] | null>; reasons: string[];
}
interface Row {
  asset_id: string; ticker: string; name: string | null; status: TrendContinuationStatus;
  ready: boolean; observation_only: true; score: number; entry: string | null; stop: string | null;
  target: string | null; asof_market_date: string; computed_at: string;
  metrics: Record<string, number | boolean | number[] | null>; reasons: string[];
}

export async function getTrendContinuationCandidates(market: "IN" | "US", limit = 40): Promise<TrendContinuationCandidate[]> {
  if (market !== "IN") return [];
  const rows = await query<Row>(`select distinct on (asset_id) asset_id,ticker,name,status,ready,observation_only,
      score,entry,stop,target,asof_market_date::text,computed_at::text,metrics,reasons
    from public.trend_continuation_signals where market=$1
      and asof_market_date=(select max(asof_market_date) from public.trend_continuation_signals where market=$1)
    order by asset_id,asof_market_date desc,computed_at desc`, [market]);
  return rows.sort((a, b) => b.score - a.score).slice(0, limit).map((row) => ({
    assetId: row.asset_id, ticker: row.ticker, name: row.name, status: row.status,
    ready: row.ready, observationOnly: row.observation_only, score: row.score,
    entry: row.entry === null ? null : Number(row.entry), stop: row.stop === null ? null : Number(row.stop),
    target: row.target === null ? null : Number(row.target), asOfMarketDate: row.asof_market_date,
    computedAt: row.computed_at, metrics: row.metrics, reasons: row.reasons,
  }));
}
