import { getArmedSwingCandidates, type ArmedSwingCandidate } from "@/lib/armedSwing";
import { ARMED_STATUS_LABEL, ARMED_WHEN_TO_ENTER } from "@/lib/armedSwingCopy";
import type { ArmedSwingStatus } from "@/lib/analytics/armedSwing";
import { rankSwingCandidates, swingDisplayScore } from "@/lib/analytics/candidateRanking";
import { STRATEGY_META, type StrategyKey } from "@/lib/analytics/legendaryStrategies";
import { LONG_TERM_STRATEGY_META, type LongTermStrategyKey } from "@/lib/analytics/longTermStrategies";
import { getLongTermCandidates } from "@/lib/long-term-actions";
import { markLiveMarketTargets } from "@/lib/liveMarketTargets";
import { runScreener, type ScreenRow } from "@/lib/screener";
import { getScreenerResults, type ScreenerStock } from "@/lib/screener/service";
import { getUserSwingSettings } from "@/lib/settings";

/**
 * Server-driven mobile screens. Every value is computed and formatted here from the same
 * server functions the web pages use, so the Android and iOS clients only render cards and
 * never re-derive levels, scores or rankings. A new screen is added here, not in the app.
 */

export type MobileMarket = "IN" | "US";
export type MobileTone = "positive" | "negative" | "warning" | "neutral";

export interface MobileMetric { label: string; value: string; tone?: MobileTone }
export interface MobileDetailRow { label: string; value?: string; detail?: string; passed?: boolean }
export interface MobileCardSection { title: string; rows: MobileDetailRow[] }

export interface MobileCard {
  id: string;
  title: string;
  subtitle: string;
  badge: { label: string; tone: MobileTone } | null;
  score: string | null;
  metrics: MobileMetric[];
  footer: string | null;
  /** Ticker for the detail view's candle chart; null hides the chart. */
  chartTicker: string | null;
  guidance: string | null;
  sections: MobileCardSection[];
}

export interface MobileScreenOption {
  param: string;
  label: string;
  value: string;
  choices: Array<{ value: string; label: string }>;
}

export interface MobileScreen {
  key: string;
  title: string;
  subtitle: string;
  generatedAt: string;
  summary: string | null;
  notice: string | null;
  options: MobileScreenOption[];
  searchable: boolean;
  cards: MobileCard[];
}

/**
 * Tab order for the apps. "native" screens have dedicated client views (trade logging, ledger
 * editing); "cards" screens are rendered generically from `loadMobileScreen`.
 */
export const MOBILE_SCREEN_CATALOG = [
  { key: "stock-screener", title: "Stock Screener", tabLabel: "Screener", kind: "cards" },
  { key: "swing", title: "Swing Candidates", tabLabel: "Swing", kind: "cards" },
  { key: "strong-swing", title: "Strong Swing", tabLabel: "Strong", kind: "native" },
  { key: "armed-swing", title: "Armed Strong Swing", tabLabel: "Armed", kind: "cards" },
  { key: "news-swing", title: "News & AI Swing", tabLabel: "News & AI", kind: "native" },
  { key: "long-term", title: "Long-Term Candidates", tabLabel: "Long-Term", kind: "cards" },
  { key: "trade-ledger", title: "Trade Ledger", tabLabel: "Ledger", kind: "native" },
] as const satisfies ReadonlyArray<{ key: string; title: string; tabLabel: string; kind: "native" | "cards" }>;

const nil = "--";
/** Most cards a screen sends; a phone list beyond this is unusable and slow to load. */
const MOBILE_CARD_LIMIT = 50;
const finite = (value: number | null | undefined): value is number => value !== null && value !== undefined && Number.isFinite(value);

export function formatMoney(value: number | null | undefined, market: MobileMarket): string {
  if (!finite(value)) return nil;
  return new Intl.NumberFormat(market === "IN" ? "en-IN" : "en-US", {
    style: "currency", currency: market === "IN" ? "INR" : "USD", maximumFractionDigits: 2,
  }).format(value);
}

export function formatPct(value: number | null | undefined, signed = true): string {
  if (!finite(value)) return nil;
  return `${signed && value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

const formatNumber = (value: number | null | undefined, digits = 1) => finite(value) ? value.toFixed(digits) : nil;
const toneOf = (value: number | null | undefined): MobileTone => !finite(value) ? "neutral" : value >= 0 ? "positive" : "negative";

/** Market cap is stored in Rs. crore for India and USD millions for the US. */
export function formatMarketCap(value: number | null | undefined, market: MobileMarket): string {
  if (!finite(value)) return nil;
  if (market === "US") {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}T`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}B`;
    return `$${Math.round(value)}M`;
  }
  if (value >= 100_000) return `${(value / 100_000).toFixed(2)}L Cr`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k Cr`;
  return `${Math.round(value)} Cr`;
}

/** A stored date or timestamp as the market's own calendar date (YYYY-MM-DD). */
export function formatMarketDate(value: Date | string | null | undefined, market: MobileMarket): string {
  if (!value) return nil;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: market === "IN" ? "Asia/Kolkata" : "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

const label = (value: string) => value.replaceAll("_", " ");
const pick = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T =>
  value && (allowed as readonly string[]).includes(value) ? value as T : fallback;

// ---- Stock screener ----------------------------------------------------------------------

const SCREENER_SORTS = [
  { value: "market_cap", label: "Market cap", field: "market_cap", dir: "desc" },
  { value: "gainers", label: "Top gainers", field: "change_pct_1d", dir: "desc" },
  { value: "losers", label: "Top losers", field: "change_pct_1d", dir: "asc" },
  { value: "momentum", label: "20D momentum", field: "return_20d", dir: "desc" },
  { value: "near_high", label: "Near 52W high", field: "pct_from_52w_high", dir: "desc" },
  { value: "volume", label: "Volume surge", field: "volume_ratio_20", dir: "desc" },
] as const;

export function stockScreenerCard(row: ScreenerStock, market: MobileMarket): MobileCard {
  return {
    id: row.asset_id,
    title: row.symbol,
    subtitle: [row.name, row.sector].filter(Boolean).join(" · ") || row.exchange,
    badge: finite(row.change_pct_1d) ? { label: formatPct(row.change_pct_1d), tone: toneOf(row.change_pct_1d) } : null,
    score: null,
    metrics: [
      { label: "LTP", value: formatMoney(row.ltp, market) },
      { label: "MCAP", value: formatMarketCap(row.market_cap, market) },
      { label: "P/E", value: formatNumber(row.pe_ratio) },
    ],
    footer: `RSI ${formatNumber(row.rsi_14, 0)} · 20D ${formatPct(row.return_20d)} · ${formatPct(row.pct_from_52w_high)} from 52W high`,
    chartTicker: row.symbol,
    guidance: null,
    sections: [
      {
        title: "Fundamentals",
        rows: [
          { label: "ROE", value: formatPct(row.roe, false) },
          { label: "ROCE", value: formatPct(row.roce, false) },
          { label: "Debt / equity", value: formatNumber(row.debt_to_equity, 2) },
          { label: "Dividend yield", value: formatPct(row.dividend_yield, false) },
          { label: "Revenue growth YoY", value: formatPct(row.revenue_growth_yoy) },
          { label: "Profit growth YoY", value: formatPct(row.profit_growth_yoy) },
        ],
      },
      {
        title: "Technicals",
        rows: [
          { label: "52W range", value: `${formatMoney(row.low_52w, market)} – ${formatMoney(row.high_52w, market)}` },
          { label: "vs 50 DMA", value: formatPct(row.distance_sma_50_pct) },
          { label: "vs 200 DMA", value: formatPct(row.distance_sma_200_pct) },
          { label: "ATR % (14)", value: formatPct(row.atr_pct_14, false) },
          { label: "Volume / 20D avg", value: formatNumber(row.volume_ratio_20, 2) },
          { label: "Return 5D / 63D", value: `${formatPct(row.return_5d)} / ${formatPct(row.return_63d)}` },
        ],
      },
    ],
  };
}

async function stockScreener(market: MobileMarket, params: URLSearchParams): Promise<MobileScreen> {
  const sortKey = pick(params.get("sort"), SCREENER_SORTS.map((sort) => sort.value), "market_cap");
  const sort = SCREENER_SORTS.find((item) => item.value === sortKey)!;
  const search = params.get("search")?.trim().slice(0, 40) || undefined;
  const result = await getScreenerResults({
    market, universe: "ALL", page: 1, pageSize: 50, search, sort: { field: sort.field, dir: sort.dir },
  });
  return {
    key: "stock-screener",
    title: "Stock Screener",
    subtitle: "Every listed stock in this market, sorted on the server.",
    generatedAt: new Date().toISOString(),
    summary: `${result.rows.length} of ${result.total} stocks${result.refreshedAt ? ` · refreshed ${new Date(result.refreshedAt).toLocaleString("en-IN", { timeZone: market === "IN" ? "Asia/Kolkata" : "America/New_York" })}` : ""}`,
    notice: null,
    options: [{ param: "sort", label: "Sort", value: sortKey, choices: SCREENER_SORTS.map(({ value, label: text }) => ({ value, label: text })) }],
    searchable: true,
    cards: result.rows.map((row) => stockScreenerCard(row, market)),
  };
}

// ---- Swing candidates --------------------------------------------------------------------

const SWING_STRATEGIES = ["ALL", ...STRATEGY_META.map((meta) => meta.key)] as const;

export function swingCard(row: ScreenRow, market: MobileMarket, strategy: StrategyKey | null, rank: number): MobileCard {
  const levels = strategy ? row.strategyLevels[strategy] : null;
  const entry = levels?.entry ?? row.entry;
  const target = levels?.target ?? row.target;
  const stop = levels?.stopLoss ?? row.stopLoss;
  const trail = levels?.trailingStop ?? row.trailingStop;
  const riskReward = levels?.riskReward ?? row.riskReward;
  const expectedDays = levels?.expectedDays ?? row.expectedDays;
  const current = row.lastQuote ?? row.close;
  const flags = [row.isBreakout && "Breakout", row.isSqueeze && "Squeeze", row.isLongBuildup && "OI long build-up"].filter(Boolean);
  const strategyNames = row.strategyTags.map((key) => STRATEGY_META.find((meta) => meta.key === key)?.label ?? key);
  return {
    id: row.assetId,
    title: `#${rank} ${row.ticker}`,
    subtitle: `${row.exchange} · ${label(row.verdict)}`,
    badge: finite(row.quoteChangePct) ? { label: formatPct(row.quoteChangePct), tone: toneOf(row.quoteChangePct) } : null,
    score: formatNumber(swingDisplayScore(row, strategy)),
    metrics: [
      { label: "ENTRY", value: formatMoney(entry, market) },
      { label: "TARGET", value: formatMoney(target, market), tone: "positive" },
      { label: "STOP", value: formatMoney(stop, market), tone: "negative" },
    ],
    footer: `Current ${formatMoney(current, market)} · R:R ${formatNumber(riskReward, 2)} · ${expectedDays ?? nil} sessions`,
    chartTicker: row.ticker,
    guidance: row.reason || null,
    sections: [
      {
        title: "Plan",
        rows: [
          { label: "Current", value: formatMoney(current, market) },
          { label: "Entry", value: formatMoney(entry, market) },
          { label: "Target", value: formatMoney(target, market) },
          { label: "Stop loss", value: formatMoney(stop, market) },
          { label: "Trailing stop", value: formatMoney(trail, market) },
          { label: "Expected sessions", value: expectedDays === null ? nil : String(expectedDays) },
          { label: "Signal date", value: formatMarketDate(row.asOf, market) },
        ],
      },
      {
        title: "Signal",
        rows: [
          ...flags.map((flag) => ({ label: String(flag), passed: true })),
          { label: "Bollinger bandwidth", value: formatPct(row.bandwidthPct, false) },
          { label: "Strategies", value: strategyNames.length ? strategyNames.join(", ") : nil },
          { label: "P/E", value: formatNumber(row.peRatio) },
          { label: "ROCE", value: formatPct(row.roce, false) },
        ],
      },
    ],
  };
}

async function swingCandidates(market: MobileMarket, params: URLSearchParams, userId: string): Promise<MobileScreen> {
  const strategyParam = pick(params.get("strategy"), SWING_STRATEGIES, "ALL");
  const strategy = strategyParam === "ALL" ? null : strategyParam;
  const settings = await getUserSwingSettings(userId);
  const isUS = market === "US";
  // Same query as the web Swing Candidates page: buy-side only, NSE top 20 for India.
  const rows = await runScreener(market, { ...settings, includeShort: false }, isUS ? {} : { exchange: "NSE", limit: 20 });
  await markLiveMarketTargets(rows.map((row) => row.assetId), "swing");
  const matches = rows.filter((row) => strategy
    ? row.strategyTags.includes(strategy) && row.strategyLevels[strategy]?.direction === "LONG"
    : row.verdict !== "NO_SETUP");
  const ranked = rankSwingCandidates(matches, strategy);
  const shown = ranked.slice(0, MOBILE_CARD_LIMIT);
  return {
    key: "swing",
    title: isUS ? "Swing Candidates" : "Swing Candidates · Top 20",
    subtitle: "Buy-side swing candidates in the same server-ranked order as the web terminal.",
    generatedAt: new Date().toISOString(),
    summary: shown.length < ranked.length ? `Top ${shown.length} of ${ranked.length} setups` : `${ranked.length} setups`,
    notice: isUS ? "US bars are an anchored demo feed." : null,
    options: [{
      param: "strategy", label: "Strategy", value: strategyParam,
      choices: [{ value: "ALL", label: "All setups" }, ...STRATEGY_META.map((meta) => ({ value: meta.key, label: meta.label }))],
    }],
    searchable: false,
    cards: shown.map((row, index) => swingCard(row, market, strategy, index + 1)),
  };
}

// ---- Armed Strong Swing ------------------------------------------------------------------

const ARMED_TONE: Record<ArmedSwingStatus, MobileTone> = {
  BUY_ZONE: "positive", TRIGGERED_UNCONFIRMED: "positive", ARMED: "positive", UNVERIFIED: "neutral",
  FORMING: "warning", EXTENDED: "warning", RISK_OFF: "negative", INVALIDATED: "negative",
};
const ARMED_LIVE: ReadonlySet<ArmedSwingStatus> = new Set(["BUY_ZONE", "TRIGGERED_UNCONFIRMED", "ARMED", "UNVERIFIED"]);

export function armedSwingCard(candidate: ArmedSwingCandidate, market: MobileMarket): MobileCard {
  const { plan } = candidate;
  return {
    id: candidate.assetId,
    title: `#${candidate.rank} ${candidate.ticker}`,
    subtitle: [candidate.exchange, candidate.name].filter(Boolean).join(" · "),
    badge: { label: ARMED_STATUS_LABEL[candidate.status], tone: ARMED_TONE[candidate.status] },
    score: formatNumber(candidate.strengthScore, 0),
    metrics: [
      { label: "TRIGGER", value: formatMoney(plan.trigger, market) },
      { label: "LIMIT", value: formatMoney(plan.limit, market) },
      { label: "STOP", value: formatMoney(plan.stop, market), tone: "negative" },
    ],
    footer: `Current ${formatMoney(candidate.currentPrice, market)} · ${formatPct(candidate.distanceToTriggerPct)} to trigger · target ${formatMoney(plan.target, market)}`,
    chartTicker: candidate.ticker,
    guidance: ARMED_WHEN_TO_ENTER[candidate.status],
    sections: [
      {
        title: "Buy-stop plan",
        rows: [
          { label: "Pivot", value: formatMoney(plan.pivot, market) },
          { label: "Trigger", value: formatMoney(plan.trigger, market) },
          { label: "Limit (do not fill above)", value: formatMoney(plan.limit, market) },
          { label: "Target", value: formatMoney(plan.target, market) },
          { label: "Structure stop", value: formatMoney(plan.stop, market) },
          { label: "Trailing stop", value: formatMoney(plan.trail, market) },
          { label: "Risk per share", value: formatPct(plan.riskPerSharePct, false) },
          { label: "Reward : risk", value: formatNumber(plan.rewardRiskRatio, 2) },
          { label: "Expected sessions", value: String(plan.expectedDays) },
          { label: "Suggested exposure", value: formatPct(candidate.suggestedExposurePct, false) },
        ],
      },
      {
        title: "Gates",
        rows: candidate.gates.map((gate) => ({
          label: `${gate.label}${gate.blocking ? "" : " (advisory)"}`, detail: gate.detail, passed: gate.passed,
        })),
      },
    ],
  };
}

async function armedSwing(market: MobileMarket, _params: URLSearchParams, userId: string): Promise<MobileScreen> {
  const settings = await getUserSwingSettings(userId);
  const result = await getArmedSwingCandidates(market, settings);
  // As on the web page: viewing these keeps their five-minute live quotes flowing, which the
  // execution gates require.
  await markLiveMarketTargets(result.candidates.filter((candidate) => ARMED_LIVE.has(candidate.status)).map((candidate) => candidate.assetId), "strong_swing");
  return {
    key: "armed-swing",
    title: "Armed Strong Swing",
    subtitle: "Pre-breakout entries: tight stage-2 bases just under their pivot, with a buy-stop plan.",
    generatedAt: new Date().toISOString(),
    summary: `${result.candidates.length} setups · ${result.scannedCount} of ${result.universeCount} scanned · results calendar verified for ${result.resultsVerifiedCount} · market ${result.marketOpen ? "open" : "closed"}`,
    notice: "Projections are model estimates, not guarantees. Record buy-stop orders and fills from the web terminal.",
    options: [],
    searchable: false,
    cards: result.candidates.map((candidate) => armedSwingCard(candidate, market)),
  };
}

// ---- Long-term candidates ----------------------------------------------------------------

const LONG_TERM_KEYS = LONG_TERM_STRATEGY_META.map((meta) => meta.key);

async function longTerm(market: MobileMarket, params: URLSearchParams): Promise<MobileScreen> {
  const strategy = pick<LongTermStrategyKey>(params.get("strategy"), LONG_TERM_KEYS, "BUFFETT_MOAT");
  const meta = LONG_TERM_STRATEGY_META.find((item) => item.key === strategy)!;
  const result = await getLongTermCandidates({ market, strategy, limit: 50 });
  return {
    key: "long-term",
    title: "Long-Term Candidates",
    subtitle: `${meta.investor} · ${meta.label}: ${meta.tagline}`,
    generatedAt: result.generatedAt,
    summary: `${result.candidates.length} shown · ${result.eligible} eligible of ${result.scanned} scanned${result.fundamentalsLatestPeriod ? ` · fundamentals to ${result.fundamentalsLatestPeriod}` : ""}`,
    notice: null,
    options: [{
      param: "strategy", label: "Investor", value: strategy,
      choices: LONG_TERM_STRATEGY_META.map((item) => ({ value: item.key, label: `${item.investor} · ${item.label}` })),
    }],
    searchable: false,
    cards: result.candidates.map((candidate, index) => {
      const score = candidate.selectedScore;
      return {
        id: candidate.assetId,
        title: `#${index + 1} ${candidate.symbol}`,
        subtitle: [candidate.name, candidate.sector].filter(Boolean).join(" · ") || candidate.exchange,
        badge: { label: `${Math.round(score.confidence)}% data`, tone: score.confidence >= 80 ? "positive" : "warning" },
        score: formatNumber(score.matchScore, 0),
        metrics: [
          { label: "LTP", value: formatMoney(candidate.ltp, market) },
          { label: "P/E", value: formatNumber(candidate.peRatio) },
          { label: "ROE", value: formatPct(candidate.roe, false) },
        ],
        footer: `${score.matchedCriteria}/${score.totalCriteria} criteria · MCap ${formatMarketCap(candidate.marketCap, market)} · report ${candidate.reportPeriod}`,
        chartTicker: candidate.symbol,
        guidance: null,
        sections: [
          {
            title: `${meta.investor} criteria`,
            rows: score.outcomes.map((outcome) => ({
              label: outcome.label,
              value: outcome.dataMissing ? "No data" : formatNumber(outcome.value, 2),
              detail: outcome.description,
              passed: outcome.dataMissing ? undefined : outcome.passed,
            })),
          },
          {
            title: "Other investors",
            rows: candidate.scores.filter((other) => other.key !== strategy).map((other) => ({
              label: LONG_TERM_STRATEGY_META.find((item) => item.key === other.key)?.investor ?? other.key,
              value: `${Math.round(other.matchScore)} · ${other.matchedCriteria}/${other.totalCriteria}`,
              passed: other.eligible,
            })),
          },
        ],
      };
    }),
  };
}

const LOADERS: Record<string, (market: MobileMarket, params: URLSearchParams, userId: string) => Promise<MobileScreen>> = {
  "stock-screener": stockScreener,
  swing: swingCandidates,
  "armed-swing": armedSwing,
  "long-term": longTerm,
};

/** Returns null for an unknown or native-only screen key. */
export function loadMobileScreen(key: string, market: MobileMarket, params: URLSearchParams, userId: string): Promise<MobileScreen> | null {
  const loader = Object.hasOwn(LOADERS, key) ? LOADERS[key] : undefined;
  return loader ? loader(market, params, userId) : null;
}
