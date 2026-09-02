import { tx, query } from "@/lib/db";
import type { ActiveAIConfig, ActiveNewsConfig } from "@/lib/credentials-actions";
import type { MarketId } from "@/lib/types";
import { classifyNews, type NewsAssetRef } from "./classifier";
import { fetchNews } from "./providers";

interface CandidateRow {
  asset_id: string;
  ticker: string;
  name: string | null;
  sector: string | null;
}

export interface NewsSyncSummary {
  market: MarketId;
  provider: ActiveNewsConfig["provider"];
  fetched: number;
  stored: number;
  impacts: number;
  analysisSource: string;
}

export async function refreshNewsIntelligence(
  market: MarketId,
  news: ActiveNewsConfig,
  ai: ActiveAIConfig | null,
): Promise<NewsSyncSummary> {
  const rows = await query<CandidateRow>(
    `with latest_scan as (
       select max(as_of) as_of from public.swing_signals where country=$1
     ), ranked as (
       select distinct on (a.id) a.id asset_id, a.ticker, a.name, a.sector, s.score
         from public.swing_signals s
         join public.assets a on a.id = s.asset_id
         join latest_scan latest on latest.as_of=s.as_of
        where s.country = $1 and s.bias <> 'SHORT' and s.verdict <> 'NO_SETUP'
          and a.is_active
          and not exists (select 1 from public.asset_tracking_exclusions x where x.asset_id=a.id)
          and exists (select 1 from public.daily_ohlcv o where o.asset_id=a.id and o.date >= current_date - interval '4 days')
          and exists (
            select 1 from public.latest_quotes q
             where q.asset_id=a.id
               and q.as_of::date >= case
                 when a.country='IN'
                  and extract(isodow from now() at time zone 'Asia/Kolkata') between 1 and 5
                  and (now() at time zone 'Asia/Kolkata')::time between time '09:15' and time '15:30'
                   then (now() at time zone 'Asia/Kolkata')::date
                 when a.country='US'
                  and extract(isodow from now() at time zone 'America/New_York') between 1 and 5
                  and (now() at time zone 'America/New_York')::time between time '09:30' and time '16:00'
                   then (now() at time zone 'America/New_York')::date
                 else current_date - 4
               end
          )
        order by a.id, s.score desc
     )
     select asset_id,ticker,name,sector from ranked
      order by score desc,ticker
      limit 30`,
    [market],
  );
  // Open real trades remain exposed to event risk even after they leave the
  // current top-candidate list. Always include them in news retrieval and AI
  // classification so ledger monitoring does not silently stop after entry.
  const ledgerRows = await query<CandidateRow>(
    `select distinct a.id asset_id,a.ticker,a.name,a.sector
       from public.swing_trade_ledger l
       join public.assets a on a.id=l.asset_id
      where l.market=$1 and l.status='OPEN' and a.is_active`,
    [market],
  );
  const tracked = new Map([...rows, ...ledgerRows].map((row) => [row.asset_id, row]));
  const assets: NewsAssetRef[] = [...tracked.values()].map((row) => ({
    assetId: row.asset_id, ticker: row.ticker, name: row.name, sector: row.sector,
  }));
  const fetched = await fetchNews(news, market, assets);
  if (!fetched.length) {
    throw new Error(`No ${market} news articles were returned from ${news.provider} for the last 72 hours.`);
  }
  const articles = fetched.slice(0, 50);
  const impacts = await classifyNews(market, articles, assets, ai);
  const aiSucceeded = impacts.some((impact) => impact.analysisSource.startsWith("ai:"));

  const articleIds = await tx(async (client) => {
    const ids: string[] = [];
    for (const article of articles) {
      const result = await client.query<{ id: string }>(
        `insert into public.news_articles
           (provider,provider_article_id,url,title,description,source_name,image_url,published_at,raw_payload)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
         on conflict (url) do update set
           title=excluded.title, description=excluded.description, source_name=excluded.source_name,
           image_url=excluded.image_url, published_at=excluded.published_at,
           fetched_at=now(), raw_payload=excluded.raw_payload
         returning id`,
        [
          article.provider, article.providerArticleId, article.url, article.title,
          article.description, article.sourceName, article.imageUrl, article.publishedAt,
          JSON.stringify(article.rawPayload ?? {}),
        ],
      );
      ids.push(result.rows[0].id);
    }

    if (ids.length) {
      await client.query(
        `delete from public.news_impacts where market=$1 and article_id=any($2::uuid[])`,
        [market, ids],
      );
    }
    if (aiSucceeded) {
      // A successful model pass supersedes old broad keyword guesses. Keeping
      // those guesses for seven days can make an unrelated headline look like
      // current market evidence even after AI has correctly omitted it.
      await client.query(
        `delete from public.news_impacts i
          using public.news_articles a
          where i.article_id=a.id and i.market=$1
            and i.analysis_source='deterministic_fallback'
            and a.published_at >= now() - interval '7 days'`,
        [market],
      );
    }
    for (const impact of impacts) {
      const articleId = ids[impact.articleIndex];
      if (!articleId) continue;
      await client.query(
        `insert into public.news_impacts
           (article_id,market,asset_id,sector,scope,event_type,direction,sentiment_score,
            confidence,severity,horizon,rationale,analysis_source,model)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          articleId, impact.market, impact.assetId, impact.sector, impact.scope,
          impact.eventType, impact.direction, impact.sentimentScore, impact.confidence,
          impact.severity, impact.horizon, impact.rationale, impact.analysisSource, impact.model,
        ],
      );
    }
    return ids;
  });

  return {
    market,
    provider: news.provider,
    fetched: fetched.length,
    stored: articleIds.length,
    impacts: impacts.length,
    analysisSource: [...new Set(impacts.map((impact) =>
      impact.model ? `${impact.analysisSource}/${impact.model}` : impact.analysisSource,
    ))].join(", ") || "no_classified_impacts",
  };
}
