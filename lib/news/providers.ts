import type { ActiveNewsConfig } from "@/lib/credentials-actions";
import type { MarketId } from "@/lib/types";

export interface NewsCandidateRef {
  ticker: string;
  name: string | null;
}

export interface ProviderTickerSentiment {
  ticker: string;
  score: number;
  relevance: number;
}

export interface NormalizedNewsArticle {
  provider: ActiveNewsConfig["provider"];
  providerArticleId: string | null;
  url: string;
  title: string;
  description: string | null;
  sourceName: string | null;
  imageUrl: string | null;
  publishedAt: string;
  tickerSentiments: ProviderTickerSentiment[];
  rawPayload: unknown;
}

const MACRO_QUERY: Record<MarketId, string> = {
  IN: '(India market OR RBI OR "repo rate" OR Nifty OR Sensex) (stocks OR economy OR inflation OR war)',
  US: '(US market OR Federal Reserve OR "interest rate" OR S&P OR Nasdaq) (stocks OR economy OR inflation OR war)',
};

const GNEWS_MACRO_QUERY: Record<MarketId, string> = {
  IN: '(India AND (stocks OR market OR economy)) OR RBI OR "repo rate" OR Nifty OR Sensex',
  US: '("United States" AND (stocks OR market OR economy)) OR "Federal Reserve" OR "interest rate" OR "S&P 500" OR Nasdaq',
};

function dateFrom(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function candidateQueries(candidates: NewsCandidateRef[], maxLength: number): string[] {
  const terms = candidates.slice(0, 20).map((candidate) => {
    const name = candidate.name?.trim();
    return name && name.toUpperCase() !== candidate.ticker.toUpperCase()
      ? `"${name.replaceAll('"', "")}" OR ${candidate.ticker}`
      : candidate.ticker;
  });
  const queries: string[] = [];
  let current = "";
  for (const term of terms) {
    const next = current ? `${current} OR ${term}` : term;
    if (next.length > maxLength && current) {
      queries.push(`(${current})`);
      current = term;
    } else current = next;
  }
  if (current) queries.push(`(${current})`);
  return queries.slice(0, 4);
}

function quoteGNewsPhrase(value: string, maxLength: number): string {
  const cleaned = value
    .replace(/["\\\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .trim();
  return `"${cleaned}"`;
}

/** GNews rejects unquoted special characters and q values over 200 chars. */
export function buildGNewsQueries(candidates: NewsCandidateRef[]): string[] {
  const terms = candidates.slice(0, 20).map((candidate) => {
    const ticker = quoteGNewsPhrase(candidate.ticker, 30);
    const name = candidate.name?.trim();
    if (!name || name.toUpperCase() === candidate.ticker.toUpperCase()) return ticker;
    return `(${quoteGNewsPhrase(name, 72)} OR ${ticker})`;
  });
  const queries: string[] = [];
  let current = "";
  for (const term of terms) {
    const next = current ? `${current} OR ${term}` : term;
    if (next.length > 195 && current) {
      queries.push(current);
      current = term;
    } else current = next;
  }
  if (current) queries.push(current);
  return queries.slice(0, 4);
}

async function jsonFetch(url: URL, init?: RequestInit, retries = 2): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    if (response.ok) return response.json();
    const body = await response.text();
    if (response.status !== 429 || attempt >= retries) {
      throw new Error(`News provider request failed (${response.status}): ${body}`);
    }
    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? Math.min(10_000, retryAfterSeconds * 1_000)
      : 1_250 * (attempt + 1);
    await sleep(delayMs);
  }
}

function validIso(value: unknown): string {
  const raw = String(value ?? "");
  const alpha = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  const normalized = alpha
    ? `${alpha[1]}-${alpha[2]}-${alpha[3]}T${alpha[4]}:${alpha[5]}:${alpha[6]}Z`
    : raw;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

async function fetchAlphaVantage(
  apiKey: string,
  market: MarketId,
): Promise<NormalizedNewsArticle[]> {
  const url = new URL("https://www.alphavantage.co/query");
  url.searchParams.set("function", "NEWS_SENTIMENT");
  url.searchParams.set("topics", "financial_markets,economy_monetary,economy_macro");
  url.searchParams.set("time_from", dateFrom(72).replace(/[-:]/g, "").slice(0, 13));
  url.searchParams.set("sort", "LATEST");
  url.searchParams.set("limit", "200");
  url.searchParams.set("apikey", apiKey);
  const data = await jsonFetch(url) as { feed?: Array<Record<string, unknown>>; Note?: string; Information?: string };
  if (data.Note || data.Information) throw new Error(String(data.Note ?? data.Information));
  return (data.feed ?? []).map((item) => ({
    provider: "alpha_vantage" as const,
    providerArticleId: null,
    url: String(item.url ?? ""),
    title: String(item.title ?? "Untitled market update"),
    description: item.summary ? String(item.summary) : null,
    sourceName: item.source ? String(item.source) : null,
    imageUrl: item.banner_image ? String(item.banner_image) : null,
    publishedAt: validIso(item.time_published),
    tickerSentiments: Array.isArray(item.ticker_sentiment)
      ? (item.ticker_sentiment as Array<Record<string, unknown>>).map((entry) => ({
          ticker: String(entry.ticker ?? "").replace(/^[A-Z]+:/, ""),
          score: Number(entry.ticker_sentiment_score) || 0,
          relevance: Number(entry.relevance_score) || 0,
        }))
      : [],
    rawPayload: { ...item, requested_market: market },
  })).filter((item) => item.url);
}

async function fetchGNews(
  apiKey: string,
  market: MarketId,
  candidates: NewsCandidateRef[],
): Promise<NormalizedNewsArticle[]> {
  const queries = [GNEWS_MACRO_QUERY[market], ...buildGNewsQueries(candidates)];
  const batches: Array<Array<Record<string, unknown>>> = [];
  const failures: unknown[] = [];
  for (const [index, query] of queries.entries()) {
    try {
      const url = new URL("https://gnews.io/api/v4/search");
      url.searchParams.set("q", query);
      url.searchParams.set("lang", "en");
      url.searchParams.set("country", market === "IN" ? "in" : "us");
      url.searchParams.set("from", dateFrom(72));
      url.searchParams.set("sortby", "publishedAt");
      url.searchParams.set("max", "10");
      url.searchParams.set("apikey", apiKey);
      const data = await jsonFetch(url) as { articles?: Array<Record<string, unknown>> };
      batches.push(data.articles ?? []);
    } catch (error) {
      failures.push(error);
    }
    if (index < queries.length - 1) await sleep(1_100);
  }
  if (!batches.length) {
    throw failures[0] ?? new Error("GNews returned no usable response.");
  }
  if (!batches.some((batch) => batch.length)) {
    throw failures[0] ?? new Error("GNews returned no articles from the last 72 hours.");
  }
  return batches.flat().map((item) => {
    const source = (item.source ?? {}) as Record<string, unknown>;
    return {
      provider: "gnews" as const,
      providerArticleId: item.id ? String(item.id) : null,
      url: String(item.url ?? ""),
      title: String(item.title ?? "Untitled market update"),
      description: item.description ? String(item.description) : null,
      sourceName: source.name ? String(source.name) : null,
      imageUrl: item.image ? String(item.image) : null,
      publishedAt: validIso(item.publishedAt),
      tickerSentiments: [],
      rawPayload: item,
    };
  }).filter((item) => item.url);
}

async function fetchNewsApi(
  apiKey: string,
  market: MarketId,
  candidates: NewsCandidateRef[],
): Promise<NormalizedNewsArticle[]> {
  const queries = [MACRO_QUERY[market], ...candidateQueries(candidates, 450)];
  const batches = await Promise.all(queries.map(async (query) => {
    const url = new URL("https://newsapi.org/v2/everything");
    url.searchParams.set("q", query);
    url.searchParams.set("language", "en");
    url.searchParams.set("from", dateFrom(72));
    url.searchParams.set("sortBy", "publishedAt");
    url.searchParams.set("pageSize", "25");
    const data = await jsonFetch(url, { headers: { "X-Api-Key": apiKey } }) as {
      status?: string;
      message?: string;
      articles?: Array<Record<string, unknown>>;
    };
    if (data.status === "error") throw new Error(data.message ?? "NewsAPI request failed");
    return data.articles ?? [];
  }));
  return batches.flat().map((item) => {
    const source = (item.source ?? {}) as Record<string, unknown>;
    return {
      provider: "newsapi" as const,
      providerArticleId: null,
      url: String(item.url ?? ""),
      title: String(item.title ?? "Untitled market update"),
      description: item.description ? String(item.description) : null,
      sourceName: source.name ? String(source.name) : null,
      imageUrl: item.urlToImage ? String(item.urlToImage) : null,
      publishedAt: validIso(item.publishedAt),
      tickerSentiments: [],
      rawPayload: item,
    };
  }).filter((item) => item.url);
}

export async function fetchNews(
  config: ActiveNewsConfig,
  market: MarketId,
  candidates: NewsCandidateRef[],
): Promise<NormalizedNewsArticle[]> {
  const articles = config.provider === "alpha_vantage"
    ? await fetchAlphaVantage(config.apiKey, market)
    : config.provider === "gnews"
      ? await fetchGNews(config.apiKey, market, candidates)
      : await fetchNewsApi(config.apiKey, market, candidates);
  const unique = new Map(articles.map((article) => [article.url, article]));
  return [...unique.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
