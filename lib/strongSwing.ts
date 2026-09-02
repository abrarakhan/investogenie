import { query } from "@/lib/db";
import { runScreener, type ScreenRow } from "@/lib/screener";
import { deriveLevels, type SwingSetup } from "@/lib/analytics/swingClassifier";
import { assessStrongSwing, type StrongSwingAssessment } from "@/lib/analytics/strongSwing";
import { rankStrongSwingCandidates } from "@/lib/analytics/candidateRanking";
import type { SwingSettings } from "@/lib/settings";
import type { MarketId, OHLCV } from "@/lib/types";

interface BarRow {
  asset_id: string;
  date: string;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume: string | number;
  open_interest: string | number | null;
}

interface SignalContext {
  asset_id: string;
  long_trigger: string | number;
  atr: string | number;
}

export interface StrongSwingCandidate extends ScreenRow, StrongSwingAssessment {
  strongEntry: number;
  strongTarget: number;
  strongStop: number;
  strongTrail: number;
}

const toBar = (row: BarRow): OHLCV => ({
  date: row.date.slice(0, 10),
  open: Number(row.open),
  high: Number(row.high),
  low: Number(row.low),
  close: Number(row.close),
  volume: Number(row.volume),
  openInterest: row.open_interest === null ? null : Number(row.open_interest),
});

const meanVelocity = (bars: OHLCV[]): number => {
  const closes = bars.slice(-21).map((bar) => bar.close);
  if (closes.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < closes.length; i++) total += Math.abs(closes[i] - closes[i - 1]);
  return total / (closes.length - 1);
};

export async function getStrongSwingCandidates(
  market: MarketId,
  settings: SwingSettings,
): Promise<StrongSwingCandidate[]> {
  const country = market;
  const base = await runScreener(
    country,
    { ...settings, includeShort: false },
    market === "IN" ? { exchange: "NSE", limit: 100 } : { limit: 100 },
  );
  if (!base.length) return [];

  const ids = base.map((row) => row.assetId);
  const [barRows, contexts, benchmarkRows] = await Promise.all([
    query<BarRow>(
      `select asset_id,date::text date,open,high,low,close,volume,open_interest
         from (
           select o.*,row_number() over(partition by asset_id order by date desc) rn
             from public.daily_ohlcv o where asset_id = any($1::uuid[])
         ) ranked
        where rn <= 260 order by asset_id,date`,
      [ids],
    ),
    query<SignalContext>(
      `select asset_id,long_trigger,atr from public.swing_signals where asset_id = any($1::uuid[])`,
      [ids],
    ),
    query<BarRow>(
      `with chosen as (
         select a.id
           from public.assets a
          where a.country=$1 and a.ticker=$2
          order by (select count(*) from public.daily_ohlcv o where o.asset_id=a.id) desc
          limit 1
       )
       select o.asset_id,o.date::text date,o.open,o.high,o.low,o.close,o.volume,o.open_interest
         from public.daily_ohlcv o join chosen c on c.id=o.asset_id
        order by o.date desc limit 260`,
      [country, market === "IN" ? "NIFTYBEES" : "SPY"],
    ),
  ]);

  const barsByAsset = new Map<string, OHLCV[]>();
  for (const raw of barRows) {
    const rows = barsByAsset.get(raw.asset_id) ?? [];
    rows.push(toBar(raw));
    barsByAsset.set(raw.asset_id, rows);
  }
  const contextByAsset = new Map(contexts.map((row) => [row.asset_id, row]));
  const benchmarkBars = benchmarkRows.map(toBar).reverse();
  // Without the benchmark, the regime, relative-strength and freshness gates all fail at once
  // and every candidate silently drops to WATCHLIST, which reads as a market call rather than
  // missing reference data. Say so in the log; the gate details say so on screen.
  if (!benchmarkBars.length) {
    console.warn(
      `[strong-swing] benchmark ${market === "IN" ? "NIFTYBEES" : "SPY"} has no bars for ${market}; `
      + "regime, relative-strength and freshness gates will fail for every candidate.",
    );
  }

  const candidates: StrongSwingCandidate[] = [];
  for (const row of base) {
    const bars = barsByAsset.get(row.assetId) ?? [];
    const context = contextByAsset.get(row.assetId);
    if (bars.length < 21 || !context) continue;
    const trigger = Number(context.long_trigger);
    const atr = Number(context.atr);
    const assessment = assessStrongSwing({
      market,
      verdict: row.verdict,
      isBreakout: row.isBreakout,
      trigger,
      atr,
      trailingStop: row.trailingStop,
      bars,
      benchmarkBars,
    });
    const recent = bars.slice(-22);
    const currentPrice = row.lastQuote ?? assessment.latestClose;
    const setup: SwingSetup = {
      currentPrice,
      atr,
      longTrigger: assessment.confirmationEntry,
      shortTrigger: 0,
      hh22: Math.max(...recent.map((bar) => bar.high)),
      ll22: Math.min(...recent.map((bar) => bar.low)),
      dailyVelocity: meanVelocity(bars),
    };
    const levels = deriveLevels(setup, "LONG", settings);
    candidates.push({
      ...row,
      ...assessment,
      strongEntry: levels.entry,
      strongTarget: levels.target,
      strongStop: levels.stopLoss,
      strongTrail: levels.trailingStop,
    });
  }

  return rankStrongSwingCandidates(candidates);
}
