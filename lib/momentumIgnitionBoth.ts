import type { MomentumIgnitionAssessment } from "@/lib/analytics/momentumIgnition";
import type { MomentumIgnitionV2Assessment, MomentumIgnitionV2Status } from "@/lib/analytics/momentumIgnitionV2";
import type {
  MomentumIgnitionCandidate as LegacyMomentumIgnitionCandidate,
  MomentumIgnitionResult as LegacyMomentumIgnitionResult,
} from "@/lib/momentumIgnitionLegacy";
import type { MomentumIgnitionCandidate, MomentumIgnitionResult } from "@/lib/momentumIgnition";
import { runPythonStrategyBatch } from "@/lib/pythonStrategyMath";
import type { SwingSettings } from "@/lib/settings";
import type { OHLCV } from "@/lib/types";
import {
  isMarketOpenNow,
  latestSignalSessionDate,
  marketSessionProgress,
  refreshMarketHolidays,
} from "@/lib/market-calendar.mjs";
import {
  loadMomentumBars,
  loadMomentumLiveBars,
  loadMomentumPreliminaryBundle,
  type MomentumBarRow as BarRow,
} from "@/lib/momentumIgnitionData";

export interface MomentumBothResult {
  legacy: LegacyMomentumIgnitionResult;
  v2: MomentumIgnitionResult;
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

const marketConfig = (market: "IN" | "US") => market === "IN" ? {
  benchmarkTickers: ["NIFTY", "NIFTYBEES"],
  benchmarkLabel: "Nifty",
  priceFloor: 20,
  preliminaryLiquidityFloor: 10_000_000,
  liquidityFloor: 50_000_000,
  liquidityRequirementLabel: "INR 5 crore",
} : {
  benchmarkTickers: ["SPY"],
  benchmarkLabel: "S&P 500",
  priceFloor: 5,
  preliminaryLiquidityFloor: 1_000_000,
  liquidityFloor: 5_000_000,
  liquidityRequirementLabel: "USD 5 million",
};

type PythonMomentumBoth = {
  legacy: MomentumIgnitionAssessment;
  v2: MomentumIgnitionV2Assessment;
  legacyPlan: Pick<
    LegacyMomentumIgnitionCandidate,
    "status" | "executionVetoReason" | "projectedEntry" | "projectedStop" | "projectedTarget" | "projectedTrail" | "projectedDays"
  >;
  v2Plan: Pick<
    MomentumIgnitionCandidate,
    "status" | "modelStatus" | "executionBlockReason" | "projectedEntry" | "projectedStop" | "projectedTarget" | "projectedTrail" | "projectedDays"
  >;
  legacyRank: number;
  v2Rank: number;
};

/**
 * Compute both Momentum Ignition Legacy and Momentum Ignition V2 in a single SQL pass
 * and a single Python `momentum` batch (`assess_both` already computes both models).
 */
export async function getMomentumBothCandidates(
  market: "IN" | "US",
  settings: SwingSettings,
): Promise<MomentumBothResult> {
  const config = marketConfig(market);
  await refreshMarketHolidays(market);
  const expectedSessionDate = latestSignalSessionDate(market);
  const marketOpen = isMarketOpenNow(market);
  const session = marketSessionProgress(market, new Date());

  const { countRows, preliminary, benchmarkRows } = await loadMomentumPreliminaryBundle(
    market, expectedSessionDate, marketOpen, session.date, config.priceFloor,
    config.preliminaryLiquidityFloor, JSON.stringify(config.benchmarkTickers),
  );
  const universeScanned = Number(countRows[0]?.count ?? 0);
  if (!preliminary.length) {
    return {
      legacy: { market, universeScanned, detailedAssessments: 0, candidates: [] },
      v2: { market, universeScanned, detailedAssessments: 0, candidates: [] },
    };
  }

  const requireLiveIntraday = market === "IN" && marketOpen;
  const ids = preliminary.map((row) => row.asset_id);
  const idsKey = JSON.stringify(ids);
  const [barRows, liveRows] = await Promise.all([
    loadMomentumBars(idsKey, marketOpen, session.date),
    requireLiveIntraday ? loadMomentumLiveBars(idsKey, session.date) : Promise.resolve([]),
  ]);
  const barsByAsset = new Map<string, OHLCV[]>();
  for (const row of barRows) {
    const bars = barsByAsset.get(row.asset_id) ?? [];
    bars.push(toBar(row));
    barsByAsset.set(row.asset_id, bars);
  }
  const liveByAsset = new Map(liveRows.map((row) => [row.asset_id, row]));
  const benchmarkBars = benchmarkRows.map(toBar).reverse();

  const work = preliminary.flatMap((row) => {
    const completedBars = barsByAsset.get(row.asset_id) ?? [];
    if (completedBars.length < 10) return [];
    const quoteAgeMs = Date.now() - Date.parse(row.quote_updated_at);
    const authoritativeQuote = market !== "IN" || row.quote_source === "BREEZE_LIVE";
    const liveRow = liveByAsset.get(row.asset_id);
    const liveDataVerified = !requireLiveIntraday || Boolean(
      liveRow
      && liveRow.source === "BREEZE_LIVE"
      && authoritativeQuote
      && Number.isFinite(quoteAgeMs)
      && quoteAgeMs >= 0
      && quoteAgeMs <= 5 * 60_000
      && Number(liveRow.volume) > 0,
    );
    const bars = liveDataVerified && requireLiveIntraday && liveRow
      ? [...completedBars, toBar(liveRow)]
      : completedBars;
    return [{
      row,
      liveDataVerified,
      input: {
        ticker: row.ticker,
        baseScore: Number(row.base_score ?? 0),
        currentPrice: Number(row.current_price),
        bars,
        currentSessionVolume: requireLiveIntraday && liveDataVerified,
        sessionProgressFraction: session.progress,
        benchmarkLabel: config.benchmarkLabel,
        liquidityFloor: config.liquidityFloor,
        liquidityRequirementLabel: config.liquidityRequirementLabel,
        priceFloor: config.priceFloor,
        marketOpen: requireLiveIntraday,
        liveDataVerified,
        stopAtrMult: settings.stopAtrMult,
        targetRR: settings.targetRR,
        trailAtrMult: settings.trailAtrMult,
      },
    }];
  });

  const results = await runPythonStrategyBatch<(typeof work)[number]["input"], PythonMomentumBoth>(
    "momentum",
    work.map((item) => item.input),
    { benchmarkBars },
  );

  const legacyCandidates: LegacyMomentumIgnitionCandidate[] = [];
  const v2Candidates: MomentumIgnitionCandidate[] = [];

  for (let index = 0; index < work.length; index++) {
    const { row, liveDataVerified } = work[index];
    const item = results[index];
    const sharedMeta = {
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
    };

    if (item.legacy.qualifies) {
      legacyCandidates.push({
        ...item.legacy,
        ...item.legacyPlan,
        pythonRank: item.legacyRank,
        ...sharedMeta,
        timingStatus: item.v2.status as MomentumIgnitionV2Status,
      });
    }
    if (item.v2.qualifies) {
      v2Candidates.push({
        ...item.v2,
        ...item.v2Plan,
        pythonRank: item.v2Rank,
        liveDataVerified,
        ...sharedMeta,
      });
    }
  }

  legacyCandidates.sort((left, right) => (left.pythonRank ?? Number.MAX_SAFE_INTEGER) - (right.pythonRank ?? Number.MAX_SAFE_INTEGER));
  v2Candidates.sort((left, right) => (left.pythonRank ?? Number.MAX_SAFE_INTEGER) - (right.pythonRank ?? Number.MAX_SAFE_INTEGER));

  return {
    legacy: {
      market,
      universeScanned,
      detailedAssessments: preliminary.length,
      candidates: legacyCandidates.slice(0, 80),
    },
    v2: {
      market,
      universeScanned,
      detailedAssessments: preliminary.length,
      candidates: v2Candidates.slice(0, 80),
    },
  };
}
