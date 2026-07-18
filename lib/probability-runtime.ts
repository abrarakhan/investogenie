import { query } from "@/lib/db";
import { MARKET_COUNTRY } from "@/lib/markets";
import { DEFAULT_PROBABILITY_CONFIG } from "@/lib/analytics/probability/config";
import type { MarketId } from "@/lib/types";
import type { ProbabilityConfig, ProbabilityForecast, ProbabilitySummary } from "@/lib/analytics/probability/types";

interface BarRow {
  asset_id: string;
  ticker: string;
  name: string | null;
  exchange: string;
  currency: string;
  date: string | Date;
  close: string | number;
}

interface FeatureRow {
  assetId: string;
  ticker: string;
  name: string;
  exchange: string;
  currency: string;
  closes: number[];
  dates: string[];
  momentum12Raw: number;
  momentum6Raw: number;
  priceZRaw: number;
  ret5ZRaw: number;
  sigmaDaily: number;
}

// Raw t(df=5) quantiles. A t_df variate has variance df/(df-2), so these must be
// divided by sqrt(df/(df-2)) before scaling by sigma — otherwise the band is
// ~29% wider than the sigma it was derived from.
const T5 = { p5: -2.015, p25: -0.727, p50: 0, p75: 0.727, p95: 2.015 } as const;
const tUnitScale = (df: number) => (df > 2 ? Math.sqrt(df / (df - 2)) : 1);

const dateOnly = (value: string | Date): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

const pctReturn = (from: number, to: number): number => from > 0 ? ((to / from) - 1) * 100 : 0;

function logReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) out.push(Math.log(closes[i] / closes[i - 1]));
  }
  return out;
}

function ewmaSigmaDaily(returns: number[], lambda: number): number {
  if (returns.length < 20) return 0;
  let variance = returns.slice(0, 30).reduce((s, r) => s + r * r, 0) / Math.min(30, returns.length);
  for (const r of returns.slice(30)) variance = lambda * variance + (1 - lambda) * r * r;
  return Math.sqrt(Math.max(variance, 0));
}

/** Cross-sectional z-scores keyed by assetId. Keying by ticker collided for a
 *  symbol listed on both NASDAQ and NYSE, silently giving one asset the other's
 *  factor exposures. */
function zScoreMap<T extends { assetId: string }>(rows: T[], pick: (row: T) => number): Map<string, number> {
  const values = rows.map(pick).filter((v) => Number.isFinite(v));
  const m = mean(values);
  const s = std(values) || 1;
  return new Map(rows.map((row) => {
    const z = (pick(row) - m) / s;
    return [row.assetId, Number.isFinite(z) ? z : 0];
  }));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-Math.max(-8, Math.min(8, x))));
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function featureRow(rows: BarRow[], cfg: ProbabilityConfig): FeatureRow | null {
  const first = rows[0];
  // Filter closes and dates together: dropping a bad close while keeping every
  // date desynchronised the arrays, shifting the momentum lookbacks and making
  // asOf report a date whose close had been discarded.
  const valid = rows
    .map((r) => ({ close: Number(r.close), date: dateOnly(r.date) }))
    .filter((p) => Number.isFinite(p.close) && p.close > 0);
  const closes = valid.map((p) => p.close);
  const dates = valid.map((p) => p.date);
  if (!first || closes.length < cfg.minBars) return null;
  const last = closes[closes.length - 1];
  const idx = closes.length - 1;
  const ma20 = mean(closes.slice(-20));
  const sd20 = std(closes.slice(-20)) || last * 0.01;
  const fiveReturns: number[] = [];
  for (let i = 5; i < closes.length; i++) fiveReturns.push(pctReturn(closes[i - 5], closes[i]));
  const ret5 = pctReturn(closes[idx - 5], last);
  const ret5Mean = mean(fiveReturns.slice(-120));
  const ret5Std = std(fiveReturns.slice(-120)) || 1;
  const rets = logReturns(closes);

  return {
    assetId: first.asset_id,
    ticker: first.ticker,
    name: first.name ?? first.ticker,
    exchange: first.exchange,
    currency: first.currency,
    closes,
    dates,
    momentum12Raw: pctReturn(closes[idx - 252], closes[idx - 21]),
    momentum6Raw: pctReturn(closes[idx - 126], closes[idx - 21]),
    priceZRaw: (last - ma20) / sd20,
    ret5ZRaw: (ret5 - ret5Mean) / ret5Std,
    sigmaDaily: ewmaSigmaDaily(rets, cfg.ewmaLambda),
  };
}

function buildForecasts(features: FeatureRow[], cfg: ProbabilityConfig): ProbabilityForecast[] {
  const z12 = zScoreMap(features, (r) => r.momentum12Raw);
  const z6 = zScoreMap(features, (r) => r.momentum6Raw);
  const zPrice = zScoreMap(features, (r) => r.priceZRaw);
  const zRet5 = zScoreMap(features, (r) => r.ret5ZRaw);

  return features.map((row) => {
    const momentum = 1.15 * (z12.get(row.assetId) ?? 0) + 0.55 * (z6.get(row.assetId) ?? 0);
    const snapback = -0.22 * (zPrice.get(row.assetId) ?? 0) - 0.14 * (zRet5.get(row.assetId) ?? 0);
    const volPenalty = -0.18 * Math.max(0, row.sigmaDaily * Math.sqrt(252) - 0.35);
    const expectedReturnPct = clamp((1.55 * momentum + snapback + volPenalty), -18, 18);
    const sigma21Pct = clamp(row.sigmaDaily * Math.sqrt(cfg.horizonDays) * 100, 2, 45);
    const signalToNoise = expectedReturnPct / Math.max(1, sigma21Pct);
    const probabilityUpPct = clamp(sigmoid(signalToNoise * 1.75) * 100, 5, 95);
    const drawdownRiskPct = clamp(sigmoid((sigma21Pct - cfg.drawdownThresholdPct + Math.max(0, -expectedReturnPct)) / 6) * 100, 3, 97);
    const lastPrice = row.closes[row.closes.length - 1];
    const tScale = tUnitScale(cfg.studentTdf);
    const percentileReturn = (q: keyof typeof T5) => expectedReturnPct + (T5[q] / tScale) * sigma21Pct;
    const percentiles = {
      p5: percentileReturn("p5"),
      p25: percentileReturn("p25"),
      p50: percentileReturn("p50"),
      p75: percentileReturn("p75"),
      p95: percentileReturn("p95"),
    };
    const priceRange = Object.fromEntries(
      Object.entries(percentiles).map(([key, value]) => [key, lastPrice * (1 + value / 100)]),
    ) as ProbabilityForecast["priceRange"];
    const contributionRows = [
      { label: "12-1M momentum", value: z12.get(row.assetId) ?? 0 },
      { label: "6-1M momentum", value: z6.get(row.assetId) ?? 0 },
      { label: "20DMA snapback", value: -(zPrice.get(row.assetId) ?? 0) },
      { label: "5D snapback", value: -(zRet5.get(row.assetId) ?? 0) },
    ].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

    return {
      assetId: row.assetId,
      ticker: row.ticker,
      name: row.name,
      exchange: row.exchange,
      currency: row.currency,
      lastPrice,
      bars: row.closes.length,
      asOf: row.dates[row.dates.length - 1],
      probabilityUpPct,
      expectedReturnPct,
      sigma21Pct,
      drawdownRiskPct,
      percentiles,
      priceRange,
      contributions: contributionRows.slice(0, 3).map((c) => {
        const tone: ProbabilityForecast["contributions"][number]["tone"] =
          Math.abs(c.value) < 0.25 ? "neutral" : c.value > 0 ? "positive" : "negative";
        return { label: c.label, value: c.value, tone };
      }),
      calibration: {
        hitRatePct: null,
        brierScore: null,
        warning: "Calibration pending - treat as an exploratory probability estimate.",
      },
    };
  }).sort((a, b) => b.probabilityUpPct - a.probabilityUpPct);
}

export async function getProbabilitySummary(
  market: MarketId,
  cfg: ProbabilityConfig = DEFAULT_PROBABILITY_CONFIG,
): Promise<ProbabilitySummary> {
  const country = MARKET_COUNTRY[market];
  const exchanges = market === "IN" ? ["NSE"] : ["NASDAQ", "NYSE"];
  const rows = await query<BarRow>(
    // Only consider assets that already have enough history to forecast, and
    // rank by size rather than by |change_pct|. Ranking by biggest mover
    // selected for volatility artefacts (low-priced names) and ignored coverage
    // entirely, so on US only ~34 of 320 candidates cleared minBars and the rest
    // of the fetch was discarded.
    `with eligible as (
       select o.asset_id, count(*) as bars
         from public.daily_ohlcv o
        where o.date >= current_date - interval '430 days'
        group by o.asset_id
       having count(*) >= $4
     ),
     ranked_assets as (
       select a.id
         from public.assets a
         join eligible e on e.asset_id = a.id
         left join public.latest_financials f on f.asset_id = a.id
        where a.country = $1 and a.exchange = any($2) and a.asset_class = 'STOCK'::asset_class and a.is_active
        order by f.market_cap desc nulls last, a.ticker
        limit $3
     )
     select a.id asset_id, a.ticker, a.name, a.exchange, a.currency, o.date, o.close
       from ranked_assets r
       join public.assets a on a.id = r.id
       join public.daily_ohlcv o on o.asset_id = a.id
      where o.date >= current_date - interval '430 days'
      order by a.ticker, o.date`,
    // Candidates are now pre-filtered for coverage, so a small multiple of
    // maxRows is plenty of headroom instead of a 4x over-fetch.
    [country, exchanges, Math.max(cfg.maxRows * 2, 120), cfg.minBars],
  );

  const grouped = new Map<string, BarRow[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.asset_id) ?? [];
    bucket.push(row);
    grouped.set(row.asset_id, bucket);
  }

  const features = [...grouped.values()].flatMap((assetRows) => {
    const f = featureRow(assetRows, cfg);
    return f ? [f] : [];
  });
  const forecasts = buildForecasts(features, cfg).slice(0, cfg.maxRows);

  return {
    market,
    horizonDays: cfg.horizonDays,
    generatedAt: new Date().toISOString(),
    rows: forecasts,
    coverage: {
      eligible: grouped.size,
      forecasted: forecasts.length,
      skippedInsufficientHistory: Math.max(0, grouped.size - features.length),
    },
  };
}
