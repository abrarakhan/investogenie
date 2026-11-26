import type { ArmedSwingCandidate } from "@/features/armed-swing/contracts";
import {
  displayArmedSwing, displayLegacyMomentum, displayMomentumV2, displayStrongSwing,
  displaySwingBundle, displayTrendContinuation, peekStrongSwing,
} from "@/lib/displayScanCache";
import { ARMED_STATUS_LABEL, ARMED_WHEN_TO_ENTER } from "@/lib/armedSwingCopy";
import type { ArmedSwingStatus } from "@/lib/analytics/armedSwing";
import { rankSwingCandidates, swingDisplayScore } from "@/lib/analytics/candidateRanking";
import {
  MOMENTUM_IGNITION_LEGACY_STATUS_LABEL, MOMENTUM_IGNITION_STATUS_LABEL, STRONG_SWING_BLOCKED_BUY_LABEL,
  STRONG_SWING_STATUS_LABEL, TREND_CONTINUATION_STATUS_LABEL, swingBuildupLabel, swingVerdictLabel,
} from "@/lib/candidateStatusCopy";
import { STRATEGY_META, type StrategyKey } from "@/lib/analytics/legendaryStrategies";
import { LONG_TERM_STRATEGY_META, type LongTermStrategyKey } from "@/lib/analytics/longTermStrategies";
import { getLongTermCandidates } from "@/lib/long-term-actions";
import { markLiveMarketTargets } from "@/lib/liveMarketTargets";
import type { ScreenRow } from "@/features/swing/service";
import { getScreenerResults, getSectors, getUniverses, type ScreenerStock } from "@/lib/screener/service";
import type { Filter, SortSpec } from "@/lib/screener/filterEngine";
import { PRESETS, PRESET_BY_KEY } from "@/lib/screener/presets";
import { query, tenantQuery } from "@/lib/db";
import { getUserSwingSettings } from "@/lib/settings";
import { zonedMarketClock } from "@/lib/market-calendar.mjs";
import type { LegacyMomentumIgnitionCandidate, MomentumIgnitionCandidate } from "@/features/momentum/contracts";
import { isMomentumExecutionReady } from "@/lib/momentumExecution";
import type { StrongSwingCandidate } from "@/features/strong-swing/contracts";
import {
  captureExecutionPlans, executionPlanKey, momentumExecutionPlanInputs, strongSwingExecutionPlanInputs, trendContinuationExecutionPlanInputs,
  type ProtectedSwingStrategy,
} from "@/lib/swingExecutionPlans";
import type { TrendContinuationCandidate } from "@/features/trend-continuation/contracts";
import { getMarketOverview, type OverviewQuote } from "@/lib/marketOverview";
import {
  getTacticalRadar,
  TACTICAL_BUCKET_META,
  type TacticalBucketKey,
  type TacticalCandidate,
} from "@/lib/tacticalRadar";

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
/** A purchase the app may log: it sends only this plan id and the server reads every level from it. */
export interface MobileTradeAction { assetId: string; ticker: string; strategyKey: ProtectedSwingStrategy; planId: string; suggestedPrice: number }

export interface MobilePill { label: string; tone: MobileTone }

export interface MobileCard {
  id: string;
  title: string;
  subtitle: string;
  badge: { label: string; tone: MobileTone } | null;
  pills?: MobilePill[];
  score: string | null;
  metrics: MobileMetric[];
  footer: string | null;
  /** Ticker for the detail view's candle chart; null hides the chart. */
  chartTicker: string | null;
  guidance: string | null;
  sections: MobileCardSection[];
  /** Present only for an execution-ready candidate with a server-held plan. */
  trade?: MobileTradeAction | null;
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
  { key: "market", title: "Market Overview", tabLabel: "Market", kind: "cards" },
  { key: "stock-screener", title: "Stock Screener", tabLabel: "Screener", kind: "cards" },
  { key: "swing", title: "Swing Candidates", tabLabel: "Swing", kind: "cards" },
  { key: "strong-swing", title: "Strong Swing", tabLabel: "Strong", kind: "cards" },
  { key: "momentum-v2", title: "Momentum Ignition V2", tabLabel: "Momentum", kind: "cards" },
  { key: "trend-continuation", title: "Trend Continuation", tabLabel: "Continuation", kind: "cards" },
  { key: "tactical-radar", title: "Tactical Radar", tabLabel: "Tactical", kind: "cards" },
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

const pick = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T =>
  value && (allowed as readonly string[]).includes(value) ? value as T : fallback;

// ---- Market overview ---------------------------------------------------------------------

export function marketQuoteCard(quote: OverviewQuote, market: MobileMarket, group: string): MobileCard {
  const displayedPrice = group === "Benchmark" ? formatNumber(quote.price, 2) : formatMoney(quote.price, market);
  return {
    id: `${group}:${quote.exchange}:${quote.ticker}`,
    title: quote.ticker,
    subtitle: `${group} · ${quote.name}`,
    badge: quote.changePct === null ? null : { label: formatPct(quote.changePct), tone: toneOf(quote.changePct) },
    score: null,
    metrics: [
      { label: "LAST", value: displayedPrice },
      { label: "CHANGE", value: formatPct(quote.changePct), tone: toneOf(quote.changePct) },
      { label: "AS OF", value: quote.asOf ?? nil },
    ],
    footer: quote.exchange,
    chartTicker: quote.ticker,
    guidance: null,
    sections: [],
  };
}

async function marketOverview(market: MobileMarket): Promise<MobileScreen> {
  const overview = await getMarketOverview(market);
  const breadthTotal = overview.breadth.advancers + overview.breadth.decliners + overview.breadth.unchanged;
  const quoteCards = overview.quotes.map((quote) => marketQuoteCard(quote, market, "Benchmark"));
  const moverCards = [
    ...overview.gainers.map((quote) => marketQuoteCard(quote, market, "Gainer")),
    ...overview.losers.map((quote) => marketQuoteCard(quote, market, "Decliner")),
  ];
  const setupCards: MobileCard[] = overview.candidates.map((candidate) => ({
    id: `setup:${candidate.ticker}`,
    title: candidate.ticker,
    subtitle: `Swing setup · ${swingVerdictLabel(candidate.verdict)}`,
    badge: { label: `${candidate.score.toFixed(0)}/100`, tone: "neutral" },
    score: candidate.score.toFixed(0),
    metrics: [
      { label: "CURRENT", value: formatMoney(candidate.current, market) },
      { label: "ENTRY", value: formatMoney(candidate.entry, market) },
      { label: "TARGET", value: formatMoney(candidate.target, market), tone: "positive" },
    ],
    footer: null,
    chartTicker: candidate.ticker,
    guidance: null,
    sections: [],
  }));
  return {
    key: "market",
    title: "Market Overview",
    subtitle: "Benchmarks, breadth, movers and leading Base Swing setups from the web market workspace.",
    generatedAt: new Date().toISOString(),
    summary: `${overview.breadth.advancers} advancing · ${overview.breadth.decliners} declining · ${breadthTotal} quoted`,
    notice: `Coverage: ${overview.coverage.quoted} quotes · ${overview.coverage.history} histories · ${overview.coverage.fundamentals} fundamentals`,
    options: [],
    searchable: false,
    cards: [...quoteCards, ...moverCards, ...setupCards],
  };
}

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

const UNIVERSE_LABEL: Record<string, string> = {
  ALL: "All stocks", NIFTY_50: "Nifty 50", NIFTY_100: "Nifty 100", NIFTY_500: "Nifty 500", FNO: "F&O", SP_500: "S&P 500",
};

interface SavedScreenRow { id: string; name: string; universe: string | null; filters: unknown; sort: unknown }

async function stockScreener(market: MobileMarket, params: URLSearchParams, userId: string): Promise<MobileScreen> {
  const [universes, sectors, savedRows] = await Promise.all([
    getUniverses(market),
    getSectors(market),
    tenantQuery<SavedScreenRow>(userId,
      `select id::text, name, universe, filters, sort from public.saved_screens
        where user_id = $1 and market = $2 order by updated_at desc limit 20`,
      [userId, market],
    ),
  ]);
  // A saved screen replays the web screen exactly; otherwise preset, universe and sector compose.
  const saved = savedRows.find((row) => row.id === params.get("saved")) ?? null;
  const presetKey = saved ? "NONE" : pick(params.get("preset"), ["NONE", ...PRESETS.map((preset) => preset.key)], "NONE");
  const preset = presetKey === "NONE" ? null : PRESET_BY_KEY[presetKey];
  const universe = saved?.universe || pick(params.get("universe"), universes, "ALL");
  const sector = saved ? "ALL" : pick(params.get("sector"), ["ALL", ...sectors], "ALL");
  const sortKey = pick(params.get("sort"), ["AUTO", ...SCREENER_SORTS.map((sort) => sort.value)], "AUTO");
  const manualSort = SCREENER_SORTS.find((item) => item.value === sortKey);
  const savedSort = saved?.sort as (Partial<SortSpec> & { valueBelowSectorMedian?: boolean }) | null | undefined;
  const sort: SortSpec = manualSort
    ? { field: manualSort.field, dir: manualSort.dir }
    : savedSort?.field ? { field: savedSort.field, dir: savedSort.dir ?? "desc" }
      : preset?.sort ?? { field: "market_cap", dir: "desc" };
  const filters: Filter[] = [
    ...(saved ? (Array.isArray(saved.filters) ? saved.filters as Filter[] : []) : preset?.filters ?? []),
    ...(sector === "ALL" ? [] : [{ field: "sector", op: "in", value: [sector] } as Filter]),
  ];
  const search = params.get("search")?.trim().slice(0, 40) || undefined;
  const result = await getScreenerResults({
    market, universe, page: 1, pageSize: MOBILE_CARD_LIMIT, search, sort, filters,
    valueBelowSectorMedian: saved ? Boolean(savedSort?.valueBelowSectorMedian) : preset?.dynamic === "value",
  });
  const options: MobileScreenOption[] = [
    ...(savedRows.length ? [{
      param: "saved", label: "Saved screen", value: saved?.id ?? "NONE",
      choices: [{ value: "NONE", label: "No saved screen" }, ...savedRows.map((row) => ({ value: row.id, label: row.name }))],
    }] : []),
    {
      param: "preset", label: "Preset", value: presetKey,
      choices: [{ value: "NONE", label: "No preset" }, ...PRESETS.map((item) => ({ value: item.key, label: item.label }))],
    },
    {
      param: "universe", label: "Universe", value: universe,
      choices: universes.map((item) => ({ value: item, label: UNIVERSE_LABEL[item] ?? item })),
    },
    {
      param: "sector", label: "Sector", value: sector,
      choices: [{ value: "ALL", label: "All sectors" }, ...sectors.map((item) => ({ value: item, label: item }))],
    },
    {
      param: "sort", label: "Sort", value: sortKey,
      choices: [{ value: "AUTO", label: preset || saved ? "Screen's order" : "Market cap" }, ...SCREENER_SORTS.map(({ value, label: text }) => ({ value, label: text }))],
    },
  ];
  const describe = saved ? `Saved: ${saved.name}` : preset ? `${preset.label} — ${preset.description}` : null;
  return {
    key: "stock-screener",
    title: "Stock Screener",
    subtitle: "Every listed stock in this market, filtered and sorted on the server.",
    generatedAt: new Date().toISOString(),
    summary: `${result.rows.length} of ${result.total} stocks${result.refreshedAt ? ` · refreshed ${new Date(result.refreshedAt).toLocaleString("en-IN", { timeZone: market === "IN" ? "Asia/Kolkata" : "America/New_York" })}` : ""}`,
    notice: describe,
    options,
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
  const flags = [row.isBreakout && "Breakout", row.isSqueeze && "Squeeze", row.isLongBuildup && swingBuildupLabel(row.buildupSource)].filter(Boolean);
  const strategyNames = row.strategyTags.map((key) => STRATEGY_META.find((meta) => meta.key === key)?.label ?? key);
  return {
    id: row.assetId,
    title: `#${rank} ${row.ticker}`,
    subtitle: `${row.exchange} · ${swingVerdictLabel(row.verdict)}`,
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
          { label: "Breakout-day volume", value: row.volumeExpansion === null ? nil : `${formatNumber(row.volumeExpansion, 2)}x avg` },
          { label: "5-session participation", value: row.participationRatio === null ? nil : `${formatNumber(row.participationRatio, 2)}x prior 20` },
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
  // Same queries as the web Swing Candidates page: buy-side only; the default view is every
  // NSE setup for India, while a strategy view takes every buy match of that strategy.
  const buyOnly = { ...settings, includeShort: false };
  const { rows, strategyRows } = await displaySwingBundle(market, buyOnly);
  const isBuyMatch = (row: ScreenRow, key: StrategyKey) => row.strategyTags.includes(key) && row.strategyLevels[key]?.direction === "LONG";
  const setups = rows.filter((row) => row.verdict !== "NO_SETUP");
  const strategyCount = (key: StrategyKey) => strategyRows.filter((row) => isBuyMatch(row, key)).length;
  const matches = strategy ? strategyRows.filter((row) => isBuyMatch(row, strategy)) : setups;
  await markLiveMarketTargets([...rows, ...strategyRows].map((row) => row.assetId), "swing");
  const ranked = rankSwingCandidates(matches, strategy);
  const shown = ranked.slice(0, MOBILE_CARD_LIMIT);
  return {
    key: "swing",
    title: "Swing Candidates",
    subtitle: "Buy-side swing candidates in the same server-ranked order as the web terminal.",
    generatedAt: new Date().toISOString(),
    summary: strategy
      ? `${ranked.length} ${STRATEGY_META.find((meta) => meta.key === strategy)?.label ?? strategy} buy matches · ${matches.filter((row) => row.verdict !== "NO_SETUP").length} also flagged by the base classifier${shown.length < ranked.length ? ` · top ${shown.length} shown` : ""}`
      : `${rows.length} scanned · ${setups.length} buy candidates · ${rows.filter((row) => row.verdict === "LONG_BREAKOUT").length} breakouts with build-up${shown.length < ranked.length ? ` · top ${shown.length} shown` : ""}`,
    notice: null,
    options: [{
      param: "strategy", label: "Strategy", value: strategyParam,
      choices: [
        { value: "ALL", label: `All setups · ${setups.length}` },
        ...STRATEGY_META.map((meta) => ({ value: meta.key, label: `${meta.label} · ${strategyCount(meta.key)}` })),
      ],
    }],
    searchable: false,
    cards: shown.map((row, index) => swingCard(row, market, strategy, index + 1)),
  };
}

// ---- Strong Swing models --------------------------------------------------------------------

const STRONG_TONE: Record<StrongSwingCandidate["status"], MobileTone> = {
  EXECUTION_READY: "positive", WAIT_FOR_ENTRY: "neutral", WATCHLIST: "warning",
  UNVERIFIED: "warning", RISK_OFF: "warning", INVALIDATED: "negative",
};
const momentumTone = (status: string): MobileTone => isMomentumExecutionReady(status) ? "positive"
  : ["EXECUTION_BLOCKED", "FAILED_BREAKOUT", "LATE_PROFIT_BOOKING", "NOT_QUALIFIED", "WAIT_FOR_PULLBACK"].includes(status) ? "negative"
    : "warning";
const TREND_TONE: Record<TrendContinuationCandidate["status"], MobileTone> = {
  TREND_CONTINUATION_READY: "positive", CONTINUATION_WATCH: "warning", IMPULSE_DETECTED: "neutral", EXTENDED_RISK: "negative",
};

export function strongSwingCard(candidate: StrongSwingCandidate, market: MobileMarket, planId: string | null): MobileCard {
  const current = candidate.lastQuote ?? candidate.latestClose;
  const risk = candidate.strongEntry - candidate.strongStop;
  const movement = candidate.baseSwingRank - candidate.strongSwingRank;
  return {
    id: candidate.assetId,
    title: `#${candidate.strongSwingRank} ${candidate.ticker}`,
    subtitle: `${candidate.exchange || market} · base Swing #${candidate.baseSwingRank}${movement ? ` · ${movement > 0 ? "up" : "down"} ${Math.abs(movement)}` : ""}`,
    badge: { label: STRONG_SWING_STATUS_LABEL[candidate.status], tone: STRONG_TONE[candidate.status] },
    score: formatNumber(candidate.strengthScore, 0),
    metrics: [
      { label: "ENTRY", value: formatMoney(candidate.strongEntry, market) },
      { label: "TARGET", value: formatMoney(candidate.strongTarget, market), tone: "positive" },
      { label: "STOP", value: formatMoney(candidate.strongStop, market), tone: "negative" },
    ],
    footer: `Current ${formatMoney(current, market)} · R:R ${formatNumber(risk > 0 ? (candidate.strongTarget - candidate.strongEntry) / risk : null, 2)} · ${candidate.strongExpectedDays} sessions`,
    chartTicker: candidate.ticker,
    guidance: candidate.status === "EXECUTION_READY"
      ? planId ? "Execution ready: the plan below is frozen when you log the purchase." : "Unsafe plan withheld."
      : STRONG_SWING_BLOCKED_BUY_LABEL[candidate.status],
    sections: [
      {
        title: "Plan",
        rows: [
          { label: "Current", value: formatMoney(current, market) },
          { label: "Confirmation entry", value: formatMoney(candidate.strongEntry, market) },
          { label: "Target", value: formatMoney(candidate.strongTarget, market) },
          { label: "Stop loss", value: formatMoney(candidate.strongStop, market) },
          { label: "Trailing stop", value: formatMoney(candidate.strongTrail, market) },
          { label: "Expected sessions", value: String(candidate.strongExpectedDays) },
          { label: "5D / 10D return", value: `${formatPct(candidate.fiveDayReturnPct)} / ${formatPct(candidate.tenDayReturnPct)}` },
          { label: "Signal date", value: candidate.latestDate },
        ],
      },
      {
        title: "Confirmation gates",
        rows: candidate.gates.map((gate) => ({ label: `${gate.label}${gate.blocking ? "" : " (advisory)"}`, detail: gate.detail, passed: gate.passed })),
      },
    ],
    trade: planId ? { assetId: candidate.assetId, ticker: candidate.ticker, strategyKey: "STRONG_SWING", planId, suggestedPrice: current } : null,
  };
}

export function momentumIgnitionCard(
  candidate: MomentumIgnitionCandidate | LegacyMomentumIgnitionCandidate, market: MobileMarket, rank: number, planId: string | null,
): MobileCard {
  const v2 = "modelStatus" in candidate ? candidate : null;
  const statusLabel = v2
    ? MOMENTUM_IGNITION_STATUS_LABEL[v2.status]
    : MOMENTUM_IGNITION_LEGACY_STATUS_LABEL[(candidate as LegacyMomentumIgnitionCandidate).status];
  const ready = isMomentumExecutionReady(candidate.status);
  return {
    id: candidate.assetId,
    title: `#${rank} ${candidate.ticker}`,
    subtitle: [candidate.exchange || market, candidate.name].filter(Boolean).join(" · "),
    badge: { label: statusLabel, tone: momentumTone(candidate.status) },
    score: formatNumber(candidate.score, 0),
    metrics: [
      { label: "ENTRY", value: formatMoney(candidate.projectedEntry, market) },
      { label: "TARGET", value: formatMoney(candidate.projectedTarget, market), tone: "positive" },
      { label: "STOP", value: formatMoney(candidate.projectedStop, market), tone: "negative" },
    ],
    footer: `Current ${formatMoney(candidate.currentPrice, market)} · ${formatPct(candidate.quoteChangePct)} today · breakout ${formatMoney(candidate.breakoutLevel, market)}`,
    chartTicker: candidate.ticker,
    guidance: v2?.executionBlockReason
      ?? (ready ? planId ? "Momentum ready: the plan below is frozen when you log the purchase." : "Unsafe plan withheld." : "Buy unlocks only at Momentum ready."),
    sections: [
      {
        title: "Plan",
        rows: [
          { label: "Current", value: formatMoney(candidate.currentPrice, market) },
          { label: "Entry", value: formatMoney(candidate.projectedEntry, market) },
          { label: "Target", value: formatMoney(candidate.projectedTarget, market) },
          { label: "Stop loss", value: formatMoney(candidate.projectedStop, market) },
          { label: "Trailing stop", value: formatMoney(candidate.projectedTrail, market) },
          { label: "Expected sessions", value: String(candidate.projectedDays) },
          { label: "Breakout level", value: formatMoney(candidate.breakoutLevel, market) },
          { label: "Distance to breakout", value: formatPct(candidate.distanceToBreakoutPct) },
          { label: "RS vs benchmark · 20D", value: formatPct(candidate.relativeStrength20Pct) },
          ...(v2 ? [
            { label: "Breakout age", value: v2.breakoutAgeSessions === null ? nil : `${v2.breakoutAgeSessions} sessions` },
            { label: "5-session return", value: formatPct(v2.return5Pct) },
            { label: "Short-horizon target", value: `${formatPct(v2.shortHorizonTargetPct)} in ${v2.shortHorizonDays}d` },
          ] : []),
          { label: "Signal date", value: candidate.latestDate },
        ],
      },
      ...(v2?.timingReasons.length ? [{ title: "Timing", rows: v2.timingReasons.map((reason) => ({ label: reason })) }] : []),
      { title: "Gates", rows: candidate.gates.map((gate) => ({ label: gate.label, detail: gate.detail, passed: gate.passed })) },
    ],
    trade: planId ? { assetId: candidate.assetId, ticker: candidate.ticker, strategyKey: "MOMENTUM_IGNITION", planId, suggestedPrice: candidate.currentPrice } : null,
  };
}

const MIDWAY_VARIANT_LABEL: Record<string, string> = {
  STAGE2_IMPULSE: "Stage-2 Impulse",
  EP_REBOUND: "EP Rebound",
  STAIR_STEP: "3D Stair-Step",
};

function trendContinuationPills(candidate: TrendContinuationCandidate): MobilePill[] {
  const m = candidate.metrics;
  const num = (k: string) => (typeof m[k] === "number" && Number.isFinite(m[k] as number) ? (m[k] as number) : null);
  const pills: MobilePill[] = [];
  const variant = typeof m.setup_variant === "string" ? m.setup_variant : null;
  if (variant && MIDWAY_VARIANT_LABEL[variant]) pills.push({ label: MIDWAY_VARIANT_LABEL[variant], tone: "positive" });
  const levels = typeof m.breakout_levels === "object" && m.breakout_levels !== null && !Array.isArray(m.breakout_levels)
    ? (m.breakout_levels as Record<string, unknown>)
    : null;
  if (levels?.vduPause === true) {
    const sessions = typeof levels.pauseSessions === "number" ? levels.pauseSessions : null;
    pills.push({ label: sessions ? `VDU Pause · ${sessions}d` : "VDU Pause", tone: "positive" });
  }
  if (candidate.todRvol !== null && Number.isFinite(candidate.todRvol)) {
    pills.push({ label: `RVOL ${candidate.todRvol.toFixed(1)}×`, tone: candidate.todRvol >= 1.8 ? "positive" : "neutral" });
  }
  const deliv = num("deliv_pct");
  if (deliv !== null) {
    const rel = num("rel_deliv_20d");
    pills.push({
      label: rel !== null ? `Deliv ${deliv.toFixed(0)}% · ${rel.toFixed(1)}×` : `Deliv ${deliv.toFixed(0)}%`,
      tone: deliv >= 55 ? "positive" : "neutral",
    });
  }
  const catalyst = typeof m.catalyst_tag === "string" ? m.catalyst_tag : null;
  if (catalyst) pills.push({ label: catalyst, tone: catalyst === "EP" ? "positive" : "neutral" });
  if (m.midway_exhausted === true) {
    const rsi = num("midway_rsi_14");
    pills.push({ label: rsi !== null && rsi >= 80 ? `RSI ${rsi.toFixed(0)} Exhausted` : "Exhausted", tone: "warning" });
  }
  return pills;
}

export function trendContinuationCard(candidate: TrendContinuationCandidate, market: MobileMarket, rank: number, planId: string | null = null): MobileCard {
  const metric = (key: string) => typeof candidate.metrics[key] === "number" ? candidate.metrics[key] as number : null;
  const volumes = Array.isArray(candidate.metrics.volume_ratios) ? candidate.metrics.volume_ratios.filter((item): item is number => typeof item === "number") : [];
  const pills = trendContinuationPills(candidate);
  return {
    id: candidate.assetId,
    title: `#${rank} ${candidate.ticker}`,
    subtitle: [market === "IN" ? "NSE" : market, candidate.name].filter(Boolean).join(" · "),
    badge: { label: TREND_CONTINUATION_STATUS_LABEL[candidate.status], tone: TREND_TONE[candidate.status] },
    ...(pills.length ? { pills } : {}),
    score: String(candidate.score),
    metrics: candidate.entry !== null
      ? [
        { label: "ENTRY", value: formatMoney(candidate.entry, market) },
        { label: "TARGET", value: formatMoney(candidate.target, market), tone: "positive" },
        { label: "STOP", value: formatMoney(candidate.stop, market), tone: "negative" },
      ]
      : [
        { label: "3-SESSION", value: `${formatNumber(metric("move3_atr"), 2)} ATR` },
        { label: "5-SESSION", value: formatPct(metric("return5_pct")) },
        { label: "VS EMA10", value: `${formatNumber(metric("distance_ema10_atr"), 2)} ATR` },
      ],
    footer: candidate.reasons[0] ?? null,
    chartTicker: candidate.ticker,
    guidance: candidate.executionEligible ? "Manual Buy & Track is available from the protected frozen plan; auto-buy is disabled."
      : candidate.executionBlockers[0] ?? "Observation only — wait for confirmed day-two execution gates.",
    sections: [
      { title: "Why it is here", rows: candidate.reasons.map((reason) => ({ label: reason })) },
      {
        title: "Metrics",
        rows: [
          { label: "Breakout level", value: formatMoney(metric("breakout_level"), market) },
          { label: "Ignition move", value: `${formatNumber(metric("ignition_gain_atr"), 2)} ATR` },
          { label: "Ignition volume", value: `${formatNumber(metric("ignition_volume_ratio"), 2)}x` },
          { label: "Day-two volume pace", value: `${formatNumber(metric("day_two_volume_ratio"), 2)}x` },
          { label: "Recent volume ratios", value: volumes.length ? volumes.map((item) => `${item.toFixed(2)}x`).join(", ") : nil },
          { label: "RS vs Nifty · 5D", value: formatPct(metric("relative_strength5_pct")) },
          { label: "Signal session", value: candidate.asOfMarketDate },
        ],
      },
    ],
    trade: planId && candidate.executionEligible ? { assetId: candidate.assetId, ticker: candidate.ticker, strategyKey: "TREND_CONTINUATION", planId, suggestedPrice: candidate.currentPrice ?? candidate.entry ?? 0 } : null,
  };
}

const STRONG_MODELS = ["STRONG_SWING", "MOMENTUM_IGNITION", "MOMENTUM_IGNITION_V2", "TREND_CONTINUATION"] as const;

async function strongSwing(market: MobileMarket, params: URLSearchParams, userId: string): Promise<MobileScreen> {
  const settings = await getUserSwingSettings(userId);
  // The same four engines and plan capture as the web Strong Swing page.
  const [strong, legacy, v2, trend] = await Promise.all([
    // Same 60 s display cache as the web page (lib/displayScanCache.ts).
    displayStrongSwing(market, settings),
    displayLegacyMomentum(market, settings),
    displayMomentumV2(market, settings),
    market === "IN" ? displayTrendContinuation(market) : Promise.resolve([]),
  ]);
  const planIds = await captureExecutionPlans(userId, market, zonedMarketClock(market).date, [
    ...strongSwingExecutionPlanInputs(strong),
    ...momentumExecutionPlanInputs(legacy.candidates, "LEGACY"),
    ...momentumExecutionPlanInputs(v2.candidates, "V2"),
    ...trendContinuationExecutionPlanInputs(trend),
  ], settings.trailAtrMult);
  await markLiveMarketTargets([...strong, ...legacy.candidates, ...v2.candidates, ...trend].map((item) => item.assetId), "strong_swing");
  const plan = (strategy: ProtectedSwingStrategy, status: string, assetId: string) => planIds.get(executionPlanKey(strategy, status, assetId)) ?? null;

  const models = STRONG_MODELS.filter((model) => model !== "TREND_CONTINUATION" || market === "IN");
  const model = pick(params.get("model"), models, "STRONG_SWING");
  const ranked = strong;
  const counts = {
    STRONG_SWING: [ranked.length, ranked.filter((item) => item.status === "EXECUTION_READY").length],
    MOMENTUM_IGNITION: [legacy.candidates.length, legacy.candidates.filter((item) => isMomentumExecutionReady(item.status)).length],
    MOMENTUM_IGNITION_V2: [v2.candidates.length, v2.candidates.filter((item) => isMomentumExecutionReady(item.status)).length],
    TREND_CONTINUATION: [trend.length, trend.filter((item) => item.executionEligible).length],
  } satisfies Record<(typeof STRONG_MODELS)[number], [number, number]>;
  const names: Record<(typeof STRONG_MODELS)[number], string> = {
    STRONG_SWING: "Strong Swing", MOMENTUM_IGNITION: "Momentum Ignition", MOMENTUM_IGNITION_V2: "Momentum Ignition V2", TREND_CONTINUATION: "Trend Continuation",
  };
  const subtitles: Record<(typeof STRONG_MODELS)[number], string> = {
    STRONG_SWING: "Base Swing signals re-ranked after the two-close confirmation and execution-safety gates.",
    MOMENTUM_IGNITION: "Legacy momentum model: compression, dry-up and breakout with live volume.",
    MOMENTUM_IGNITION_V2: "Ignition timing model: first thrust and retest entries, with late-move protection.",
    TREND_CONTINUATION: "Developing two-session staircases, confirmed day-two breakouts, and orderly pullbacks.",
  };
  const cards = model === "STRONG_SWING"
    ? ranked.map((item) => strongSwingCard(item, market, plan("STRONG_SWING", item.status, item.assetId)))
    : model === "MOMENTUM_IGNITION"
      ? legacy.candidates.map((item, index) => momentumIgnitionCard(item, market, index + 1, plan("MOMENTUM_IGNITION", item.status, item.assetId)))
      : model === "MOMENTUM_IGNITION_V2"
        ? v2.candidates.map((item, index) => momentumIgnitionCard(item, market, index + 1, plan("MOMENTUM_IGNITION", item.status, item.assetId)))
        : trend.map((item, index) => trendContinuationCard(item, market, index + 1, plan("TREND_CONTINUATION", item.status, item.assetId)));
  const [total, ready] = counts[model];
  const scanned = model === "MOMENTUM_IGNITION" ? legacy : model === "MOMENTUM_IGNITION_V2" ? v2 : null;
  return {
    key: "strong-swing",
    title: names[model],
    subtitle: subtitles[model],
    generatedAt: new Date().toISOString(),
    summary: `${total} candidates · ${ready} ready${scanned ? ` · ${scanned.universeScanned} scanned` : ""}${cards.length > MOBILE_CARD_LIMIT ? ` · top ${MOBILE_CARD_LIMIT} shown` : ""}`,
    notice: model === "TREND_CONTINUATION"
      ? "Only confirmed day-two breakouts with every live execution gate may unlock manual Buy & Track. Auto-buy remains disabled."
      : "Breeze supplies live data but does not place the order; confirm exchange restrictions in ICICI Direct before buying.",
    options: [{
      param: "model", label: "Model", value: model,
      choices: models.map((key) => ({ value: key, label: `${names[key]} · ${counts[key][0]}${counts[key][1] ? ` (${counts[key][1]} ready)` : ""}` })),
    }],
    searchable: false,
    cards: cards.slice(0, MOBILE_CARD_LIMIT),
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
  const result = await displayArmedSwing(market, settings);
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

async function homeScreen(market: MobileMarket, userId: string): Promise<MobileScreen> {
  const country = market;
  const exchanges = market === "IN" ? ["NSE"] : ["NASDAQ", "NYSE", "AMEX"];
  const benchmarks = market === "IN" ? ["NIFTY", "SENSEX", "USDINR"] : ["AAPL", "MSFT", "NVDA"];
  const primaryExchange = exchanges[0];

  const [settings, benchmarkRows, breadthRows, trendRows, tacticalData] = await Promise.all([
    getUserSwingSettings(userId).catch(() => null),
    query<{ ticker: string; name: string | null; exchange: string; price: string; change_pct: string | null; as_of: string | Date | null }>(
      `select a.ticker, a.name, a.exchange, q.price::text, q.change_pct::text, q.as_of
         from public.assets a
         join public.latest_quotes q on q.asset_id = a.id
        where a.country = $1 and a.ticker = any($2)
        order by array_position($2::text[], a.ticker),
                 case when a.exchange = $3 then 0 else 1 end`,
      [country, benchmarks, primaryExchange],
    ),
    query<{ advancers: string; decliners: string; unchanged: string; latest_as_of: string | null }>(
      `select count(*) filter (where q.change_pct > 0)::text advancers,
              count(*) filter (where q.change_pct < 0)::text decliners,
              count(*) filter (where q.change_pct = 0 or q.change_pct is null)::text unchanged,
              max(q.as_of)::text latest_as_of
         from public.latest_quotes q
         join public.assets a on a.id = q.asset_id
        where a.country = $1 and a.exchange = any($2) and a.asset_class = 'STOCK'`,
      [country, exchanges],
    ),
    market === "IN"
      ? query<{
          asset_id: string;
          ticker: string;
          name: string | null;
          status: string;
          score: number;
          entry: string | null;
          stop: string | null;
          target: string | null;
          asof_market_date: string;
          setup_variant: string | null;
          deliv_pct: string | null;
        }>(
          `select * from (
             select distinct on (s.asset_id)
                    s.asset_id, a.ticker, a.name, s.status, s.score,
                    s.entry::text, s.stop::text, s.target::text,
                    s.asof_market_date::text,
                    s.metrics->>'setup_variant' setup_variant,
                    s.metrics->>'deliv_pct' deliv_pct
               from public.trend_continuation_signals s
               join public.assets a on a.id = s.asset_id
              where s.market = 'IN'
                and s.status <> 'EXTENDED_RISK'
                and s.asof_market_date >= (
                  select max(asof_market_date) - interval '4 days'
                    from public.trend_continuation_signals
                   where market = 'IN'
                )
              order by s.asset_id, s.asof_market_date desc, s.computed_at desc
           ) latest
           order by
             case when setup_variant is not null then 0 else 1 end,
             case when status = 'TREND_CONTINUATION_READY' then 0
                  when status = 'CONTINUATION_WATCH' then 1
                  else 2 end,
             score desc
           limit 3`,
        ).catch(() => [])
      : Promise.resolve([]),
    getTacticalRadar(market, 5).catch(() => null),
  ]);

  const breadth = breadthRows[0];
  const advancers = Number(breadth?.advancers ?? 0);
  const decliners = Number(breadth?.decliners ?? 0);
  const latestQuoteDate = breadth?.latest_as_of?.slice(0, 10) ?? null;

  const cards: MobileCard[] = [];

  // 1. Market breadth & benchmarks card
  const seenBench = new Set<string>();
  const uniqueBench = benchmarkRows.filter((row) => {
    if (seenBench.has(row.ticker)) return false;
    seenBench.add(row.ticker);
    return true;
  });
  cards.push({
    id: `home:breadth:${market}`,
    title: market === "IN" ? "India Market Pulse" : "US Market Pulse",
    subtitle: latestQuoteDate ? `Latest persisted quotes · ${latestQuoteDate}` : "Persisted market snapshot",
    badge: {
      label: advancers >= decliners ? "Positive Breadth" : "Weak Breadth",
      tone: advancers >= decliners ? "positive" : "warning",
    },
    score: null,
    metrics: [
      { label: "ADVANCERS", value: String(advancers), tone: "positive" },
      { label: "DECLINERS", value: String(decliners), tone: "negative" },
      ...(uniqueBench[0]
        ? [{
            label: uniqueBench[0].ticker,
            value: formatPct(uniqueBench[0].change_pct === null ? null : Number(uniqueBench[0].change_pct)),
            tone: toneOf(uniqueBench[0].change_pct === null ? null : Number(uniqueBench[0].change_pct)),
          }]
        : []),
    ],
    footer: uniqueBench.length
      ? uniqueBench
          .map((row) => `${row.ticker} ${formatMoney(Number(row.price), market)} (${formatPct(row.change_pct === null ? null : Number(row.change_pct))})`)
          .join(" · ")
      : null,
    chartTicker: null,
    guidance: "Summary built from persisted quotes and cached scan snapshots — open Strategies or Discover for full ranked lists.",
    sections: uniqueBench.length
      ? [{
          title: "Benchmarks",
          rows: uniqueBench.map((row) => ({
            label: row.ticker,
            value: formatMoney(Number(row.price), market),
            detail: `${row.name ?? row.ticker} · ${formatPct(row.change_pct === null ? null : Number(row.change_pct))}`,
          })),
        }]
      : [],
  });

  // 2. Top execution-ready setups from already-warm Strong Swing cache (never triggers a scan)
  const warmStrong = settings ? peekStrongSwing(market, settings) : null;
  const readyStrong = (warmStrong ?? [])
    .filter((candidate) => candidate.status === "EXECUTION_READY")
    .slice(0, 3);
  for (const candidate of readyStrong) {
    cards.push({
      id: `home:ready:${candidate.assetId}`,
      title: candidate.ticker,
      subtitle: `Strong Swing · Execution Ready`,
      badge: { label: "Execution Ready", tone: "positive" },
      score: formatNumber(candidate.strengthScore, 0),
      metrics: [
        { label: "ENTRY", value: formatMoney(candidate.strongEntry, market) },
        { label: "STOP", value: formatMoney(candidate.strongStop, market), tone: "negative" },
        { label: "TARGET", value: formatMoney(candidate.strongTarget, market), tone: "positive" },
      ],
      footer: `Open Strategies → Strong Swing to inspect full execution gates and log a plan.`,
      chartTicker: candidate.ticker,
      guidance: null,
      sections: [],
    });
  }

  // 3. Top Tactical Radar highlights (favored bucket + Near-Trigger confluence leaders)
  const tacticalPicks: TacticalCandidate[] = [];
  if (tacticalData) {
    const seenTactical = new Set<string>(readyStrong.map((c) => c.ticker));
    const orderedKeys: TacticalBucketKey[] = [
      tacticalData.context.favoredBucket,
      "NEAR_TRIGGER",
      "MID_TREND_PULLBACK",
      "OVERSOLD_SNAPBACK",
    ];
    for (const key of orderedKeys) {
      for (const item of tacticalData.buckets[key]) {
        if (seenTactical.has(item.ticker)) continue;
        seenTactical.add(item.ticker);
        tacticalPicks.push(item);
        if (tacticalPicks.length >= 4) break;
      }
      if (tacticalPicks.length >= 4) break;
    }
    for (const item of tacticalPicks) {
      cards.push(tacticalRadarCard(item, market, true));
    }
  }

  // 4. Top persisted Mid-Way / Trend Continuation setups (IN only)
  for (const row of trendRows) {
    const isMidway = typeof row.setup_variant === "string" && row.setup_variant.length > 0;
    const deliv = row.deliv_pct !== null ? Number(row.deliv_pct) : null;
    cards.push({
      id: `home:trend:${row.asset_id}`,
      title: row.ticker,
      subtitle: [row.name, isMidway ? `Mid-Way · ${row.setup_variant}` : "Trend Continuation"].filter(Boolean).join(" · "),
      badge: {
        label: isMidway ? row.setup_variant!.replaceAll("_", " ") : row.status.replaceAll("_", " "),
        tone: row.status === "TREND_CONTINUATION_READY" || isMidway ? "positive" : "warning",
      },
      score: String(Math.round(row.score)),
      metrics: [
        { label: "ENTRY", value: formatMoney(row.entry === null ? null : Number(row.entry), market) },
        { label: "STOP", value: formatMoney(row.stop === null ? null : Number(row.stop), market), tone: "negative" },
        { label: "DELIV %", value: deliv !== null && Number.isFinite(deliv) ? `${deliv.toFixed(0)}%` : nil, tone: deliv !== null && deliv >= 55 ? "positive" : "neutral" },
      ],
      footer: `Signal session ${row.asof_market_date} · open Strategies → Continuation for full gates.`,
      chartTicker: row.ticker,
      guidance: null,
      sections: [],
    });
  }

  return {
    key: "home",
    title: "Home",
    subtitle: "Market pulse and top persisted opportunities.",
    generatedAt: new Date().toISOString(),
    summary: `${readyStrong.length} ready · ${tacticalPicks.length} tactical · ${trendRows.length} continuation`,
    notice: latestQuoteDate ? null : "Quote data has not synced yet for this market.",
    options: [],
    searchable: false,
    cards,
  };
}

function tacticalRadarCard(item: TacticalCandidate, market: MobileMarket, forHome = false): MobileCard {
  const bucketMeta = TACTICAL_BUCKET_META[item.bucket];
  const isSnapback = item.riskTier === "HIGHER_MEAN_REVERSION";
  return {
    id: `${forHome ? "home:tactical" : "tactical"}:${item.bucket}:${item.assetId}`,
    title: item.ticker,
    subtitle: `${bucketMeta.shortLabel} · ${item.name}`,
    badge: {
      label: item.confluenceCount >= 2 ? `${item.confluenceCount}× Confluence` : bucketMeta.shortLabel,
      tone: isSnapback ? "warning" : "positive",
    },
    score: String(item.score),
    metrics: [
      { label: "LTP", value: formatMoney(item.price, market), tone: toneOf(item.changePct) },
      { label: "STOP", value: formatMoney(item.invalidationStop, market), tone: "negative" },
      { label: "TARGET", value: formatMoney(item.targetZone, market), tone: "positive" },
    ],
    footer: item.reason,
    chartTicker: item.ticker,
    guidance: isSnapback
      ? "Higher Risk · Mean Reversion candidate (separate from Strong Swing)."
      : `${bucketMeta.riskLabel} · ${item.engines.join(" + ")}`,
    pills: [
      { label: isSnapback ? "Mean Reversion" : "Tactical", tone: isSnapback ? "warning" : "positive" },
      ...(item.changePct !== null ? [{ label: formatPct(item.changePct), tone: toneOf(item.changePct) }] : []),
    ],
    sections: [
      {
        title: "Levels & Technicals",
        rows: [
          { label: "Reference level", value: formatMoney(item.referenceEntry, market) },
          { label: "Invalidation level", value: formatMoney(item.invalidationStop, market) },
          { label: "Target zone", value: formatMoney(item.targetZone, market) },
          { label: "ATR risk", value: `${item.riskPct.toFixed(1)}%` },
          { label: "RSI (14)", value: formatNumber(item.rsi14, 1) },
          { label: "Volume / 20D", value: item.volumeRatio !== null ? `${item.volumeRatio.toFixed(2)}x` : nil },
          { label: "20D move", value: formatPct(item.return20d) },
        ],
      },
    ],
  };
}

async function tacticalRadarScreen(market: MobileMarket, params: URLSearchParams): Promise<MobileScreen> {
  const data = await getTacticalRadar(market, 10);
  const bucketParam = pick(
    params.get("bucket"),
    ["FAVORED", "NEAR_TRIGGER", "MID_TREND_PULLBACK", "OVERSOLD_SNAPBACK", "ALL"] as const,
    "FAVORED",
  );
  const search = params.get("search")?.trim().toLowerCase() || "";
  const selectedKey: TacticalBucketKey | "ALL" =
    bucketParam === "FAVORED" ? data.context.favoredBucket : bucketParam;
  const list =
    selectedKey === "ALL"
      ? [...data.buckets.NEAR_TRIGGER, ...data.buckets.MID_TREND_PULLBACK, ...data.buckets.OVERSOLD_SNAPBACK]
      : data.buckets[selectedKey];
  const filtered = search
    ? list.filter(
        (c) =>
          c.ticker.toLowerCase().includes(search) ||
          c.name.toLowerCase().includes(search) ||
          (c.sector ?? "").toLowerCase().includes(search),
      )
    : list;

  return {
    key: "tactical-radar",
    title: "Tactical Radar",
    subtitle: `${data.context.regimeLabel} · Separate from Strong Swing`,
    generatedAt: data.generatedAt,
    summary: `${data.buckets.NEAR_TRIGGER.length} near-trigger · ${data.buckets.MID_TREND_PULLBACK.length} pullbacks · ${data.buckets.OVERSOLD_SNAPBACK.length} snapbacks`,
    notice: data.context.summary,
    options: [
      {
        param: "bucket",
        label: "Bucket",
        value: bucketParam,
        choices: [
          { value: "FAVORED", label: `Fits tape (${TACTICAL_BUCKET_META[data.context.favoredBucket].shortLabel})` },
          { value: "NEAR_TRIGGER", label: `Near-Trigger (${data.buckets.NEAR_TRIGGER.length})` },
          { value: "MID_TREND_PULLBACK", label: `Pullbacks (${data.buckets.MID_TREND_PULLBACK.length})` },
          { value: "OVERSOLD_SNAPBACK", label: `Snapbacks (${data.buckets.OVERSOLD_SNAPBACK.length})` },
          { value: "ALL", label: "All buckets" },
        ],
      },
    ],
    searchable: true,
    cards: filtered.map((item) => tacticalRadarCard(item, market)),
  };
}

const LOADERS: Record<string, (market: MobileMarket, params: URLSearchParams, userId: string) => Promise<MobileScreen>> = {
  home: (market, _params, userId) => homeScreen(market, userId),
  market: (market) => marketOverview(market),
  "stock-screener": stockScreener,
  swing: swingCandidates,
  "strong-swing": strongSwing,
  "momentum-v2": async (market, params, userId) => {
    const selected = new URLSearchParams(params);
    selected.set("model", "MOMENTUM_IGNITION_V2");
    return { ...await strongSwing(market, selected, userId), key: "momentum-v2" };
  },
  "trend-continuation": async (market, params, userId) => {
    if (market === "US") return {
      key: "trend-continuation",
      title: "Trend Continuation",
      subtitle: "Multi-session continuation assessment.",
      generatedAt: new Date().toISOString(),
      summary: "India market only",
      notice: "Trend Continuation is not enabled for the US market.",
      options: [],
      searchable: false,
      cards: [],
    };
    const selected = new URLSearchParams(params);
    selected.set("model", "TREND_CONTINUATION");
    return { ...await strongSwing(market, selected, userId), key: "trend-continuation" };
  },
  "tactical-radar": (market, params) => tacticalRadarScreen(market, params),
  "armed-swing": armedSwing,
  "long-term": longTerm,
};

/** Returns null for an unknown or native-only screen key. */
export function loadMobileScreen(key: string, market: MobileMarket, params: URLSearchParams, userId: string): Promise<MobileScreen> | null {
  const loader = Object.hasOwn(LOADERS, key) ? LOADERS[key] : undefined;
  return loader ? loader(market, params, userId) : null;
}
