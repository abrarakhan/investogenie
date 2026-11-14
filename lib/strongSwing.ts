import { query } from "@/lib/db";
import { runScreener, type ScreenRow } from "@/lib/screener";
import { STRONG_SWING_MODEL_VERSION, type CompletedBarStrongSwingAssessment } from "@/lib/analytics/strongSwing";
import { runPythonStrategyBatch } from "@/lib/pythonStrategyMath";
import type { SwingSettings } from "@/lib/settings";
import type { MarketId, OHLCV } from "@/lib/types";
import { isMarketOpenNow, refreshMarketHolidays, zonedMarketClock } from "@/lib/market-calendar.mjs";
import { chosenBenchmarkSql } from "@/lib/benchmarkSql";
import { loadResultsChecks } from "@/lib/resultsCalendar";

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

interface QuoteContext {
  asset_id: string;
  best_bid: string | number | null; best_ask: string | number | null;
  lower_circuit: string | number | null; quote_updated_at: string | null; quote_source: string | null;
}

export interface StrongSwingSnapshotCapture {
  source: "interactive" | "scheduled";
  decisionTime?: string;
  schedulerRunId?: string;
  marketDate?: string;
  dataCutoff?: string;
  featureVersion?: string;
  calendarVersion?: string;
}

export interface StrongSwingCandidate
  extends Omit<ScreenRow, "atr" | "isBreakout" | "trailingStop">, CompletedBarStrongSwingAssessment {
  pythonRank?: number;
  baseSwingRank: number;
  strongSwingRank: number;
  strongEntry: number;
  strongTarget: number;
  strongStop: number;
  strongTrail: number;
  strongExpectedDays: number;
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

type PythonStrongAssessment = CompletedBarStrongSwingAssessment & {
  strongEntry: number;
  strongTarget: number;
  strongStop: number;
  strongTrail: number;
  strongExpectedDays: number;
  modelVersion: string;
  pythonRank: number;
};

async function captureStrongSwingSnapshot(
  market: MarketId,
  candidates: StrongSwingCandidate[],
  capture: StrongSwingSnapshotCapture,
): Promise<void> {
  if (!candidates.length) return;
  const payload = candidates.map((candidate, index) => ({
    assetId: candidate.assetId,
    ticker: candidate.ticker,
    rank: index + 1,
    status: candidate.status,
    strengthScore: candidate.strengthScore,
    baseScore: candidate.score,
    currentPrice: candidate.lastQuote ?? candidate.latestClose,
    entry: candidate.strongEntry,
    target: candidate.strongTarget,
    stop: candidate.strongStop,
    trail: candidate.strongTrail,
    expectedDays: candidate.strongExpectedDays,
    latestDate: candidate.latestDate,
    gates: candidate.gates,
    metrics: {
      // Read by the auto-buy worker, which refuses rows from any other calculation.
      modelVersion: STRONG_SWING_MODEL_VERSION,
      fiveDayReturnPct: candidate.fiveDayReturnPct,
      tenDayReturnPct: candidate.tenDayReturnPct,
      distanceAboveSma20Pct: candidate.distanceAboveSma20Pct,
      atrPct: candidate.atrPct,
      atr: candidate.atr,
      breakoutBar: candidate.breakoutBar,
      invalidationTrail: candidate.effectiveTrailingStop,
      stopRiskPct: candidate.stopRiskPct,
      entryExtensionAtr: candidate.entryExtensionAtr,
      circuitLikeSessions20: candidate.circuitLikeSessions20,
      sma20: candidate.sma20,
      sma50: candidate.sma50,
      sma200: candidate.sma200,
      relativeStrength20Pct: candidate.relativeStrength20Pct,
      averageTradedValue20: candidate.averageTradedValue20,
      volumeRatio: candidate.volumeRatio,
      closeLocation: candidate.closeLocation,
      triggerClearanceAtr: candidate.triggerClearanceAtr,
      marketRegimePositive: candidate.marketRegimePositive,
      resultsCheck: candidate.resultsCheck,
      confirmationMode: candidate.confirmationMode,
    },
  }));
  const scheduled = capture.source === "scheduled";
  const provenance = {
    source: capture.source,
    decisionTime: capture.decisionTime ?? null,
    schedulerRunId: capture.schedulerRunId ?? null,
    marketDate: capture.marketDate ?? null,
    dataCutoff: capture.dataCutoff ?? null,
    featureVersion: capture.featureVersion ?? (scheduled ? null : "legacy-interactive-v0"),
    calendarVersion: capture.calendarVersion ?? (scheduled ? null : "legacy-calendar-v0"),
  };
  if (scheduled && Object.values(provenance).some((value) => value === null)) {
    throw new Error("Scheduled Strong Swing snapshots require complete provenance");
  }
  const conflictClause = scheduled
    ? `on conflict (market,market_date,decision_time,asset_id,source,feature_version)
         where source='scheduled' do update set
           rank=excluded.rank,status=excluded.status,strength_score=excluded.strength_score,
           base_score=excluded.base_score,current_price=excluded.current_price,
           confirmation_entry=excluded.confirmation_entry,projected_target=excluded.projected_target,
           projected_stop=excluded.projected_stop,projected_trail=excluded.projected_trail,
           expected_days=excluded.expected_days,latest_bar_date=excluded.latest_bar_date,
           gates=excluded.gates,metrics=excluded.metrics,data_cutoff=excluded.data_cutoff,
           scheduler_run_id=excluded.scheduler_run_id,calendar_version=excluded.calendar_version`
    : `on conflict (captured_at,market,asset_id) do update set
         rank=excluded.rank,status=excluded.status,strength_score=excluded.strength_score,
         base_score=excluded.base_score,current_price=excluded.current_price,
         confirmation_entry=excluded.confirmation_entry,projected_target=excluded.projected_target,
         projected_stop=excluded.projected_stop,projected_trail=excluded.projected_trail,
         expected_days=excluded.expected_days,latest_bar_date=excluded.latest_bar_date,
         gates=excluded.gates,metrics=excluded.metrics`;
  await query(
    `with stamp as (
       select case when $3::text='scheduled' then now()
              else date_trunc('hour', now())
                   + floor(extract(minute from now()) / 15) * interval '15 minutes' end captured_at
     ), rows as (
       select * from jsonb_to_recordset($2::jsonb) as x(
         "assetId" uuid,"ticker" text,"rank" integer,"status" text,
         "strengthScore" numeric,"baseScore" numeric,"currentPrice" numeric,
         "entry" numeric,"target" numeric,"stop" numeric,"trail" numeric,
         "expectedDays" integer,"latestDate" date,"gates" jsonb,"metrics" jsonb
       )
     )
     insert into public.strong_swing_snapshots
       (captured_at,market,asset_id,ticker,rank,status,strength_score,base_score,
        current_price,confirmation_entry,projected_target,projected_stop,
        projected_trail,expected_days,latest_bar_date,gates,metrics,source,decision_time,
        feature_version,scheduler_run_id,market_date,data_cutoff,calendar_version)
     select stamp.captured_at,$1,rows."assetId",rows."ticker",rows."rank",rows."status",
            rows."strengthScore",rows."baseScore",rows."currentPrice",rows."entry",
            rows."target",rows."stop",rows."trail",rows."expectedDays",rows."latestDate",
            rows."gates",rows."metrics",$3,$4::time,$5,$6::uuid,$7::date,$8::timestamptz,$9
       from rows cross join stamp
     ${conflictClause}`,
    [market, JSON.stringify(payload), provenance.source, provenance.decisionTime,
      provenance.featureVersion, provenance.schedulerRunId, provenance.marketDate,
      provenance.dataCutoff, provenance.calendarVersion],
  );
}

export async function getStrongSwingCandidates(
  market: MarketId,
  settings: SwingSettings,
  capture: StrongSwingSnapshotCapture = { source: "interactive" },
): Promise<StrongSwingCandidate[]> {
  const country = market;
  await refreshMarketHolidays(market);
  const marketOpen = isMarketOpenNow(market);
  const marketDate = zonedMarketClock(market).date;
  // A breakout that held for a second close is exactly what Strong Swing confirms, but on the
  // hold day the base scan usually reports NO_SETUP (no new high, no squeeze). Those stocks are
  // found here from completed bars and assessed alongside the base setups.
  const holding = await query<{ asset_id: string }>(
    `with ranked as (
       select o.asset_id,o.close,o.high,row_number() over(partition by o.asset_id order by o.date desc) rn
         from public.daily_ohlcv o join public.assets a on a.id=o.asset_id
        where a.country=$1 and a.is_active and a.asset_class='STOCK'
          and ($2::text is null or a.exchange=$2)
          and o.date >= $4::date - interval '60 days'
          and not ($3::boolean and o.date >= $4::date)
     )
     select asset_id from ranked where rn <= 22 group by asset_id
     having count(*) = 22
        and max(close) filter (where rn=1) > max(high) filter (where rn between 3 and 22)
        and max(close) filter (where rn=2) > max(high) filter (where rn between 3 and 22)`,
    [country, market === "IN" ? "NSE" : null, marketOpen, marketDate],
  );
  const alsoAssetIds = holding.map((row) => row.asset_id);
  const base = await runScreener(
    country,
    { ...settings, includeShort: false },
    // Every classifier setup is assessed. A fixed top-N pool let score ties —
    // decided by ticker name — choose which breakouts Strong Swing ever saw.
    market === "IN" ? { exchange: "NSE", setupsOnly: true, alsoAssetIds } : { setupsOnly: true, alsoAssetIds },
  );
  if (!base.length) return [];

  // runScreener returns the base classifier order. Preserve that lineage before
  // Strong Swing applies its additional confirmation and execution gates.
  const baseRankByAsset = new Map(base.map((row, index) => [row.assetId, index + 1]));

  const ids = base.map((row) => row.assetId);
  const [barRows, contexts, benchmarkRows, resultsByAsset] = await Promise.all([
    query<BarRow>(
      `select asset_id,date::text date,open,high,low,close,volume,open_interest
         from (
           select o.*,row_number() over(partition by asset_id order by date desc) rn
             from public.daily_ohlcv o where asset_id = any($1::uuid[])
              and not ($2::boolean and o.date >= $3::date)
         ) ranked
        where rn <= 260 order by asset_id,date`,
      [ids, marketOpen, marketDate],
    ),
    // Live execution data only. The base scan's ATR, trigger, breakout flag and trail are
    // not read: its series can end in today's unfinished candle, and mixing them with
    // completed-bar gates produced levels that disagreed with their own inputs.
    query<QuoteContext>(
      `select q.asset_id,q.best_bid,q.best_ask,q.lower_circuit,q.updated_at::text quote_updated_at,q.source quote_source from public.latest_quotes q where q.asset_id = any($1::uuid[])`,
      [ids],
    ),
    query<BarRow>(
      `with chosen as (
         ${chosenBenchmarkSql("$1", "$2")}
       )
       select o.asset_id,o.date::text date,o.open,o.high,o.low,o.close,o.volume,o.open_interest
         from public.daily_ohlcv o join chosen c on c.id=o.asset_id
        where not ($3::boolean and o.date >= $4::date)
        order by o.date desc limit 260`,
      [country, market === "IN" ? ["NIFTY", "NIFTYBEES"] : ["SPY"], marketOpen, marketDate],
    ),
    loadResultsChecks(market, marketDate, ids),
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
      `[strong-swing] benchmark ${market === "IN" ? "NIFTY/NIFTYBEES" : "SPY"} has no bars for ${market}; `
      + "regime, relative-strength and freshness gates will fail for every candidate.",
    );
  }

  const candidates: StrongSwingCandidate[] = [];
  let flatRange = 0;
  const work = base.flatMap((row) => {
    const bars = barsByAsset.get(row.assetId) ?? [];
    if (bars.length < 21) return [];
    const context = contextByAsset.get(row.assetId);
    return [{ row, bars, input: {
      market,
      verdict: row.verdict,
      currentPrice: row.lastQuote,
      stopAtrMult: settings.stopAtrMult,
      targetRR: settings.targetRR,
      trailAtrMult: settings.trailAtrMult,
      bars,
      ticker: row.ticker,
      baseScore: row.score,
      rankScore: row.rankScore,
      benchmarkBars,
      requireLiveExecutionData: market === "IN" && marketOpen,
      results: resultsByAsset.get(row.assetId) ?? null,
      microstructure: context?.quote_source === "BREEZE_LIVE" ? {
        bestBid: context.best_bid === null ? null : Number(context.best_bid),
        bestAsk: context.best_ask === null ? null : Number(context.best_ask),
        lowerCircuit: context.lower_circuit === null ? null : Number(context.lower_circuit),
        quoteFresh: Boolean(context.quote_updated_at) && Date.now() - Date.parse(context.quote_updated_at!) <= 5 * 60 * 1000,
      } : undefined,
    } }];
  });
  const assessments = await runPythonStrategyBatch<(typeof work)[number]["input"], PythonStrongAssessment>(
    "strong_swing",
    work.map((item) => item.input),
  );
  for (let index = 0; index < work.length; index++) {
    const { row } = work[index];
    const assessment = assessments[index];
    if (assessment.modelVersion !== STRONG_SWING_MODEL_VERSION) {
      throw new Error(`Unexpected Python Strong Swing model ${assessment.modelVersion}`);
    }
    // No price range in 14 sessions means the stock did not really trade. Its stop would equal
    // its entry, so there is no plan to make; leave it out instead of listing it.
    if (!(assessment.atr > 0)) {
      flatRange++;
      continue;
    }
    candidates.push({
      ...row,
      ...assessment,
      baseSwingRank: baseRankByAsset.get(row.assetId) ?? 0,
      strongSwingRank: 0,
      strongEntry: assessment.strongEntry,
      strongTarget: assessment.strongTarget,
      strongStop: assessment.strongStop,
      strongTrail: assessment.strongTrail,
      strongExpectedDays: assessment.strongExpectedDays,
    });
  }

  if (flatRange) console.warn(`[strong-swing] ${market}: left out ${flatRange} stock(s) with no price range in 14 sessions`);
  const ranked = [...candidates].sort((left, right) => (left.pythonRank ?? Number.MAX_SAFE_INTEGER) - (right.pythonRank ?? Number.MAX_SAFE_INTEGER)).map((candidate, index) => ({
    ...candidate,
    strongSwingRank: index + 1,
  }));
  try {
    await captureStrongSwingSnapshot(market, ranked, capture);
  } catch (error) {
    console.error("[strong-swing] failed to capture audit snapshot", error);
  }
  return ranked;
}
