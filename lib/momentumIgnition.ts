import {
  type MomentumIgnitionV2Assessment,
  type MomentumIgnitionV2Status,
} from "@/lib/analytics/momentumIgnitionV2";
import { runPythonStrategyBatch } from "@/lib/pythonStrategyMath";
import type { SwingSettings } from "@/lib/settings";
import type { OHLCV } from "@/lib/types";
import { isMarketOpenNow, latestSignalSessionDate, marketSessionProgress, refreshMarketHolidays } from "@/lib/market-calendar.mjs";
import {
  loadMomentumBars,
  loadMomentumLiveBars,
  loadMomentumPreliminaryBundle,
  type MomentumBarRow as BarRow,
} from "@/lib/momentumIgnitionData";

export type MomentumIgnitionCandidateStatus = MomentumIgnitionV2Status | "EXECUTION_BLOCKED";

export interface MomentumIgnitionCandidate extends Omit<MomentumIgnitionV2Assessment, "status"> {
  pythonRank?: number;
  status: MomentumIgnitionCandidateStatus;
  modelStatus: MomentumIgnitionV2Status;
  executionBlockReason: string | null;
  liveDataVerified: boolean;
  assetId: string;
  ticker: string;
  name: string | null;
  exchange: string;
  currentPrice: number;
  quoteChangePct: number | null;
  quoteAsOf: string;
  quoteUpdatedAt: string;
  latestDate: string;
  baseScore: number;
  baseVerdict: string;
  strongStatus: string | null;
  strongCapturedAt: string | null;
  projectedEntry: number;
  projectedStop: number;
  projectedTarget: number;
  projectedTrail: number;
  projectedDays: number;
}

export function momentumExecutionBlockReason(input: {
  entry: number;
  target: number;
  stop: number;
  trail: number;
}): string | null {
  if (![input.entry, input.target, input.stop, input.trail].every(Number.isFinite) || input.entry <= 0) {
    return "Execution levels are incomplete or invalid.";
  }
  if (input.stop >= input.entry) {
    return `Model stop ${input.stop.toFixed(2)} is not below live entry ${input.entry.toFixed(2)}.`;
  }
  if (input.trail >= input.entry) {
    return `Trailing reference ${input.trail.toFixed(2)} is not below live entry ${input.entry.toFixed(2)}.`;
  }
  if (input.target <= input.entry) {
    return `Model target ${input.target.toFixed(2)} is not above live entry ${input.entry.toFixed(2)}.`;
  }
  return null;
}

export interface MomentumIgnitionResult {
  market: "IN" | "US";
  universeScanned: number;
  detailedAssessments: number;
  candidates: MomentumIgnitionCandidate[];
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

function marketSession(market: "IN" | "US", now = new Date()): { date: string; open: boolean; progress: number } {
  return marketSessionProgress(market, now);
}

const marketConfig = (market: "IN" | "US") => market === "IN" ? {
  universeWhere: "a.country='IN' and a.exchange='NSE'",
  benchmarkTickers: ["NIFTY", "NIFTYBEES"],
  benchmarkLabel: "Nifty",
  priceFloor: 20,
  preliminaryLiquidityFloor: 10_000_000,
  liquidityFloor: 50_000_000,
  liquidityRequirementLabel: "INR 5 crore",
} : {
  universeWhere: "a.country='US' and a.exchange in ('NASDAQ','NYSE','AMEX','NYSEARCA','NYSEAMERICAN')",
  benchmarkTickers: ["SPY"],
  benchmarkLabel: "S&P 500",
  priceFloor: 5,
  preliminaryLiquidityFloor: 1_000_000,
  liquidityFloor: 5_000_000,
  liquidityRequirementLabel: "USD 5 million",
};

/**
 * Scan the complete active market stock catalog in SQL, then apply the richer
 * TypeScript model to a bounded near-breakout shortlist for predictable AWS
 * memory and response time.
 */
export async function getMomentumIgnitionCandidates(
  market: "IN" | "US",
  settings: SwingSettings,
): Promise<MomentumIgnitionResult> {
  void settings; // V2 uses its own fixed one-to-two-session risk plan.
  const config = marketConfig(market);
  await refreshMarketHolidays(market);
  const expectedSessionDate = latestSignalSessionDate(market);
  const marketOpen = isMarketOpenNow(market);
  const session = marketSession(market);

  const { countRows, preliminary, benchmarkRows } = await loadMomentumPreliminaryBundle(
    market, expectedSessionDate, marketOpen, session.date, config.priceFloor,
    config.preliminaryLiquidityFloor, JSON.stringify(config.benchmarkTickers),
  );
  const universeScanned = Number(countRows[0]?.count ?? 0);
  if (!preliminary.length) {
    return { market, universeScanned, detailedAssessments: 0, candidates: [] };
  }

  const ids = preliminary.map((row) => row.asset_id);
  const idsKey = JSON.stringify(ids);
  const [barRows, liveRows] = await Promise.all([
    loadMomentumBars(idsKey, marketOpen, session.date),
    marketOpen ? loadMomentumLiveBars(idsKey, session.date) : Promise.resolve([]),
  ]);
  const barsByAsset = new Map<string, OHLCV[]>();
  for (const row of barRows) {
    const bars = barsByAsset.get(row.asset_id) ?? [];
    bars.push(toBar(row));
    barsByAsset.set(row.asset_id, bars);
  }
  const liveByAsset = new Map(liveRows.map((row) => [row.asset_id, row]));
  const benchmarkBars = benchmarkRows.map(toBar).reverse();
  const candidates: MomentumIgnitionCandidate[] = [];
  const work = preliminary.flatMap((row) => {
    const completedBars = barsByAsset.get(row.asset_id) ?? [];
    if (completedBars.length < 10) return [];
    const quoteAgeMs = Date.now() - Date.parse(row.quote_updated_at);
    const authoritativeQuote = market !== "IN" || row.quote_source === "BREEZE_LIVE";
    const liveRow = liveByAsset.get(row.asset_id);
    const liveDataVerified = !marketOpen || Boolean(
      liveRow
      && (market !== "IN" || liveRow.source === "BREEZE_LIVE")
      && authoritativeQuote
      && Number.isFinite(quoteAgeMs)
      && quoteAgeMs >= 0
      && quoteAgeMs <= 5 * 60_000
      && Number(liveRow.volume) > 0,
    );
    const bars = liveDataVerified && marketOpen && liveRow
      ? [...completedBars, toBar(liveRow)]
      : completedBars;
    return [{ row, liveDataVerified, input: {
      ticker: row.ticker,
      baseScore: Number(row.base_score ?? 0),
      currentPrice: Number(row.current_price),
      bars,
      benchmarkBars,
      currentSessionVolume: marketOpen && liveDataVerified,
      sessionProgressFraction: session.progress,
      benchmarkLabel: config.benchmarkLabel,
      liquidityFloor: config.liquidityFloor,
      liquidityRequirementLabel: config.liquidityRequirementLabel,
      priceFloor: config.priceFloor,
      marketOpen,
      liveDataVerified,
      stopAtrMult: settings.stopAtrMult,
      targetRR: settings.targetRR,
      trailAtrMult: settings.trailAtrMult,
    } }];
  });
  type PythonMomentum = {
    v2: MomentumIgnitionV2Assessment;
    v2Plan: Pick<MomentumIgnitionCandidate, "status" | "modelStatus" | "executionBlockReason" | "projectedEntry" | "projectedStop" | "projectedTarget" | "projectedTrail" | "projectedDays">;
    v2Rank: number;
  };
  const results = await runPythonStrategyBatch<(typeof work)[number]["input"], PythonMomentum>("momentum", work.map((item) => item.input));
  for (let index = 0; index < work.length; index++) {
    const { row, liveDataVerified } = work[index];
    const { v2: assessment, v2Plan } = results[index];
    if (!assessment.qualifies) continue;
    candidates.push({
      ...assessment,
      ...v2Plan,
      pythonRank: results[index].v2Rank,
      liveDataVerified,
      assetId: row.asset_id,
      ticker: row.ticker,
      name: row.name,
      exchange: row.exchange,
      currentPrice: Number(row.current_price),
      quoteChangePct: row.quote_change_pct === null ? null : Number(row.quote_change_pct),
      quoteAsOf: row.quote_as_of,
      quoteUpdatedAt: row.quote_updated_at,
      latestDate: row.latest_date,
      baseScore: Number(row.base_score ?? 0),
      baseVerdict: row.base_verdict ?? "NO_SETUP",
      strongStatus: row.strong_status,
      strongCapturedAt: row.strong_captured_at,
    });
  }

  candidates.sort((left, right) => (left.pythonRank ?? Number.MAX_SAFE_INTEGER) - (right.pythonRank ?? Number.MAX_SAFE_INTEGER));
  return {
    market,
    universeScanned,
    detailedAssessments: preliminary.length,
    candidates: candidates.slice(0, 80),
  };
}
