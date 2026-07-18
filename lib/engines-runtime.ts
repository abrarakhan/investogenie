// Server-side glue: pull market data out of Postgres and run the analytical
// engines, scoped to a single market (US or India). Direct SQL; user-owned
// queries are scoped by the session user id (no RLS in plain Postgres).

import { query } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import {
  analyzeFundOverlap,
  type OverlapReport,
  type RebalanceInstruction,
} from "@/lib/analytics/fundOverlap";
import {
  buildMacroMatrix,
  type MacroMatrix,
  type SeriesInput,
} from "@/lib/analytics/macroCorrelator";
import type { MarketId, FundStockWeight, UserFundHolding } from "@/lib/types";
import { deriveLevels, type SwingSetup, type TradeDirection } from "@/lib/analytics/swingClassifier";
import { DEFAULT_SETTINGS, type SwingSettings } from "@/lib/settings";

export interface TopSetup {
  ticker: string;
  verdict: string;
  direction: TradeDirection;
  score: number;
  reason: string;
  currentPrice: number;
  entry: number;
  target: number;
  stopLoss: number;
  trailingStop: number;
  expectedDays: number;
}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const dateOnly = (value: string | Date) => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value).slice(0, 10) : parsed.toISOString().slice(0, 10);
};

/** Top active swing setups for a market, with per-user levels applied. */
export async function getTopSwingSetups(
  country: string,
  settings: SwingSettings = DEFAULT_SETTINGS,
  limit = 6,
): Promise<TopSetup[]> {
  const rows = await query<Record<string, unknown>>(
    `select s.ticker, s.verdict, s.score, s.reason, s.bias,
            q.price as current_price, s.atr,
            s.long_trigger, s.short_trigger, s.hh22, s.ll22, s.daily_velocity
       from public.swing_signals s
       join public.latest_quotes q on q.asset_id = s.asset_id
      where s.country = $1 and s.verdict <> 'NO_SETUP'
      order by s.score desc
      limit $2`,
    [country, limit * 2],
  );
  return rows
    .filter((r) => settings.includeShort || (r.bias as string) !== "SHORT")
    .slice(0, limit)
    .map((r) => {
      const direction: TradeDirection = (r.bias as string) === "SHORT" ? "SHORT" : "LONG";
      const setup: SwingSetup = {
        currentPrice: num(r.current_price), atr: num(r.atr),
        longTrigger: num(r.long_trigger), shortTrigger: num(r.short_trigger),
        hh22: num(r.hh22), ll22: num(r.ll22), dailyVelocity: num(r.daily_velocity),
      };
      const lv = deriveLevels(setup, direction, settings);
      return {
        ticker: r.ticker as string,
        verdict: r.verdict as string,
        direction,
        score: num(r.score),
        reason: (r.reason as string) ?? "",
        currentPrice: lv.currentPrice,
        entry: lv.entry, target: lv.target, stopLoss: lv.stopLoss,
        trailingStop: lv.trailingStop, expectedDays: lv.expectedDays,
      };
    });
}


const AMC_DISCLOSURES: Array<{ match: RegExp; amc: string; url: string }> = [
  { match: /INF209|ADITYA\s+BIRLA|ABSL/i, amc: "Aditya Birla Sun Life MF", url: "https://mutualfund.adityabirlacapital.com/forms-and-downloads/portfolio" },
  { match: /INF760|CANARA\s+ROBECO/i, amc: "Canara Robeco MF", url: "https://www.canararobeco.com/downloads" },
  { match: /INF740|\bDSP\b/i, amc: "DSP MF", url: "https://www.dspim.com/downloads" },
  { match: /INF090|FRANKLIN|TEMPLETON/i, amc: "Franklin Templeton India", url: "https://www.franklintempletonindia.com/downloads" },
  { match: /INF179|\bHDFC\b/i, amc: "HDFC MF", url: "https://www.hdfcfund.com/statutory-disclosure" },
  { match: /INF109|ICICI|PRUDENTIAL/i, amc: "ICICI Prudential MF", url: "https://www.icicipruamc.com/downloads" },
  { match: /INF204|NIPPON/i, amc: "Nippon India MF", url: "https://mf.nipponindiaim.com/investor-service/downloads" },
  { match: /INF200|\bSBI\b/i, amc: "SBI MF", url: "https://www.sbimf.com/downloads" },
  { match: /INF966|\bQUANT\b/i, amc: "Quant MF", url: "https://quantmutual.com/downloads/Notice-of-Monthly-Fortnightly-Portfolio" },
];

function disclosureInstruction(ticker: string, fundName?: string | null): RebalanceInstruction {
  const row = AMC_DISCLOSURES.find((d) => d.match.test(ticker) || d.match.test(fundName ?? ""));
  const label = fundName && fundName !== ticker ? `${fundName} (${ticker})` : ticker;
  return {
    kind: "DISCLOSURE_REQUIRED",
    message: row
      ? `Look-through pending for ${label}. Download the latest monthly portfolio disclosure from ${row.amc}: ${row.url}`
      : `Look-through pending for ${label}. Find the AMC monthly portfolio disclosure and import its stock weights to activate overlap scoring.`,
  };
}

/** Look-through fund overlap for the signed-in user's actual fund positions. */
export async function getFundOverlap(): Promise<OverlapReport | null> {
  const user = await getSessionUser();
  if (!user) return null;

  const heldFunds = (
    await query<{ id: string; ticker: string; name: string | null; asset_class: string; quantity: string | number; avg_cost: string | number | null }>(
      `select a.id, a.ticker, a.name, a.asset_class, h.quantity, h.avg_cost
         from public.holdings h
         join public.assets a on a.id = h.asset_id
        where h.user_id = $1`,
      [user.id],
    )
  )
    .map((h) => ({ id: h.id, ticker: h.ticker, name: h.name, assetClass: h.asset_class, units: Number(h.quantity), nav: Number(h.avg_cost ?? 0) }))
    .filter((h) => h.assetClass === "MUTUAL_FUND" && h.ticker && h.units > 0);
  if (heldFunds.length === 0) return null;

  const heldFundIds = heldFunds.map((h) => h.id);
  const userMfh = await query<{ fund_asset_id: string; stock_asset_id: string; weight_percentage: string | number }>(
    `select fund_asset_id, stock_asset_id, weight_percentage
       from public.user_mutual_fund_holdings
      where user_id = $1 and fund_asset_id = any($2)`,
    [user.id, heldFundIds],
  );
  const userScopedFunds = new Set(userMfh.map((r) => r.fund_asset_id));
  const globalFallbackFundIds = heldFundIds.filter((id) => !userScopedFunds.has(id));
  const globalMfh = globalFallbackFundIds.length
    ? await query<{ fund_asset_id: string; stock_asset_id: string; weight_percentage: string | number }>(
        `select fund_asset_id, stock_asset_id, weight_percentage
           from public.mutual_fund_holdings
          where fund_asset_id = any($1)`,
        [globalFallbackFundIds],
      )
    : [];
  const mfh = [...userMfh, ...globalMfh];
  if (mfh.length === 0) {
    const totalValue = heldFunds.reduce((sum, h) => sum + h.units * (h.nav > 0 ? h.nav : 100), 0);
    return {
      totalValue,
      fundValues: heldFunds.map((h) => ({
        ticker: h.name || h.ticker,
        value: h.units * (h.nav > 0 ? h.nav : 100),
        sharePct: totalValue === 0 ? 0 : ((h.units * (h.nav > 0 ? h.nav : 100)) / totalValue) * 100,
      })),
      stockExposure: [],
      pairwiseOverlaps: [],
      flaggedOverlaps: [],
      concentratedStocks: [],
      instructions: heldFunds.slice(0, 8).map((h) => disclosureInstruction(h.ticker, h.name)),
    };
  }

  const ids = [...new Set(mfh.flatMap((r) => [r.fund_asset_id, r.stock_asset_id]))];
  const assets = await query<{ id: string; ticker: string }>(
    "select id, ticker from public.assets where id = any($1)",
    [ids],
  );
  const idToTicker = new Map(assets.map((a) => [a.id, a.ticker]));

  const lookThrough: FundStockWeight[] = mfh
    .map((r) => ({
      fundTicker: idToTicker.get(r.fund_asset_id) ?? "",
      stockTicker: idToTicker.get(r.stock_asset_id) ?? "",
      weightPercentage: Number(r.weight_percentage),
    }))
    .filter((r) => r.fundTicker && r.stockTicker);
  const coveredFunds = new Set(lookThrough.map((r) => r.fundTicker));
  if (lookThrough.length === 0) {
    const totalValue = heldFunds.reduce((sum, h) => sum + h.units * (h.nav > 0 ? h.nav : 100), 0);
    return {
      totalValue,
      fundValues: heldFunds.map((h) => ({
        ticker: h.name || h.ticker,
        value: h.units * (h.nav > 0 ? h.nav : 100),
        sharePct: totalValue === 0 ? 0 : ((h.units * (h.nav > 0 ? h.nav : 100)) / totalValue) * 100,
      })),
      stockExposure: [],
      pairwiseOverlaps: [],
      flaggedOverlaps: [],
      concentratedStocks: [],
      instructions: heldFunds.slice(0, 8).map((h) => disclosureInstruction(h.ticker, h.name)),
    };
  }

  const meta = await query<{ asset_id: string; expense_ratio: string | number | null; plan_type: string | null }>(
    "select asset_id, expense_ratio, plan_type from public.mutual_fund_meta",
  );
  const metaList = meta.map((m) => ({
    ticker: idToTicker.get(m.asset_id) ?? "",
    expenseRatio: m.expense_ratio === null ? undefined : Number(m.expense_ratio),
    planType: (m.plan_type as "DIRECT" | "REGULAR") ?? undefined,
  }));
  const metaByTicker = new Map(metaList.map((m) => [m.ticker, m]));

  const portfolio: UserFundHolding[] = heldFunds.map((h) => ({
    fundTicker: h.ticker,
    units: h.units,
    navValue: h.nav > 0 ? h.nav : 100,
    planType: metaByTicker.get(h.ticker)?.planType,
  }));

  const report = analyzeFundOverlap(portfolio, lookThrough, metaList);
  const missingDisclosureInstructions = heldFunds
    .filter((h) => !coveredFunds.has(h.ticker))
    .slice(0, 5)
    .map((h) => disclosureInstruction(h.ticker, h.name));

  return {
    ...report,
    instructions: [...missingDisclosureInstructions, ...report.instructions],
  };
}

/** OHLCV close series for one ticker (used as a sector proxy). */
async function tickerCloseSeries(ticker: string): Promise<{ date: string; value: number }[]> {
  const rows = await query<{ date: string | Date; close: string | number }>(
    `select o.date, o.close
       from public.daily_ohlcv o
       join public.assets a on a.id = o.asset_id
      where a.ticker = $1
      order by o.date asc`,
    [ticker],
  );
  return rows.map((b) => ({ date: dateOnly(b.date), value: Number(b.close) }));
}

async function macroSectorSeries(market: MarketId): Promise<SeriesInput[]> {
  const proxies = market === "US"
    ? [
        ["SPY", "US_BROAD"],
        ["QQQ", "US_TECH"],
        ["NVDA", "US_AI"],
      ]
    : [
        ["RELIANCE", "IN_ENERGY"],
        ["HDFCBANK", "IN_BANKS"],
        ["INFY", "IN_IT"],
        ["TCS", "IN_IT_SERVICES"],
      ];

  const sectors: SeriesInput[] = [];
  for (const [ticker, key] of proxies) {
    const points = await tickerCloseSeries(ticker);
    if (points.length >= 90) sectors.push({ key, points });
  }
  return sectors;
}

/** Macro lead/lag matrix scoped to the market's representative sector proxies. */
export async function getMacroMatrix(market: MarketId): Promise<MacroMatrix | null> {
  const macro = await query<{ indicator_type: string; date: string | Date; value: string | number }>(
    "select indicator_type, date, value from public.macro_indicators order by date asc",
  );
  if (macro.length === 0) return null;

  const indicatorMap = new Map<string, SeriesInput>();
  for (const m of macro) {
    if (!indicatorMap.has(m.indicator_type)) indicatorMap.set(m.indicator_type, { key: m.indicator_type, points: [] });
    indicatorMap.get(m.indicator_type)!.points.push({ date: dateOnly(m.date), value: Number(m.value) });
  }

  const sectors = await macroSectorSeries(market);
  if (sectors.length === 0) return null;

  return buildMacroMatrix([...indicatorMap.values()], sectors);
}
