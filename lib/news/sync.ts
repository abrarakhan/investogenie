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
    `select a.id asset_id, a.ticker, a.name, a.sector
       from public.swing_signals s
       join public.assets a on a.id = s.asset_id
      where s.country = $1 and s.bias <> 'SHORT' and s.verdict <> 'NO_SETUP'
      order by s.score desc, a.ticker
      limit 30`,
    [market],
  );
  const assets: NewsAssetRef[] = rows.map((row) => ({
    assetId: row.asset_id, ticker: row.ticker, name: row.name, sector: row.sector,
  }));
  const fetched = await fetchNews(news, market, assets);
  const articles = fetched.slice(0, 50);
  const impacts = await classifyNews(market, articles, assets, ai);

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
    analysisSource: ai ? `ai:${ai.provider}/${ai.model}` : "deterministic_fallback",
  };
}
