import { query, queryOne } from "@/lib/db";
import { runScreener, type ScreenRow } from "@/lib/screener";
import { rankNewsSwingCandidates, scoreNewsSwing, type NewsDirection, type NewsHorizon, type NewsScope, type NewsSwingScore } from "@/lib/analytics/newsSwing";
import type { SwingSettings } from "@/lib/settings";
import type { MarketId } from "@/lib/types";

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

export interface NewsSwingCandidate extends ScreenRow, NewsSwingScore {
  news: NewsEvidence[];
}

export interface NewsSwingWorkspace {
  candidates: NewsSwingCandidate[];
  lastFetchedAt: string | null;
  articleCount: number;
  impactCount: number;
}

const iso = (value: Date | string) => new Date(value).toISOString();

export async function getNewsSwingWorkspace(
  market: MarketId,
  settings: SwingSettings,
): Promise<NewsSwingWorkspace> {
  const base = await runScreener(
    market,
    { ...settings, includeShort: false },
    market === "IN" ? { exchange: "NSE", limit: 30 } : { limit: 30 },
  );
  const ids = base.map((row) => row.assetId);
  const impacts = ids.length ? await query<ImpactRow>(
    `select i.asset_id,i.sector,i.scope,i.event_type,i.direction,i.sentiment_score,
            i.confidence,i.severity,i.horizon,i.rationale,i.analysis_source,i.model,
            a.id article_id,a.title,a.url,a.source_name,a.published_at
       from public.news_impacts i
       join public.news_articles a on a.id=i.article_id
      where i.market=$1 and a.published_at >= now() - interval '7 days'
        and (i.asset_id is null or i.asset_id=any($2::uuid[]))
      order by a.published_at desc`,
    [market, ids],
  ) : [];
  const sectors = await query<{ id: string; sector: string | null }>(
    `select id,sector from public.assets where id=any($1::uuid[])`,
    [ids],
  );
  const sectorByAsset = new Map(sectors.map((row) => [row.id, row.sector]));
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

  const candidates = rankNewsSwingCandidates(base.map((row): NewsSwingCandidate => {
    const sector = sectorByAsset.get(row.assetId);
    const news = evidence.filter((item) =>
      item.scope === "MARKET"
      || (item.scope === "ASSET" && item.assetId === row.assetId)
      || (item.scope === "SECTOR" && item.sector && item.sector === sector),
    );
    const score = scoreNewsSwing(row.score, news);
    return { ...row, ...score, news };
  }));

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
    candidates,
    lastFetchedAt: summary?.last_fetched_at ? iso(summary.last_fetched_at) : null,
    articleCount: Number(summary?.article_count ?? 0),
    impactCount: Number(summary?.impact_count ?? 0),
  };
}
