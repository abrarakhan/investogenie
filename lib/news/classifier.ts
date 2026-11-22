import Anthropic from "@anthropic-ai/sdk";
import type { ActiveAIConfig } from "@/lib/credentials.server";
import type { MarketId } from "@/lib/types";
import type { NewsDirection, NewsHorizon, NewsScope } from "@/lib/analytics/newsSwing";
import type { NormalizedNewsArticle } from "./providers";

export interface NewsAssetRef {
  assetId: string;
  ticker: string;
  name: string | null;
  sector: string | null;
}

export interface ClassifiedImpact {
  articleIndex: number;
  market: MarketId;
  assetId: string | null;
  sector: string | null;
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
  verifiedEvidence: boolean;
}

const POSITIVE = ["beats estimates", "record profit", "raises guidance", "rate cut", "approval", "wins order", "contract win", "upgrade", "buyback", "dividend increase", "ceasefire"];
const NEGATIVE = ["war", "attack", "market crash", "rate hike", "repo rate hike", "misses estimates", "cuts guidance", "fraud", "investigation", "default", "bankruptcy", "downgrade", "sanction", "recall"];

const clamp = (value: unknown, min: number, max: number) => Math.min(max, Math.max(min, Number(value) || 0));
const evidenceConfidenceCap = (article: NormalizedNewsArticle) => article.verifiedEvidence
  ? 1
  : (article.trustScore ?? 40) >= 85 ? 0.65 : 0.45;

function directionFromText(text: string): { direction: NewsDirection; score: number; eventType: string } {
  const lower = text.toLowerCase();
  const positive = POSITIVE.filter((term) => lower.includes(term)).length;
  const negative = NEGATIVE.filter((term) => lower.includes(term)).length;
  if (positive > negative) return { direction: "POSITIVE", score: Math.min(0.85, 0.35 + positive * 0.15), eventType: "CORPORATE_OR_MACRO_CATALYST" };
  if (negative > positive) return { direction: "NEGATIVE", score: -Math.min(0.9, 0.4 + negative * 0.15), eventType: "EVENT_RISK" };
  return { direction: "NEUTRAL", score: 0, eventType: "GENERAL_NEWS" };
}

/** Transparent fallback used when no AI model is configured or a model call fails. */
export function classifyDeterministically(
  market: MarketId,
  articles: NormalizedNewsArticle[],
  assets: NewsAssetRef[],
): ClassifiedImpact[] {
  const impacts: ClassifiedImpact[] = [];
  articles.forEach((article, articleIndex) => {
    const text = `${article.title} ${article.description ?? ""}`;
    const basic = directionFromText(text);
    const direct = assets.filter((asset) => {
      const ticker = new RegExp(`\\b${asset.ticker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      return ticker.test(text) || Boolean(asset.name && asset.name.length >= 4 && text.toLowerCase().includes(asset.name.toLowerCase()));
    });
    const providerLinks = article.tickerSentiments
      .map((entry) => ({ entry, asset: assets.find((asset) => asset.ticker.toUpperCase() === entry.ticker.toUpperCase()) }))
      .filter((item): item is { entry: typeof article.tickerSentiments[number]; asset: NewsAssetRef } => Boolean(item.asset));

    const linked = new Map<string, { asset: NewsAssetRef; providerScore?: number; relevance?: number }>();
    direct.forEach((asset) => linked.set(asset.assetId, { asset }));
    providerLinks.forEach(({ asset, entry }) => linked.set(asset.assetId, { asset, providerScore: entry.score, relevance: entry.relevance }));

    if (linked.size) {
      for (const { asset, providerScore, relevance } of linked.values()) {
        const score = providerScore ?? basic.score;
        impacts.push({
          articleIndex, market, assetId: asset.assetId, sector: asset.sector, scope: "ASSET",
          eventType: basic.eventType,
          direction: score > 0.08 ? "POSITIVE" : score < -0.08 ? "NEGATIVE" : basic.direction,
          sentimentScore: clamp(score, -1, 1), confidence: Math.min(clamp(relevance ?? 0.55, 0, 1), evidenceConfidenceCap(article)),
          severity: basic.direction === "NEUTRAL" ? 0.25 : 0.55, horizon: "SWING",
          rationale: `Headline matched ${asset.ticker}; deterministic keyword/provider sentiment, pending AI interpretation.`,
          analysisSource: article.tickerSentiments.length ? "provider_sentiment" : "deterministic_fallback", model: null,
          verifiedEvidence: article.verifiedEvidence ?? false,
        });
      }
    } else if (basic.direction !== "NEUTRAL") {
      impacts.push({
        articleIndex, market, assetId: null, sector: null, scope: "MARKET", eventType: basic.eventType,
        direction: basic.direction, sentimentScore: basic.score, confidence: 0.45,
        severity: Math.abs(basic.score), horizon: "SWING",
        rationale: "Broad market event detected by deterministic keyword fallback.",
        analysisSource: "deterministic_fallback", model: null,
        verifiedEvidence: article.verifiedEvidence ?? false,
      });
    }
  });
  return impacts;
}

function promptFor(market: MarketId, articles: NormalizedNewsArticle[], assets: NewsAssetRef[]): string {
  const compactAssets = assets.map((a) => ({ ticker: a.ticker, name: a.name, sector: a.sector }));
  const compactArticles = articles.map((a, index) => ({ index, title: a.title, description: a.description, source: a.sourceName, publishedAt: a.publishedAt, trustScore: a.trustScore, corroborationCount: a.corroborationCount, verifiedEvidence: a.verifiedEvidence }));
  return `You are a conservative financial-news event classifier for ${market === "IN" ? "Indian" : "US"} equities.
Classify only impacts directly supported by the supplied headline/description. Assess likely directional pressure and its time horizon, but do not invent facts, price targets, or certainty.
Return JSON only: {"impacts":[{"articleIndex":0,"scope":"MARKET|SECTOR|ASSET","ticker":null,"sector":null,"eventType":"...","direction":"POSITIVE|NEGATIVE|NEUTRAL","sentimentScore":-1.0,"confidence":0.0,"severity":0.0,"horizon":"INTRADAY|SWING|MEDIUM_TERM","rationale":"one short sentence"}]}.
Rules: use ASSET only for a listed ticker with direct relevance; use MARKET for war, crashes, central-bank/rate, inflation, liquidity or broad regulation; omit irrelevant articles; confidence measures attribution certainty; severity measures likely magnitude; sentimentScore is signed. For conflicting evidence, lower confidence.
Candidates: ${JSON.stringify(compactAssets)}
Articles: ${JSON.stringify(compactArticles)}`;
}

function parseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

async function callAI(ai: ActiveAIConfig, prompt: string): Promise<unknown> {
  if (ai.provider === "anthropic") {
    const client = new Anthropic({ apiKey: ai.apiKey });
    const result = await client.messages.create({ model: ai.model, max_tokens: 4000, temperature: 0, messages: [{ role: "user", content: prompt }] });
    return parseJson(result.content.filter((block) => block.type === "text").map((block) => block.text).join(""));
  }
  if (ai.provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${ai.apiKey}` },
      body: JSON.stringify({ model: ai.model, temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`OpenAI news analysis failed (${response.status})`);
    const data = await response.json();
    return parseJson(data?.choices?.[0]?.message?.content ?? "{}");
  }
  if (ai.provider === "deepseek") {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${ai.apiKey}` },
      body: JSON.stringify({
        model: ai.model,
        thinking: { type: "disabled" },
        max_tokens: 4000,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`DeepSeek news analysis failed (${response.status}): ${await response.text()}`);
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    if (!content.trim()) throw new Error("DeepSeek returned an empty news assessment");
    return parseJson(content);
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(ai.model)}:generateContent?key=${encodeURIComponent(ai.apiKey)}`;
  const response = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0 } }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`Gemini news analysis failed (${response.status})`);
  const data = await response.json();
  return parseJson((data?.candidates?.[0]?.content?.parts ?? []).map((part: { text?: string }) => part.text ?? "").join(""));
}

export async function classifyNews(
  market: MarketId,
  articles: NormalizedNewsArticle[],
  assets: NewsAssetRef[],
  ai: ActiveAIConfig | null,
): Promise<ClassifiedImpact[]> {
  const fallback = classifyDeterministically(market, articles, assets);
  if (!ai || !articles.length) return fallback;
  try {
    const raw = await callAI(ai, promptFor(market, articles, assets)) as { impacts?: Array<Record<string, unknown>> };
    const byTicker = new Map(assets.map((asset) => [asset.ticker.toUpperCase(), asset]));
    return (raw.impacts ?? []).flatMap((item): ClassifiedImpact[] => {
      const articleIndex = Number(item.articleIndex);
      if (!Number.isInteger(articleIndex) || articleIndex < 0 || articleIndex >= articles.length) return [];
      const scope = ["MARKET", "SECTOR", "ASSET"].includes(String(item.scope)) ? String(item.scope) as NewsScope : "MARKET";
      const asset = scope === "ASSET" ? byTicker.get(String(item.ticker ?? "").toUpperCase()) : undefined;
      if (scope === "ASSET" && !asset) return [];
      const direction = ["POSITIVE", "NEGATIVE", "NEUTRAL"].includes(String(item.direction)) ? String(item.direction) as NewsDirection : "NEUTRAL";
      const horizon = ["INTRADAY", "SWING", "MEDIUM_TERM"].includes(String(item.horizon)) ? String(item.horizon) as NewsHorizon : "SWING";
      const signed = clamp(item.sentimentScore, -1, 1);
      return [{
        articleIndex, market, assetId: asset?.assetId ?? null,
        sector: scope === "SECTOR" ? String(item.sector ?? "") || null : asset?.sector ?? null,
        scope, eventType: String(item.eventType ?? "GENERAL_NEWS").slice(0, 80), direction,
        sentimentScore: direction === "NEGATIVE" ? -Math.abs(signed) : direction === "POSITIVE" ? Math.abs(signed) : 0,
        confidence: Math.min(clamp(item.confidence, 0, 1), evidenceConfidenceCap(articles[articleIndex])), severity: clamp(item.severity, 0, 1), horizon,
        rationale: String(item.rationale ?? "AI-classified event impact.").slice(0, 400),
        analysisSource: `ai:${ai.provider}`, model: ai.model,
        verifiedEvidence: articles[articleIndex].verifiedEvidence ?? false,
      }];
    });
  } catch (error) {
    console.error("[news-ai] classification failed; using deterministic fallback", error);
    return fallback;
  }
}

export type BriefVerdict = "KEEP" | "CAUTION" | "FILTER_OUT";
export type BriefMovementBias = "TAILWIND" | "NEUTRAL" | "HEADWIND" | "EVENT_RISK";

export interface StockNewsBrief {
  market: MarketId;
  assetId: string;
  ticker: string;
  verdict: BriefVerdict;
  movementBias: BriefMovementBias;
  summary: string;
  catalystNote: string | null;
  riskNote: string | null;
  articleCount: number;
  analysisSource: string;
  model: string | null;
}

function synthesizeBriefsDeterministically(
  market: MarketId,
  grouped: Array<{ asset: NewsAssetRef; items: Array<{ impact: ClassifiedImpact; title: string }> }>,
): StockNewsBrief[] {
  return grouped.map(({ asset, items }) => {
    const pos = items.filter((entry) => entry.impact.direction === "POSITIVE");
    const neg = items.filter((entry) => entry.impact.direction === "NEGATIVE");
    const severeNeg = neg.some((entry) => entry.impact.severity >= 0.7 && entry.impact.confidence >= 0.55);
    const verdict: BriefVerdict = severeNeg ? "FILTER_OUT" : neg.length > pos.length ? "CAUTION" : "KEEP";
    const movementBias: BriefMovementBias = severeNeg || neg.length > pos.length
      ? "HEADWIND"
      : pos.length > neg.length
        ? "TAILWIND"
        : "NEUTRAL";
    const leadPos = pos[0]?.title ?? null;
    const leadNeg = neg[0]?.title ?? null;
    const summary = verdict === "FILTER_OUT"
      ? `High-severity adverse news linked to ${asset.ticker} (${neg.length} negative item${neg.length === 1 ? "" : "s"}). Filter out until headline risk clears.`
      : verdict === "CAUTION"
        ? `Mixed-to-negative news flow (${neg.length} negative, ${pos.length} positive) suggests near-term headline drag for ${asset.ticker}.`
        : pos.length > 0
          ? `Constructive news flow (${pos.length} positive item${pos.length === 1 ? "" : "s"}) supports technical continuation for ${asset.ticker}.`
          : `Recent headlines linked to ${asset.ticker} are neutral with no material directional shift.`;
    return {
      market,
      assetId: asset.assetId,
      ticker: asset.ticker,
      verdict,
      movementBias,
      summary: summary.slice(0, 420),
      catalystNote: leadPos ? leadPos.slice(0, 220) : null,
      riskNote: leadNeg ? leadNeg.slice(0, 220) : null,
      articleCount: items.length,
      analysisSource: "deterministic_brief",
      model: null,
    };
  });
}

function briefPromptFor(
  market: MarketId,
  grouped: Array<{ asset: NewsAssetRef; items: Array<{ impact: ClassifiedImpact; title: string }> }>,
  marketHeadlines: string[],
): string {
  const payload = grouped.map(({ asset, items }) => ({
    ticker: asset.ticker,
    name: asset.name,
    sector: asset.sector,
    headlines: items.slice(0, 5).map(({ impact, title }) => ({
      scope: impact.scope,
      direction: impact.direction,
      severity: impact.severity,
      confidence: impact.confidence,
      eventType: impact.eventType,
      title,
      rationale: impact.rationale,
    })),
  }));
  return `You are a disciplined swing-trading risk analyst for ${market === "IN" ? "Indian" : "US"} equities.
For each stock below, synthesize ONLY the supplied headlines and macro context into a concise filter verdict to separate clean setups from headline-risky stocks.
Return JSON only: {"briefs":[{"ticker":"...","verdict":"KEEP|CAUTION|FILTER_OUT","movementBias":"TAILWIND|NEUTRAL|HEADWIND|EVENT_RISK","summary":"1-2 short factual sentences on expected near-term pressure","catalystNote":"short positive driver or null","riskNote":"short risk/headwind or null"}]}.
Rules: never invent facts, price targets, or buy/sell advice; use FILTER_OUT only for severe adverse risk (fraud, default, regulatory action, major earnings miss, guidance cut, sharp dilution); use CAUTION for mixed/uncertain headlines or event-gap risk; use KEEP when news is supportive or benign.
Broad market headlines: ${JSON.stringify(marketHeadlines.slice(0, 6))}
Stocks: ${JSON.stringify(payload)}`;
}

/**
 * Synthesize one cached movement & filter brief per stock with linked news.
 * Runs only during news refresh (never on page loads) and falls back cleanly.
 */
export async function synthesizeStockBriefs(
  market: MarketId,
  assets: NewsAssetRef[],
  articles: NormalizedNewsArticle[],
  impacts: ClassifiedImpact[],
  ai: ActiveAIConfig | null,
): Promise<StockNewsBrief[]> {
  const assetById = new Map(assets.map((asset) => [asset.assetId, asset]));
  const itemsByAsset = new Map<string, Array<{ impact: ClassifiedImpact; title: string }>>();
  const marketHeadlines: string[] = [];

  for (const impact of impacts) {
    const article = articles[impact.articleIndex];
    if (!article) continue;
    if (impact.scope === "MARKET") {
      if (impact.direction !== "NEUTRAL") marketHeadlines.push(article.title);
      continue;
    }
    if (impact.scope === "ASSET" && impact.assetId && assetById.has(impact.assetId)) {
      const list = itemsByAsset.get(impact.assetId) ?? [];
      list.push({ impact, title: article.title });
      itemsByAsset.set(impact.assetId, list);
    } else if (impact.scope === "SECTOR" && impact.sector) {
      for (const asset of assets) {
        if (asset.sector && asset.sector === impact.sector) {
          const list = itemsByAsset.get(asset.assetId) ?? [];
          list.push({ impact, title: article.title });
          itemsByAsset.set(asset.assetId, list);
        }
      }
    }
  }

  const grouped = [...itemsByAsset.entries()]
    .slice(0, 25)
    .map(([assetId, items]) => ({ asset: assetById.get(assetId)!, items }));
  if (!grouped.length) return [];

  const fallback = synthesizeBriefsDeterministically(market, grouped);
  if (!ai) return fallback;

  try {
    const raw = await callAI(ai, briefPromptFor(market, grouped, marketHeadlines)) as {
      briefs?: Array<Record<string, unknown>>;
    };
    const byTicker = new Map(grouped.map((entry) => [entry.asset.ticker.toUpperCase(), entry]));
    const parsed: StockNewsBrief[] = [];
    for (const item of raw.briefs ?? []) {
      const entry = byTicker.get(String(item.ticker ?? "").toUpperCase());
      if (!entry) continue;
      const verdict = ["KEEP", "CAUTION", "FILTER_OUT"].includes(String(item.verdict))
        ? (String(item.verdict) as BriefVerdict)
        : "CAUTION";
      const movementBias = ["TAILWIND", "NEUTRAL", "HEADWIND", "EVENT_RISK"].includes(String(item.movementBias))
        ? (String(item.movementBias) as BriefMovementBias)
        : "NEUTRAL";
      const summary = String(item.summary ?? "").trim();
      if (!summary) continue;
      parsed.push({
        market,
        assetId: entry.asset.assetId,
        ticker: entry.asset.ticker,
        verdict,
        movementBias,
        summary: summary.slice(0, 420),
        catalystNote: item.catalystNote ? String(item.catalystNote).trim().slice(0, 220) : null,
        riskNote: item.riskNote ? String(item.riskNote).trim().slice(0, 220) : null,
        articleCount: entry.items.length,
        analysisSource: `ai:${ai.provider}`,
        model: ai.model,
      });
    }
    return parsed.length ? parsed : fallback;
  } catch (error) {
    console.error("[news-ai] stock brief synthesis failed; using deterministic brief fallback", error);
    return fallback;
  }
}
