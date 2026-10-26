import {
  assessMomentumIgnitionV2,
  type MomentumIgnitionV2Assessment,
  type MomentumIgnitionV2Status,
} from "@/lib/analytics/momentumIgnitionV2";
import type { SwingSettings } from "@/lib/settings";
import type { OHLCV } from "@/lib/types";
import { isMarketOpenNow, latestExpectedSessionDate, refreshMarketHolidays } from "@/lib/market-calendar.mjs";
import { loadMomentumBars, loadMomentumPreliminaryBundle, type MomentumBarRow as BarRow } from "@/lib/momentumIgnitionData";

export type MomentumIgnitionCandidateStatus = MomentumIgnitionV2Status | "EXECUTION_BLOCKED";

export interface MomentumIgnitionCandidate extends Omit<MomentumIgnitionV2Assessment, "status"> {
  status: MomentumIgnitionCandidateStatus;
  modelStatus: MomentumIgnitionV2Status;
  executionBlockReason: string | null;
  assetId: string;
  ticker: string;
  name: string | null;
  exchange: string;
  currentPrice: number;
  quoteChangePct: number | null;
  quoteAsOf: string;
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
  const isIndia = market === "IN";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: isIndia ? "Asia/Kolkata" : "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const weekday = parts.weekday !== "Sat" && parts.weekday !== "Sun";
  const start = isIndia ? 9 * 60 + 15 : 9 * 60 + 30;
  const end = isIndia ? 15 * 60 + 30 : 16 * 60;
  return {
    date,
    open: weekday && minutes >= start && minutes <= end,
    progress: Math.max(0, Math.min(1, (minutes - start) / (end - start))),
  };
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
  const expectedSessionDate = latestExpectedSessionDate(market);
  const marketOpen = isMarketOpenNow(market);

  const { countRows, preliminary, benchmarkRows } = await loadMomentumPreliminaryBundle(
    market, expectedSessionDate, marketOpen, config.priceFloor,
    config.preliminaryLiquidityFloor, JSON.stringify(config.benchmarkTickers),
  );
  const universeScanned = Number(countRows[0]?.count ?? 0);
  if (!preliminary.length) {
    return { market, universeScanned, detailedAssessments: 0, candidates: [] };
  }

  const ids = preliminary.map((row) => row.asset_id);
  const barRows = await loadMomentumBars(JSON.stringify(ids));
  const barsByAsset = new Map<string, OHLCV[]>();
  for (const row of barRows) {
    const bars = barsByAsset.get(row.asset_id) ?? [];
    bars.push(toBar(row));
    barsByAsset.set(row.asset_id, bars);
  }
  const benchmarkBars = benchmarkRows.map(toBar).reverse();
  const session = marketSession(market);
  const candidates: MomentumIgnitionCandidate[] = [];
  for (const row of preliminary) {
    const bars = barsByAsset.get(row.asset_id) ?? [];
    if (bars.length < 10) continue;
    const assessment = assessMomentumIgnitionV2({
      currentPrice: Number(row.current_price),
      bars,
      benchmarkBars,
      currentSessionVolume: session.open && bars.at(-1)?.date === session.date,
      sessionProgressFraction: session.progress,
      benchmarkLabel: config.benchmarkLabel,
      liquidityFloor: config.liquidityFloor,
      liquidityRequirementLabel: config.liquidityRequirementLabel,
      priceFloor: config.priceFloor,
    });
    if (!assessment.qualifies) continue;
    const projectedEntry = assessment.status === "MOMENTUM_READY"
      ? Number(row.current_price)
      : assessment.entryTrigger;
    const latest = bars.at(-1)!;
    const invalidation = assessment.status === "RETEST_SETUP"
      ? Math.min(latest.low, assessment.breakoutLevel)
      : assessment.breakoutLevel - assessment.atr14 * 0.25;
    const projectedStop = Math.max(projectedEntry * 0.97, invalidation);
    const projectedTarget = projectedEntry * (1 + assessment.shortHorizonTargetPct / 100);
    const executionBlockReason = assessment.status === "MOMENTUM_READY"
      ? momentumExecutionBlockReason({
        entry: projectedEntry,
        target: projectedTarget,
        stop: projectedStop,
        trail: projectedStop,
      })
      : null;
    const status: MomentumIgnitionCandidateStatus = executionBlockReason
      ? "EXECUTION_BLOCKED"
      : assessment.status;
    candidates.push({
      ...assessment,
      status,
      modelStatus: assessment.status,
      executionBlockReason,
      assetId: row.asset_id,
      ticker: row.ticker,
      name: row.name,
      exchange: row.exchange,
      currentPrice: Number(row.current_price),
      quoteChangePct: row.quote_change_pct === null ? null : Number(row.quote_change_pct),
      quoteAsOf: row.quote_as_of,
      latestDate: row.latest_date,
      baseScore: Number(row.base_score ?? 0),
      baseVerdict: row.base_verdict ?? "NO_SETUP",
      strongStatus: row.strong_status,
      strongCapturedAt: row.strong_captured_at,
      projectedEntry,
      projectedStop,
      projectedTarget,
      projectedTrail: projectedStop,
      projectedDays: assessment.shortHorizonDays,
    });
  }

  const statusRank = {
    MOMENTUM_READY: 0,
    EXECUTION_BLOCKED: 1,
    FIRST_THRUST: 2,
    RETEST_SETUP: 3,
    PRE_IGNITION: 4,
    LATE_PROFIT_BOOKING: 5,
    FAILED_BREAKOUT: 6,
    NOT_QUALIFIED: 7,
  } as const;
  candidates.sort((left, right) =>
    statusRank[left.status] - statusRank[right.status]
      || right.score - left.score
      || right.baseScore - left.baseScore
      || left.ticker.localeCompare(right.ticker),
  );
  return {
    market,
    universeScanned,
    detailedAssessments: preliminary.length,
    candidates: candidates.slice(0, 80),
  };
}
