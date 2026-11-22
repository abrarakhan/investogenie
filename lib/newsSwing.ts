import { query, queryOne } from "@/lib/db";
import type { StrongSwingCandidate } from "@/features/strong-swing/contracts";
import type { ScreenRow } from "@/features/swing/service";
import type { TrendContinuationCandidate } from "@/features/trend-continuation/contracts";
import { rankSwingCandidates, swingDisplayScore } from "@/lib/analytics/candidateRanking";
import { displayStrongSwing, displaySwingBundle, displayTrendContinuation } from "@/lib/displayScanCache";
import { type NewsDirection, type NewsHorizon, type NewsScope, type NewsSwingScore } from "@/lib/analytics/newsSwing";
import { runPythonStrategyBatch } from "@/lib/pythonStrategyMath";
import type { SwingSettings } from "@/lib/settings";
import type { MarketId } from "@/lib/types";

export type NewsSourcePool = "STRONG_SWING" | "SWING" | "TREND_CONTINUATION";
export type NewsFilterVerdict = "KEEP" | "CAUTION" | "FILTER_OUT";
export type NewsMovementBias = "TAILWIND" | "NEUTRAL" | "HEADWIND" | "EVENT_RISK";

interface ImpactRow {
  asset_id: string | null;
  sector: string | null;
  scope: NewsScope;
  event_type: string;
  direction: NewsDirection;
  sentiment_score: string | number;
  confidence: string | number;
  severity: string | number;
  horizon: NewsHorizon;
  rationale: string;
  analysis_source: string;
  model: string | null;
  article_id: string;
  title: string;
  url: string;
  source_name: string | null;
  published_at: Date | string;
}

export interface NewsEvidence {
  articleId: string;
  title: string;
  url: string;
  sourceName: string | null;
  publishedAt: string;
  scope: NewsScope;
  eventType: string;
  direction: NewsDirection;
  sentimentScore: number;
  confidence: number;
  severity: number;
  horizon: NewsHorizon;
  rationale: string;
  analysisSource: string;
  model: string | null;
}

export interface NewsSwingCandidate extends StrongSwingCandidate, NewsSwingScore {
  news: NewsEvidence[];
  sourcePool: NewsSourcePool;
  filterVerdict: NewsFilterVerdict;
  movementBias: NewsMovementBias;
  upcomingResultsDate: string | null;
  daysToResults: number | null;
  resultsBlackout: boolean;
}

export interface NewsSwingWorkspace {
  source: NewsSourcePool;
  candidates: NewsSwingCandidate[];
  lastFetchedAt: string | null;
  articleCount: number;
  impactCount: number;
}

const iso = (value: Date | string) => new Date(value).toISOString();

function swingRowToBase(row: ScreenRow, rank: number): StrongSwingCandidate {
  const price = row.lastQuote ?? row.close;
  return {
    ...row,
    latestClose: row.close,
    latestDate: row.asOf,
    strongSwingRank: rank,
    status: row.verdict === "STRONG_SETUP" ? "EXECUTION_READY" : "WATCHLIST",
    strengthScore: swingDisplayScore(row, null),
    strongEntry: row.entry ?? price,
    strongTarget: row.target ?? price,
    strongStop: row.stopLoss ?? price,
    strongTrail: row.trailingStop ?? row.stopLoss ?? price,
    strongExpectedDays: row.expectedDays ?? 10,
    fiveDayReturnPct: null,
    tenDayReturnPct: null,
    averageTradedValue20: 0,
    atrPct: 0,
    stopDistancePct: 0,
    stopDistanceAtr: 0,
    entryDistancePct: 0,
    liveQuoteVerified: row.lastQuote !== null,
    quoteUpdatedAt: null,
    bestBid: null,
    bestAsk: null,
    spreadPct: null,
    lowerCircuit: null,
    upperCircuit: null,
    quoteSource: null,
    gates: [],
    reasons: row.reason ? [row.reason] : [],
    confirmationCloseDate: row.asOf,
  } as unknown as StrongSwingCandidate;
}

function trendCandidateToBase(item: TrendContinuationCandidate, rank: number): StrongSwingCandidate {
  const price = item.currentPrice ?? item.entry ?? 0;
  const variant = typeof item.metrics.setup_variant === "string" ? item.metrics.setup_variant : null;
  return {
    assetId: item.assetId,
    ticker: item.ticker,
    name: item.name,
    exchange: "NSE",
    latestClose: price,
    lastQuote: item.currentPrice,
    latestDate: item.asOfMarketDate,
    strongSwingRank: rank,
    status: item.ready ? "EXECUTION_READY" : "WATCHLIST",
    strengthScore: item.score,
    strongEntry: item.entry ?? price,
    strongTarget: item.target ?? price,
    strongStop: item.stop ?? price,
    strongTrail: item.stop ?? price,
    strongExpectedDays: 10,
    peRatio: null,
    roce: null,
    profitVarYoY: null,
    salesVarYoY: null,
    isBreakout: true,
    isSqueeze: false,
    isLongBuildup: false,
    buildupSource: null,
    strategyTags: variant ? [variant] : ["TREND_CONTINUATION"],
    gates: [],
    reasons: item.reasons,
  } as unknown as StrongSwingCandidate;
}

function deriveVerdictAndBias(
  state: NewsSwingScore["state"],
  resultsBlackout: boolean,
): { filterVerdict: NewsFilterVerdict; movementBias: NewsMovementBias } {
  if (state === "RISK_OFF") return { filterVerdict: "FILTER_OUT", movementBias: "HEADWIND" };
  if (resultsBlackout) return { filterVerdict: "CAUTION", movementBias: "EVENT_RISK" };
  if (state === "CAUTION") return { filterVerdict: "CAUTION", movementBias: "HEADWIND" };
  if (state === "FAVORED") return { filterVerdict: "KEEP", movementBias: "TAILWIND" };
  return { filterVerdict: "KEEP", movementBias: "NEUTRAL" };
}

export async function getNewsSwingWorkspace(
  market: MarketId,
  settings: SwingSettings,
  source: NewsSourcePool = "STRONG_SWING",
): Promise<NewsSwingWorkspace> {
  const effectiveSource: NewsSourcePool =
    source === "TREND_CONTINUATION" && market !== "IN" ? "STRONG_SWING" : source;

  let base: StrongSwingCandidate[] = [];
  if (effectiveSource === "STRONG_SWING") {
    base = (await displayStrongSwing(market, settings)).slice(0, 30);
  } else if (effectiveSource === "SWING") {
    const { rows } = await displaySwingBundle(market, { ...settings, includeShort: false });
    const setups = rows.filter((row) => row.verdict !== "NO_SETUP");
    base = rankSwingCandidates(setups, null)
      .slice(0, 30)
      .map((row, idx) => swingRowToBase(row, idx + 1));
  } else {
    const trend = await displayTrendContinuation(market);
    base = trend
      .filter((item) => item.status !== "EXTENDED_RISK")
      .slice(0, 30)
      .map((item, idx) => trendCandidateToBase(item, idx + 1));
  }

  const ids = base.map((row) => row.assetId);
  const [impacts, sectors, eventRows] = ids.length
    ? await Promise.all([
      query<ImpactRow>(
        `select i.asset_id,i.sector,i.scope,i.event_type,i.direction,i.sentiment_score,
                i.confidence,i.severity,i.horizon,i.rationale,i.analysis_source,i.model,
                a.id article_id,a.title,a.url,a.source_name,a.published_at
           from public.news_impacts i
           join public.news_articles a on a.id=i.article_id
          where i.market=$1 and a.published_at >= now() - interval '7 days'
            and (i.asset_id is null or i.asset_id=any($2::uuid[]))
          order by a.published_at desc`,
        [market, ids],
      ),
      query<{ id: string; sector: string | null }>(
        `select id,sector from public.assets where id=any($1::uuid[])`,
        [ids],
      ),
      query<{ asset_id: string; next_date: string; days_away: number }>(
        `select asset_id, min(event_date)::text next_date,
                (min(event_date) - current_date)::int days_away
           from public.corporate_events
          where asset_id=any($1::uuid[])
            and event_type='RESULTS'
            and event_date >= current_date
          group by asset_id`,
        [ids],
      ).catch(() => []),
    ])
    : [[], [], []];

  const sectorByAsset = new Map(sectors.map((row) => [row.id, row.sector]));
  const resultsByAsset = new Map(eventRows.map((row) => [row.asset_id, row]));
  const evidence = impacts.map((row): NewsEvidence & { assetId: string | null; sector: string | null } => ({
    assetId: row.asset_id,
    sector: row.sector,
    articleId: row.article_id,
    title: row.title,
    url: row.url,
    sourceName: row.source_name,
    publishedAt: iso(row.published_at),
    scope: row.scope,
    eventType: row.event_type,
    direction: row.direction,
    sentimentScore: Number(row.sentiment_score),
    confidence: Number(row.confidence),
    severity: Number(row.severity),
    horizon: row.horizon,
    rationale: row.rationale,
    analysisSource: row.analysis_source,
    model: row.model,
  }));

  const candidateMeta = base.map((row) => {
    const sector = sectorByAsset.get(row.assetId);
    const news = evidence.filter((item) =>
      item.scope === "MARKET"
      || (item.scope === "ASSET" && item.assetId === row.assetId)
      || (item.scope === "SECTOR" && item.sector && item.sector === sector),
    );
    return { row, news };
  });
  const scored = await runPythonStrategyBatch<{
    ticker: string; technicalScore: number; impacts: NewsEvidence[]; now: string;
  }, NewsSwingScore & { pythonRank: number }>("news_swing", candidateMeta.map(({ row, news }) => ({
    ticker: row.ticker, technicalScore: row.strengthScore, impacts: news, now: new Date().toISOString(),
  })));
  const candidates = candidateMeta.map(({ row, news }, index): NewsSwingCandidate & { pythonRank: number } => {
    const score = scored[index];
    const upcoming = resultsByAsset.get(row.assetId);
    const daysToResults = upcoming ? Number(upcoming.days_away) : null;
    const resultsBlackout = daysToResults !== null && daysToResults <= 3;
    const { filterVerdict, movementBias } = deriveVerdictAndBias(score.state, resultsBlackout);
    return {
      ...row,
      ...score,
      news,
      sourcePool: effectiveSource,
      filterVerdict,
      movementBias,
      upcomingResultsDate: upcoming?.next_date ?? null,
      daysToResults,
      resultsBlackout,
    };
  }).sort((left, right) => left.pythonRank - right.pythonRank);

  const summary = await queryOne<{ last_fetched_at: Date | null; article_count: string; impact_count: string }>(
    `select max(a.fetched_at) last_fetched_at,
            count(distinct a.id)::text article_count,
            count(i.id)::text impact_count
       from public.news_articles a
       join public.news_impacts i on i.article_id=a.id and i.market=$1
      where a.fetched_at >= now() - interval '7 days'`,
    [market],
  );
  return {
    source: effectiveSource,
    candidates,
    lastFetchedAt: summary?.last_fetched_at ? iso(summary.last_fetched_at) : null,
    articleCount: Number(summary?.article_count ?? 0),
    impactCount: Number(summary?.impact_count ?? 0),
  };
}
