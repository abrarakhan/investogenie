"use server";

import { query } from "@/lib/db";
import { getLongTermData } from "@/lib/long-term-data";
import {
  LONG_TERM_STRATEGY_KEYS,
  scoreAllLongTermStrategies,
  type HistoricalFundamentalMetrics,
  type LongTermMarket,
  type LongTermScore,
  type LongTermStrategyKey,
} from "@/lib/analytics/longTermStrategies";

/**
 * A candidate with every strategy already scored. Scoring depends only on the record and the
 * market — never on the strategy/score/confidence filters — so it is computed once per market
 * and reused across filter changes instead of re-running for all ~4,400 stocks per request.
 */
interface ScoredRecord {
  base: Omit<LongTermCandidate, "selectedScore" | "scores">;
  scoresByKey: Map<LongTermStrategyKey, LongTermScore>;
  scoresRanked: LongTermScore[];
}

export interface LongTermCandidate extends HistoricalFundamentalMetrics {
  assetId: string;
  symbol: string;
  name: string | null;
  sector: string | null;
  exchange: string;
  currency: string;
  ltp: number | null;
  changePct1d: number | null;
  quoteAsOf: string | null;
  marketCap: number | null;
  peRatio: number | null;
  roe: number | null;
  debtToEquity: number | null;
  dividendYield: number | null;
  freeCashFlowYield: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  netDebtToEbitda: number | null;
  interestCoverage: number | null;
  priceToBook: number | null;
  ebitEnterpriseValueYield: number | null;
  accrualRatioPct: number | null;
  reportPeriod: string;
  statementPeriod: string | null;
  fundamentalsUpdatedAt: string;
  source: string | null;
  selectedScore: LongTermScore;
  scores: LongTermScore[];
}

export interface LongTermResult {
  candidates: LongTermCandidate[];
  scanned: number;
  eligible: number;
  excludedForEvidence: number;
  activeStrategy: LongTermStrategyKey;
  fundamentalsLatestPeriod: string | null;
  fundamentalsOldestPeriod: string | null;
  generatedAt: string;
}

export interface LongTermQuery {
  market: LongTermMarket;
  strategy?: LongTermStrategyKey;
  minScore?: number;
  minConfidence?: number;
  limit?: number;
}

function validStrategy(value: LongTermStrategyKey | undefined): LongTermStrategyKey {
  return value && LONG_TERM_STRATEGY_KEYS.includes(value) ? value : "BUFFETT_MOAT";
}

const SCORE_CACHE_TTL_MS = 5 * 60 * 1000;
const globalForLongTermScores = globalThis as unknown as {
  __igLongTermScores?: Map<LongTermMarket, { expiresAt: number; scored: ScoredRecord[] }>;
  __igLongTermCaptured?: Set<string>;
};
const scoreCache = globalForLongTermScores.__igLongTermScores ?? new Map();
globalForLongTermScores.__igLongTermScores = scoreCache;

/** Guards the daily snapshot so it writes once per market/strategy/day, not once per request. */
const capturedToday = globalForLongTermScores.__igLongTermCaptured ?? new Set<string>();
globalForLongTermScores.__igLongTermCaptured = capturedToday;

async function persistDailySnapshot(
  market: LongTermMarket,
  strategy: LongTermStrategyKey,
  candidates: LongTermCandidate[],
): Promise<void> {
  if (process.env.LONG_TERM_CAPTURE_DISABLED === "1" || candidates.length === 0) return;
  const payload = candidates.slice(0, 200).map((candidate, index) => ({
    asset_id: candidate.assetId,
    market,
    strategy_key: strategy,
    rank: index + 1,
    score: candidate.selectedScore.matchScore,
    raw_score: candidate.selectedScore.rawScore,
    confidence: candidate.selectedScore.confidence,
    price: candidate.ltp,
    fundamentals_period: candidate.reportPeriod,
    metrics: {
      peRatio: candidate.peRatio,
      roe: candidate.roe,
      revenueCagr3y: candidate.revenueCagr3y,
      profitCagr3y: candidate.profitCagr3y,
      medianRoce5y: candidate.medianRoce5y,
      currentRatio: candidate.currentRatio,
      netDebtToEbitda: candidate.netDebtToEbitda,
      interestCoverage: candidate.interestCoverage,
      medianCashConversion5y: candidate.medianCashConversion5y,
      priceToBook: candidate.priceToBook,
      ebitEnterpriseValueYield: candidate.ebitEnterpriseValueYield,
    },
  }));
  try {
    await query(
      `with cleared as (
         delete from public.long_term_score_snapshots
          where market = $1 and strategy_key = $2 and captured_on = current_date
       )
       insert into public.long_term_score_snapshots (
         asset_id, market, strategy_key, rank, score, raw_score, confidence,
         price, fundamentals_period, metrics, captured_on
       )
       select x.asset_id::uuid, x.market, x.strategy_key, x.rank, x.score,
              x.raw_score, x.confidence, x.price, x.fundamentals_period::date,
              x.metrics, current_date
         from jsonb_to_recordset($3::jsonb) as x(
           asset_id text, market text, strategy_key text, rank integer,
           score numeric, raw_score numeric, confidence numeric, price numeric,
           fundamentals_period text, metrics jsonb
         )
       on conflict (asset_id, strategy_key, captured_on) do update set
         rank = excluded.rank,
         score = excluded.score,
         raw_score = excluded.raw_score,
         confidence = excluded.confidence,
         price = excluded.price,
         fundamentals_period = excluded.fundamentals_period,
         metrics = excluded.metrics`,
      [market, strategy, JSON.stringify(payload)],
    );
  } catch (error) {
    console.warn("[long-term] score snapshot was not persisted:", error instanceof Error ? error.message : String(error));
  }
}

/** Scores every record against every strategy once per market, then caches the result. */
async function getScoredRecords(market: LongTermMarket): Promise<ScoredRecord[]> {
  const cached = scoreCache.get(market);
  if (cached && cached.expiresAt > Date.now()) return cached.scored;

  const records = await getLongTermData(market);
  const scored = records.map((record): ScoredRecord => {
    const scores = scoreAllLongTermStrategies(record.fundamentals, market);
    return {
      base: {
      assetId: record.assetId,
      symbol: record.symbol,
      name: record.name,
      sector: record.sector,
      exchange: record.exchange,
      currency: record.currency,
      ltp: record.ltp,
      changePct1d: record.changePct1d,
      quoteAsOf: record.quoteAsOf,
      marketCap: record.marketCap,
      peRatio: record.fundamentals.peRatio,
      roe: record.fundamentals.roe,
      debtToEquity: record.fundamentals.debtToEquity,
      dividendYield: record.fundamentals.dividendYield,
      freeCashFlowYield: record.fundamentals.freeCashFlowYield,
      currentRatio: record.fundamentals.currentRatio,
      quickRatio: record.fundamentals.quickRatio,
      netDebtToEbitda: record.fundamentals.netDebtToEbitda,
      interestCoverage: record.fundamentals.interestCoverage,
      priceToBook: record.fundamentals.priceToBook,
      ebitEnterpriseValueYield: record.fundamentals.ebitEnterpriseValueYield,
      accrualRatioPct: record.fundamentals.accrualRatioPct,
      reportPeriod: record.reportPeriod,
      statementPeriod: record.statementPeriod,
      fundamentalsUpdatedAt: record.fundamentalsUpdatedAt,
      source: record.source,
      revenueCagr3y: record.fundamentals.revenueCagr3y,
      revenueCagr5y: record.fundamentals.revenueCagr5y,
      profitCagr3y: record.fundamentals.profitCagr3y,
      profitCagr5y: record.fundamentals.profitCagr5y,
      medianRoce5y: record.fundamentals.medianRoce5y,
      medianCashConversion5y: record.fundamentals.medianCashConversion5y,
      medianFcfMargin5y: record.fundamentals.medianFcfMargin5y,
      positiveProfitYearsRatio: record.fundamentals.positiveProfitYearsRatio,
      historyYears: record.fundamentals.historyYears,
      statementPeriods: record.fundamentals.statementPeriods,
      },
      scoresByKey: new Map(scores.map((score) => [score.key, score])),
      scoresRanked: [...scores].sort((a, b) => b.matchScore - a.matchScore),
    };
  });

  scoreCache.set(market, { expiresAt: Date.now() + SCORE_CACHE_TTL_MS, scored });
  return scored;
}

const withScore = (record: ScoredRecord, selectedScore: LongTermScore): LongTermCandidate => ({
  ...record.base,
  selectedScore,
  scores: record.scoresRanked,
});

export async function getLongTermCandidates(q: LongTermQuery): Promise<LongTermResult> {
  const activeStrategy = validStrategy(q.strategy);
  const minScore = Math.min(100, Math.max(0, q.minScore ?? 50));
  const minConfidence = Math.min(100, Math.max(0, q.minConfidence ?? 60));
  const limit = Math.min(200, Math.max(1, q.limit ?? 50));
  const scored = await getScoredRecords(q.market);

  // Filtering and ranking work off the cached scores, so only the returned page is
  // materialised into candidate objects rather than all ~4,400 rows.
  const canonicalEligible = scored
    .map((record) => ({ record, score: record.scoresByKey.get(activeStrategy) as LongTermScore }))
    .filter((entry) => entry.score.eligible)
    .sort((a, b) =>
      b.score.matchScore - a.score.matchScore
      || b.score.confidence - a.score.confidence
      || (b.record.base.marketCap ?? 0) - (a.record.base.marketCap ?? 0)
      || a.record.base.symbol.localeCompare(b.record.base.symbol),
    );
  const eligible = canonicalEligible.filter((entry) => entry.score.confidence >= minConfidence);
  const candidates = eligible
    .filter((entry) => entry.score.matchScore >= minScore)
    .slice(0, limit)
    .map((entry) => withScore(entry.record, entry.score));

  // Local date, not UTC. The row is stored with `captured_on = current_date`, which Postgres
  // evaluates in the server's timezone, so a UTC key disagreed with it between midnight and
  // 05:30 IST — the guard still held yesterday's key and suppressed the new day's capture
  // until the offset caught up.
  const today = new Date();
  const captureKey = `${q.market}:${activeStrategy}:${today.getFullYear()}-`
    + `${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (!capturedToday.has(captureKey)) {
    capturedToday.add(captureKey);
    // Deliberately not awaited: the daily snapshot is bookkeeping, and no user request should
    // pay for a 200-row write. persistDailySnapshot swallows its own errors.
    void persistDailySnapshot(
      q.market,
      activeStrategy,
      canonicalEligible.slice(0, 200).map((entry) => withScore(entry.record, entry.score)),
    ).catch(() => capturedToday.delete(captureKey));
  }

  const periods = scored.map((record) => record.base.reportPeriod).filter(Boolean).sort();

  return {
    candidates,
    scanned: scored.length,
    eligible: eligible.length,
    excludedForEvidence: scored.length - eligible.length,
    activeStrategy,
    fundamentalsLatestPeriod: periods.at(-1) ?? null,
    fundamentalsOldestPeriod: periods[0] ?? null,
    generatedAt: new Date().toISOString(),
  };
}
