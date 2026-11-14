import { query } from "@/lib/db";
import { scoreNewsSwing, type NewsDirection, type NewsScope } from "@/lib/analytics/newsSwing";
import { assessTradeRisk, type TradeRiskAssessment, type TradeRiskState } from "@/lib/analytics/tradeRisk";
import { reviseSwingTradePlan, type TradePlanRevision } from "@/lib/analytics/tradePlanRevision";
import { isMarketOpenNow, isTradingDay, refreshMarketHolidays, zonedMarketClock } from "@/lib/market-calendar.mjs";
import { calculateRecoveryTargets } from "@/lib/tradeRecoveryTargets";
import { STRONG_SWING_TRAILING_POLICY_VERSION } from "@/lib/analytics/strongSwing";
import { strategyFollowUp, type StrategyFollowUp } from "@/lib/analytics/legendaryStrategies";
import type { OHLCV } from "@/lib/types";

export type SwingTradeState =
  | "ON_TRACK"
  | "TARGET_REACHED"
  | "STOP_BREACHED"
  | "TRAIL_BREACHED"
  | "WINDOW_EXPIRED"
  | "NO_QUOTE"
  | "CLOSED";

export interface SwingTradeProgressInput {
  status: "OPEN" | "CLOSED";
  boughtOn: string;
  buyPrice: number;
  quantity: number;
  currentPrice: number | null;
  target: number;
  stop: number;
  trailingStop: number | null;
  expectedDays: number;
  exitPrice?: number | null;
  asOf?: string;
  market?: "IN" | "US";
}

export interface SwingTradeProgress {
  daysHeld: number;
  calendarDaysHeld: number;
  daysRemaining: number;
  currentValue: number | null;
  investedValue: number;
  pnlValue: number | null;
  pnlPct: number | null;
  targetProgressPct: number | null;
  remainingUpsidePct: number | null;
  state: SwingTradeState;
}

export interface SwingTradeLedgerSummary {
  openCount: number;
  closedCount: number;
  openInvestedValue: number;
  unrealizedPnlValue: number;
  realizedPnlValue: number;
  overallPnlValue: number;
  totalInvestedValue: number;
  capitalEmployedValue: number;
  currentOpenValue: number;
  roiPct: number | null;
  xirrPct: number | null;
}

export function calculateRecommendedGttStop(input: {
  buyPrice: number;
  projectedStop: number;
  projectedTrailingStop: number | null;
  trailingDistance: number | null;
  highestHigh: number | null;
  currentPrice: number | null;
  /** Next-bar policy: only completed-session highs strictly after the fill session. */
  postEntryCompletedHigh?: number | null;
  postEntryNextBarPolicy?: boolean;
  direction?: "LONG" | "SHORT";
}): { recommendedStop: number; breakEvenActivated: boolean } {
  const direction = input.direction ?? "LONG";
  if (direction === "SHORT") {
    const observedLow = input.postEntryNextBarPolicy
      ? input.buyPrice
      : Math.min(input.buyPrice, input.currentPrice ?? input.buyPrice);
    const initialRisk = Math.max(0, input.projectedStop - input.buyPrice);
    const breakEvenActivated = initialRisk > 0 && observedLow <= input.buyPrice - (0.75 * initialRisk);
    const chandelierStop = input.trailingDistance === null
      ? input.projectedStop
      : observedLow + input.trailingDistance;
    return {
      recommendedStop: Math.min(
        input.projectedStop,
        input.projectedTrailingStop ?? input.projectedStop,
        chandelierStop,
        breakEvenActivated ? input.buyPrice : input.projectedStop,
      ),
      breakEvenActivated,
    };
  }
  const observedHigh = input.postEntryNextBarPolicy
    ? Math.max(input.buyPrice, input.postEntryCompletedHigh ?? input.buyPrice)
    : Math.max(input.buyPrice, input.highestHigh ?? input.buyPrice, input.currentPrice ?? input.buyPrice);
  const initialRisk = Math.max(0, input.buyPrice - input.projectedStop);
  const breakEvenActivated = initialRisk > 0 && observedHigh >= input.buyPrice + (0.75 * initialRisk);
  const chandelierStop = input.trailingDistance === null
    ? input.projectedStop
    : observedHigh - input.trailingDistance;
  return {
    recommendedStop: Math.max(
      input.projectedStop,
      input.projectedTrailingStop ?? input.projectedStop,
      chandelierStop,
      breakEvenActivated ? input.buyPrice : input.projectedStop,
    ),
    breakEvenActivated,
  };
}

export interface DatedCashFlow { date: string; amount: number }

export function calculateXirr(cashFlows: DatedCashFlow[]): number | null {
  const flows = cashFlows.filter((flow) => Number.isFinite(flow.amount) && /^\d{4}-\d{2}-\d{2}$/.test(flow.date));
  if (!flows.some((flow) => flow.amount < 0) || !flows.some((flow) => flow.amount > 0)) return null;
  const first = Math.min(...flows.map((flow) => utcDate(flow.date).getTime()));
  const npv = (rate: number) => flows.reduce((sum, flow) => {
    const years = (utcDate(flow.date).getTime() - first) / (365 * 86_400_000);
    return sum + flow.amount / ((1 + rate) ** years);
  }, 0);
  let low = -0.9999;
  let high = 10;
  let lowValue = npv(low);
  let highValue = npv(high);
  while (lowValue * highValue > 0 && high < 1_000_000) {
    high *= 10;
    highValue = npv(high);
  }
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue * highValue > 0) return null;
  for (let iteration = 0; iteration < 200; iteration++) {
    const mid = (low + high) / 2;
    const value = npv(mid);
    if (Math.abs(value) < 0.000001) return mid * 100;
    if (lowValue * value <= 0) {
      high = mid;
      highValue = value;
    } else {
      low = mid;
      lowValue = value;
    }
  }
  return ((low + high) / 2) * 100;
}

export function summarizeSwingTradeLedger(trades: ReadonlyArray<{
  status: "OPEN" | "CLOSED";
  progress: Pick<SwingTradeProgress, "investedValue" | "pnlValue">;
  realizedPnlValue?: number;
  purchaseValue?: number;
  boughtOn?: string;
  currentPrice?: number | null;
  remainingQuantity?: number;
  closedOn?: string | null;
  exitPrice?: number | null;
  quantity?: number;
  exits?: SwingTradeExit[];
}>): SwingTradeLedgerSummary {
  const tradingCashFlowEvents: Array<{ date: string; amount: number; order: number }> = [];
  const asOf = new Date().toISOString().slice(0, 10);
  const summary = trades.reduce<SwingTradeLedgerSummary>((summary, trade) => {
    const purchaseValue = trade.purchaseValue ?? trade.progress.investedValue;
    const quantity = trade.quantity ?? 0;
    const remainingQuantity = trade.remainingQuantity ?? (trade.status === "OPEN" ? quantity : 0);
    const remainingCost = quantity > 0 ? purchaseValue * (remainingQuantity / quantity) : trade.progress.investedValue;
    const currentOpenValue = trade.status === "OPEN" && trade.currentPrice !== null && trade.currentPrice !== undefined
      ? trade.currentPrice * remainingQuantity
      : trade.status === "OPEN" ? remainingCost + (trade.progress.pnlValue ?? 0) : 0;
    const unrealizedPnl = trade.status === "OPEN" ? currentOpenValue - remainingCost : 0;
    const realizedPnl = trade.realizedPnlValue
      ?? (trade.status === "CLOSED" ? trade.progress.pnlValue ?? 0 : 0);
    if (trade.boughtOn) tradingCashFlowEvents.push({ date: trade.boughtOn, amount: -purchaseValue, order: 0 });
    for (const exit of trade.exits ?? []) tradingCashFlowEvents.push({ date: exit.soldOn, amount: exit.saleValue, order: 1 });
    if (!(trade.exits?.length) && trade.status === "CLOSED" && trade.closedOn && trade.exitPrice && quantity > 0) {
      tradingCashFlowEvents.push({ date: trade.closedOn, amount: trade.exitPrice * quantity, order: 1 });
    }
    if (trade.status === "OPEN") {
      summary.openCount += 1;
      summary.openInvestedValue += remainingCost;
      summary.currentOpenValue += currentOpenValue;
      summary.unrealizedPnlValue += unrealizedPnl;
    } else {
      summary.closedCount += 1;
    }
    summary.realizedPnlValue += realizedPnl;
    summary.overallPnlValue += unrealizedPnl + realizedPnl;
    summary.totalInvestedValue += purchaseValue;
    return summary;
  }, {
    openCount: 0,
    closedCount: 0,
    openInvestedValue: 0,
    unrealizedPnlValue: 0,
    realizedPnlValue: 0,
    overallPnlValue: 0,
    totalInvestedValue: 0,
    capitalEmployedValue: 0,
    currentOpenValue: 0,
    roiPct: null,
    xirrPct: null,
  });
  const capitalCashFlows: DatedCashFlow[] = [];
  let retainedCash = 0;
  for (const { date, amount } of tradingCashFlowEvents.sort((left, right) => (
    left.date.localeCompare(right.date) || left.order - right.order
  ))) {
    retainedCash += amount;
    if (retainedCash < 0) {
      const contribution = -retainedCash;
      summary.capitalEmployedValue += contribution;
      capitalCashFlows.push({ date, amount: -contribution });
      retainedCash = 0;
    }
  }
  if (capitalCashFlows.length > 0) {
    const terminalDate = trades.some((trade) => trade.status === "OPEN")
      ? asOf
      : tradingCashFlowEvents.map((event) => event.date).sort().at(-1) ?? asOf;
    capitalCashFlows.push({ date: terminalDate, amount: retainedCash + summary.currentOpenValue });
  } else {
    summary.capitalEmployedValue = summary.totalInvestedValue;
  }
  summary.roiPct = summary.capitalEmployedValue > 0
    ? (summary.overallPnlValue / summary.capitalEmployedValue) * 100
    : null;
  summary.xirrPct = calculateXirr(capitalCashFlows);
  return summary;
}

export interface SwingTradeExit {
  id: string;
  soldOn: string;
  quantity: number;
  exitPrice: number;
  reason: string | null;
  realizedPnlValue: number;
  saleValue: number;
}

function utcDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

/** Trading-session approximation used by the swing engine's bar-based horizon. */
export function tradingDaysBetween(from: string, to: string, market: "IN" | "US" = "IN"): number {
  const start = utcDate(from);
  const end = utcDate(to);
  if (end <= start) return 0;
  let count = 0;
  const cursor = new Date(start);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor <= end) {
    if (isTradingDay(market, cursor.toISOString().slice(0, 10))) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export function calculateSwingTradeProgress(input: SwingTradeProgressInput): SwingTradeProgress {
  const today = (input.asOf ?? new Date().toISOString()).slice(0, 10);
  const daysHeld = tradingDaysBetween(input.boughtOn, today, input.market ?? "IN");
  const calendarDaysHeld = Math.max(0, Math.floor((utcDate(today).getTime() - utcDate(input.boughtOn).getTime()) / 86_400_000));
  const mark = input.status === "CLOSED" ? (input.exitPrice ?? input.currentPrice) : input.currentPrice;
  const investedValue = input.buyPrice * input.quantity;
  const currentValue = mark === null ? null : mark * input.quantity;
  const pnlValue = currentValue === null ? null : currentValue - investedValue;
  const pnlPct = mark === null ? null : ((mark / input.buyPrice) - 1) * 100;
  const targetDistance = input.target - input.buyPrice;
  const targetProgressPct = mark === null || targetDistance <= 0
    ? null
    : ((mark - input.buyPrice) / targetDistance) * 100;
  const remainingUpsidePct = mark === null ? null : ((input.target / mark) - 1) * 100;

  let state: SwingTradeState;
  if (input.status === "CLOSED") state = "CLOSED";
  else if (mark === null) state = "NO_QUOTE";
  else if (mark >= input.target) state = "TARGET_REACHED";
  else if (mark <= input.stop) state = "STOP_BREACHED";
  else if (input.trailingStop !== null && mark <= input.trailingStop) state = "TRAIL_BREACHED";
  else if (daysHeld > input.expectedDays) state = "WINDOW_EXPIRED";
  else state = "ON_TRACK";

  return {
    daysHeld,
    calendarDaysHeld,
    daysRemaining: Math.max(0, input.expectedDays - daysHeld),
    currentValue,
    investedValue,
    pnlValue,
    pnlPct,
    targetProgressPct,
    remainingUpsidePct,
    state,
  };
}

export interface SwingLedgerTrade {
  id: string;
  assetId: string;
  ticker: string;
  assetName: string | null;
  exchange: string | null;
  market: "IN" | "US";
  status: "OPEN" | "CLOSED";
  boughtOn: string;
  buyPrice: number;
  purchaseValue: number;
  quantity: number;
  soldQuantity: number;
  remainingQuantity: number;
  realizedPnlValue: number;
  exits: SwingTradeExit[];
  currency: string;
  strategyKey: string;
  strategyLabel: string;
  signalVerdict: string | null;
  signalAsOf: string | null;
  signalScore: number | null;
  projectionEntry: number | null;
  projectedTarget: number;
  projectedStop: number;
  projectedTrailingStop: number | null;
  effectiveTrailingStop: number | null;
  recordedGttStop: number;
  recommendedGttStop: number;
  gttUpdatedAt: string | null;
  gttUpdateRequired: boolean;
  breakEvenActivated: boolean;
  /** The strategy's own exit line in force (10-day EMA, 50-day, 200-day, box bottom), if any. */
  strategyExitLine: number | null;
  strategyExitLabel: string | null;
  /** A mean-reversion trade's target as the mean stands now; null for other strategies. */
  strategyTarget: number | null;
  strategyCloseExitConfirmed: boolean;
  scaleOutTarget: number | null;
  scaleOutPlannedQuantity: number;
  scaleOutRemainingQuantity: number;
  expectedHoldingDays: number;
  currentPrice: number | null;
  quoteAsOf: string | null;
  quoteUpdatedAt: string | null;
  closedOn: string | null;
  exitPrice: number | null;
  closeReason: string | null;
  notes: string | null;
  progress: SwingTradeProgress;
  revisedPlan: TradePlanRevision;
  risk: TradeRiskAssessment & {
    state: TradeRiskState;
    newsAdjustment: number;
    marketMove1dPct: number | null;
    marketMove2dPct: number | null;
    stockMove1dPct: number | null;
    stockMove2dPct: number | null;
    newsAsOf: string | null;
    evidence: Array<{
      title: string;
      url: string;
      direction: NewsDirection;
      rationale: string;
      publishedAt: string;
    }>;
  };
}

type LedgerValue = unknown;
type LedgerRow = Record<string, LedgerValue>;

/**
 * Trades bought from this date on, in any strategy, advance their trail only from completed
 * sessions after the entry day. Trades opened earlier keep the stop they were already shown:
 * switching them would lower a recommended stop on a live position.
 */
export const POST_ENTRY_TRAIL_FROM = "2026-11-14";

/** Strategies with a documented post-entry line or moving target. */
const STRATEGY_LINE_KEYS = new Set(["QULLAMAGGIE", "MINERVINI", "PTJ", "DARVAS", "SIMONS"]);

/**
 * Trades of the five named strategies bought from this date display their strategy-specific
 * completed-close exit line (or moving target). Live broker protection remains separate.
 * Earlier trades keep the follow-up contract they were opened with.
 */
export function usesStrategyFollowUp(strategyKey: string, boughtOn: string | null): boolean {
  return STRATEGY_LINE_KEYS.has(strategyKey) && boughtOn !== null && boughtOn >= POST_ENTRY_TRAIL_FROM;
}

function ledgerTradeDirection(row: LedgerRow): "LONG" | "SHORT" {
  const raw = row.projection_snapshot;
  let snapshot: Record<string, unknown> = {};
  try {
    snapshot = typeof raw === "string" ? JSON.parse(raw) as Record<string, unknown>
      : raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  } catch { /* A malformed legacy snapshot stays on the long-only ledger default. */ }
  const levels = snapshot.levels && typeof snapshot.levels === "object" ? snapshot.levels as Record<string, unknown> : null;
  const score = snapshot.strategyScore && typeof snapshot.strategyScore === "object" ? snapshot.strategyScore as Record<string, unknown> : null;
  return levels?.direction === "SHORT" || score?.dir === "SHORT" ? "SHORT" : "LONG";
}

function ledgerScaleOutFraction(row: LedgerRow): number {
  const raw = row.projection_snapshot;
  try {
    const snapshot = typeof raw === "string" ? JSON.parse(raw) as Record<string, unknown>
      : raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const score = snapshot.strategyScore && typeof snapshot.strategyScore === "object"
      ? snapshot.strategyScore as Record<string, unknown> : null;
    const value = Number(score?.scaleOutFraction ?? 0);
    return Number.isFinite(value) && value > 0 && value <= 1 ? value : 0;
  } catch { return 0; }
}

export function strategyFollowUpTarget(
  direction: "LONG" | "SHORT", buyPrice: number, frozenTarget: number, movingTarget: number | null,
): number {
  if (movingTarget === null) return frozenTarget;
  if (direction === "LONG") return movingTarget > buyPrice ? Math.min(frozenTarget, movingTarget) : frozenTarget;
  return movingTarget < buyPrice ? Math.max(frozenTarget, movingTarget) : frozenTarget;
}

/**
 * The stop inputs for a trade managed on its strategy's line: the line replaces the ATR
 * chandelier and never sits below the trail frozen at purchase. A strategy with no line yet
 * (a Darvas trade before its first new box) keeps the frozen levels.
 */
export function strategyLineStopInputs(
  frozenTrail: number | null,
  followUp: StrategyFollowUp | null,
  direction: "LONG" | "SHORT" = "LONG",
): { projectedTrailingStop: number | null; trailingDistance: null } {
  const line = followUp?.line ?? null;
  return {
    projectedTrailingStop: line === null ? frozenTrail
      : direction === "LONG" ? Math.max(frozenTrail ?? line, line) : Math.min(frozenTrail ?? line, line),
    trailingDistance: null,
  };
}

export function usesPostEntryNextBarTrail(boughtOn: string | null, strongSwingPlanVersioned: boolean): boolean {
  return strongSwingPlanVersioned || (boughtOn !== null && boughtOn >= POST_ENTRY_TRAIL_FROM);
}

function usesStrongSwingPostEntryTrail(row: LedgerRow): boolean {
  if (String(row.strategy_key) !== "STRONG_SWING") return false;
  const raw = row.projection_snapshot;
  let snapshot: Record<string, unknown> | null = null;
  if (raw && typeof raw === "object") snapshot = raw as Record<string, unknown>;
  else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object") snapshot = parsed as Record<string, unknown>;
    } catch {
      return false;
    }
  }
  const plan = snapshot?.plan && typeof snapshot.plan === "object"
    ? snapshot.plan as Record<string, unknown> : null;
  const planSnapshot = plan?.snapshot && typeof plan.snapshot === "object"
    ? plan.snapshot as Record<string, unknown> : null;
  return planSnapshot?.ledgerTrailingPolicyVersion === STRONG_SWING_TRAILING_POLICY_VERSION;
}

export const ledgerDateText = (value: LedgerValue) => {
  if (!value) return null;
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
};
const dateText = ledgerDateText;
const nullableNumber = (value: LedgerValue) => value === null ? null : Number(value);

function parseExits(value: LedgerValue, unitCost: number): SwingTradeExit[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const quantity = Number(record.quantity);
    const exitPrice = Number(record.exitPrice);
    if (!Number.isFinite(quantity) || !Number.isFinite(exitPrice)) return [];
    const saleValue = record.saleValue === null || record.saleValue === undefined
      ? exitPrice * quantity : Number(record.saleValue);
    const realizedPnlValue = record.realizedPnl === null || record.realizedPnl === undefined
      ? saleValue - (unitCost * quantity) : Number(record.realizedPnl);
    return [{
      id: String(record.id),
      soldOn: dateText(record.soldOn) ?? "",
      quantity,
      exitPrice,
      reason: record.reason === null || record.reason === undefined ? null : String(record.reason),
      realizedPnlValue,
      saleValue,
    }];
  });
}

export async function getSwingTradeLedger(userId: string, market: "IN" | "US"): Promise<SwingLedgerTrade[]> {
  if (market === "IN") await refreshMarketHolidays("IN");
  const marketOpen = isMarketOpenNow(market);
  const marketDate = zonedMarketClock(market).date;
  const rows = await query<LedgerRow>(
    `select l.*, a.ticker, a.name asset_name, a.exchange, a.sector asset_sector,
            q.price current_price, q.as_of quote_as_of, q.updated_at quote_updated_at,
            s.atr current_atr,
            stock_path.prior_close, stock_path.two_session_close,
            coalesce(sales.sold_quantity,0) sold_quantity,
            coalesce(sales.realized_proceeds,0) realized_proceeds,
            coalesce(sales.exits,'[]'::jsonb) exits,
            path.highest_high,path.lowest_low,path.post_entry_completed_high
       from public.swing_trade_ledger l
       join public.assets a on a.id = l.asset_id
       left join public.latest_quotes q on q.asset_id = l.asset_id
       left join lateral (
         select max(close) filter (where rn=1) prior_close,
                max(close) filter (where rn=2) two_session_close
           from (
             select d.close,row_number() over (order by d.date desc) rn
               from public.daily_ohlcv d
              where d.asset_id=l.asset_id
                and d.date < coalesce(q.as_of::date,current_date)
              order by d.date desc
              limit 2
           ) closes
       ) stock_path on true
       left join lateral (
         select max(d.high) highest_high, min(d.low) lowest_low,
                max(d.high) filter (where d.date > l.bought_on and d.date < $3::date) post_entry_completed_high
           from public.daily_ohlcv d
          where d.asset_id = l.asset_id
            and d.date >= l.bought_on
            and d.date <= coalesce(l.closed_on, current_date)
       ) path on true
       left join public.swing_signals s on s.asset_id=l.asset_id
       left join lateral (
         select sum(e.quantity) sold_quantity,
                sum(e.quantity * e.exit_price) realized_proceeds,
                jsonb_agg(jsonb_build_object(
                  'id',e.id,
                  'soldOn',e.sold_on,
                  'quantity',e.quantity,
                  'exitPrice',e.exit_price,
                  'saleValue',coalesce(e.sale_value,e.quantity * e.exit_price),
                  'realizedPnl',e.realized_pnl,
                  'reason',e.reason
                ) order by e.sold_on,e.created_at) exits
           from public.swing_trade_exits e
          where e.trade_id=l.id
       ) sales on true
      where l.user_id = $1 and l.market = $2
      order by (l.status = 'OPEN') desc, l.bought_on desc, l.created_at desc`,
    [userId, market, marketDate],
  );

  type ImpactRow = {
    asset_id: string | null;
    sector: string | null;
    scope: NewsScope;
    direction: NewsDirection;
    sentimentScore: string | number;
    confidence: string | number;
    severity: string | number;
    title: string;
    url: string;
    rationale: string;
    published_at: Date | string;
    verified_evidence: boolean;
  };
  const openRows = rows.filter((row) => String(row.status) === "OPEN");
  const assetIds = openRows.map((row) => String(row.asset_id));
  const impacts = assetIds.length ? await query<ImpactRow>(
    `select i.asset_id,i.sector,i.scope,i.direction,i.sentiment_score "sentimentScore",
            i.confidence,i.severity,i.verified_evidence,a.title,a.url,i.rationale,a.published_at
       from public.news_impacts i
       join public.news_articles a on a.id=i.article_id
      where i.market=$1
        and a.published_at >= now() - interval '7 days'
        and (i.scope='MARKET' or i.asset_id=any($2::uuid[]))
      order by a.published_at desc`,
    [market, assetIds],
  ) : [];
  const newsHealth = await query<{ fetched_at: Date | null }>(
    `select max(a.fetched_at) fetched_at
       from public.news_articles a
       join public.news_impacts i on i.article_id=a.id
      where i.market=$1`,
    [market],
  );
  const newsAsOf = newsHealth[0]?.fetched_at ? new Date(newsHealth[0].fetched_at).toISOString() : null;
  const newsFresh = Boolean(newsAsOf && Date.now() - Date.parse(newsAsOf) <= 2 * 60 * 60 * 1000);

  const benchmarkTicker = market === "IN" ? "NIFTY" : "SPX";
  const benchmark = await query<{ price: string | number | null; change_pct: string | number | null; updated_at: Date | string | null; two_session_reference: string | number | null }>(
    `select q.price,q.change_pct,q.updated_at,h.two_session_reference
       from public.assets a
       left join public.latest_quotes q on q.asset_id=a.id
       left join lateral (
         select d.close two_session_reference
           from public.daily_ohlcv d
          where d.asset_id=a.id and d.date < q.as_of::date
          order by d.date desc offset 1 limit 1
       ) h on true
      where a.ticker=$1 and a.country=$2
      order by case when $2='IN' and a.exchange='NSE' then 0 when $2='US' and a.exchange in ('NYSE','NASDAQ') then 0 else 1 end
      limit 1`,
    [benchmarkTicker, market],
  );
  const benchmarkUpdatedAt = benchmark[0]?.updated_at ? new Date(benchmark[0].updated_at).getTime() : 0;
  const benchmarkFresh = !marketOpen || benchmarkUpdatedAt >= Date.now() - 7 * 60 * 1000;
  const benchmarkPrice = benchmarkFresh ? nullableNumber(benchmark[0]?.price ?? null) : null;
  const marketMove1dPct = benchmarkFresh ? nullableNumber(benchmark[0]?.change_pct ?? null) : null;
  const twoSessionReference = nullableNumber(benchmark[0]?.two_session_reference ?? null);
  const marketMove2dPct = benchmarkPrice !== null && twoSessionReference && twoSessionReference > 0
    ? ((benchmarkPrice / twoSessionReference) - 1) * 100
    : null;

  const cutoffDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: market === "IN" ? "Asia/Kolkata" : "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const recoveryTargets = await calculateRecoveryTargets(openRows.flatMap((row) => {
    const currentPrice = nullableNumber(row.current_price);
    const atr = nullableNumber(row.current_atr) ?? nullableNumber(row.projected_atr);
    const priorClose = nullableNumber(row.prior_close);
    const twoSessionClose = nullableNumber(row.two_session_close);
    if (!currentPrice || !atr || currentPrice <= 0 || atr <= 0) return [];
    return [{
      tradeId: String(row.id), assetId: String(row.asset_id), market, cutoffDate,
      currentPrice, atr,
      move1dPct: priorClose && priorClose > 0 ? ((currentPrice / priorClose) - 1) * 100 : null,
      move2dPct: twoSessionClose && twoSessionClose > 0 ? ((currentPrice / twoSessionClose) - 1) * 100 : null,
      horizon: Math.max(2, Number(row.expected_holding_days)),
    }];
  }));

  // Completed daily bars for open trades that follow their strategy's own exit line.
  const followUpRows = openRows.filter((row) => usesStrategyFollowUp(String(row.strategy_key), ledgerDateText(row.bought_on)));
  const followUpBars = new Map<string, OHLCV[]>();
  if (followUpRows.length) {
    const barRows = await query<{
      asset_id: string; date: string; open: string; high: string; low: string; close: string; volume: string | null;
    }>(
      `select asset_id,date::text date,open,high,low,close,volume
         from (
           select o.*,row_number() over(partition by o.asset_id order by o.date desc) rn
             from public.daily_ohlcv o
            where o.asset_id = any($1::uuid[]) and o.date < $2::date
         ) ranked
        where rn <= 260 order by asset_id,date`,
      [[...new Set(followUpRows.map((row) => String(row.asset_id)))], marketDate],
    );
    for (const bar of barRows) {
      const list = followUpBars.get(bar.asset_id) ?? [];
      list.push({
        date: bar.date.slice(0, 10), open: Number(bar.open), high: Number(bar.high), low: Number(bar.low),
        close: Number(bar.close), volume: Number(bar.volume ?? 0), openInterest: null,
      });
      followUpBars.set(bar.asset_id, list);
    }
  }

  return rows.map((row) => {
    const boughtOn = dateText(row.bought_on) ?? "";
    const status = String(row.status) as "OPEN" | "CLOSED";
    const buyPrice = Number(row.buy_price);
    const purchaseValue = Number(row.purchase_value ?? buyPrice * Number(row.quantity));
    const quantity = Number(row.quantity);
    const exits = parseExits(row.exits, quantity > 0 ? purchaseValue / quantity : buyPrice);
    const soldQuantity = Math.min(quantity, Math.max(0, Number(row.sold_quantity ?? 0)));
    const remainingQuantity = status === "CLOSED" ? 0 : Math.max(0, quantity - soldQuantity);
    const legacyExitPrice = nullableNumber(row.exit_price);
    const realizedPnlValue = soldQuantity > 0
      ? exits.reduce((sum, exit) => sum + exit.realizedPnlValue, 0)
      : status === "CLOSED" && legacyExitPrice !== null
        ? (legacyExitPrice * quantity) - purchaseValue
        : 0;
    const quoteUpdatedAt = row.quote_updated_at ? new Date(row.quote_updated_at as Date | string).getTime() : 0;
    const quoteFresh = status === "CLOSED" || !marketOpen || quoteUpdatedAt >= Date.now() - 7 * 60 * 1000;
    const currentPrice = quoteFresh ? nullableNumber(row.current_price) : null;
    const postEntryNextBarPolicy = usesPostEntryNextBarTrail(ledgerDateText(row.bought_on), usesStrongSwingPostEntryTrail(row));
    const direction = ledgerTradeDirection(row);
    const followUp = String(row.status) === "OPEN" && usesStrategyFollowUp(String(row.strategy_key), ledgerDateText(row.bought_on))
      ? strategyFollowUp(String(row.strategy_key), followUpBars.get(String(row.asset_id)) ?? [], ledgerDateText(row.bought_on) ?? "", market === "IN" ? 0.05 : 0.01, direction)
      : null;
    const gttProtection = calculateRecommendedGttStop({
      buyPrice,
      projectedStop: Number(row.projected_stop),
      // Strategy EMA/SMA lines are close-confirmed exits, not intraday broker stops. The
      // frozen catastrophic/ATR protection remains the live GTT until a completed close exits.
      projectedTrailingStop: nullableNumber(row.projected_trailing_stop),
      trailingDistance: nullableNumber(row.trailing_distance),
      highestHigh: nullableNumber(row.highest_high),
      currentPrice,
      postEntryCompletedHigh: nullableNumber(row.post_entry_completed_high),
      postEntryNextBarPolicy,
      direction,
    });
    const recommendedGttStop = gttProtection.recommendedStop;
    const recordedGttStop = nullableNumber(row.current_gtt_stop) ?? Number(row.projected_stop);
    const effectiveTrailingStop = direction === "LONG"
      ? Math.max(recommendedGttStop, recordedGttStop)
      : Math.min(recommendedGttStop, recordedGttStop);
    const breakEvenActivated = gttProtection.breakEvenActivated;
    const gttUpdateRequired = status === "OPEN" && (direction === "LONG"
      ? recommendedGttStop > recordedGttStop + 0.005
      : recommendedGttStop < recordedGttStop - 0.005);
    const priorClose = nullableNumber(row.prior_close);
    const twoSessionClose = nullableNumber(row.two_session_close);
    const stockMove1dPct = currentPrice !== null && priorClose !== null && priorClose > 0
      ? ((currentPrice / priorClose) - 1) * 100
      : null;
    const stockMove2dPct = currentPrice !== null && twoSessionClose !== null && twoSessionClose > 0
      ? ((currentPrice / twoSessionClose) - 1) * 100
      : null;
    const trade = {
      id: String(row.id), assetId: String(row.asset_id), ticker: String(row.ticker),
      assetName: row.asset_name === null ? null : String(row.asset_name),
      exchange: row.exchange === null ? null : String(row.exchange), market,
      status, boughtOn, buyPrice, purchaseValue, quantity, soldQuantity, remainingQuantity, realizedPnlValue, exits,
      currency: String(row.currency), strategyKey: String(row.strategy_key),
      strategyLabel: String(row.strategy_label),
      signalVerdict: row.signal_verdict === null ? null : String(row.signal_verdict),
      signalAsOf: dateText(row.signal_as_of), signalScore: nullableNumber(row.signal_score),
      projectionEntry: nullableNumber(row.projection_entry), projectedTarget: Number(row.projected_target),
      projectedStop: Number(row.projected_stop), projectedTrailingStop: nullableNumber(row.projected_trailing_stop),
      effectiveTrailingStop, recordedGttStop, recommendedGttStop,
      gttUpdatedAt: row.gtt_updated_at instanceof Date
        ? row.gtt_updated_at.toISOString()
        : row.gtt_updated_at ? String(row.gtt_updated_at) : null,
      gttUpdateRequired, breakEvenActivated,
      strategyExitLine: followUp?.line ?? null,
      strategyExitLabel: followUp?.lineLabel ?? null,
      strategyTarget: followUp?.target ?? null,
      strategyCloseExitConfirmed: followUp?.closeExitConfirmed ?? false,
      scaleOutTarget: null as number | null,
      scaleOutPlannedQuantity: 0,
      scaleOutRemainingQuantity: 0,
      expectedHoldingDays: Number(row.expected_holding_days),
      currentPrice,
      quoteAsOf: dateText(row.quote_as_of),
      quoteUpdatedAt: row.quote_updated_at instanceof Date
        ? row.quote_updated_at.toISOString()
        : row.quote_updated_at ? String(row.quote_updated_at) : null,
      closedOn: dateText(row.closed_on),
      exitPrice: legacyExitPrice, closeReason: row.close_reason === null ? null : String(row.close_reason),
      notes: row.notes === null ? null : String(row.notes),
    };
    const scaleOutFraction = ledgerScaleOutFraction(row);
    trade.scaleOutTarget = scaleOutFraction > 0 ? strategyFollowUpTarget(direction, buyPrice, trade.projectedTarget, followUp?.target ?? null) : null;
    trade.scaleOutPlannedQuantity = quantity * scaleOutFraction;
    trade.scaleOutRemainingQuantity = Math.max(0, trade.scaleOutPlannedQuantity - soldQuantity);
    const progress = calculateSwingTradeProgress({
      status, boughtOn, buyPrice: trade.buyPrice,
      quantity: status === "OPEN" ? trade.remainingQuantity : trade.quantity,
      // A reversion trade's objective is the mean as it stands now, never above the frozen target.
      currentPrice, target: strategyFollowUpTarget(direction, buyPrice, trade.projectedTarget, followUp?.target ?? null),
      stop: trade.projectedStop,
      trailingStop: effectiveTrailingStop, expectedDays: trade.expectedHoldingDays,
      exitPrice: trade.exitPrice, asOf: trade.closedOn ?? undefined,
      market,
    });
    const relevantImpacts = impacts.filter((impact) =>
      impact.scope === "MARKET"
      || (impact.scope === "ASSET" && impact.asset_id === trade.assetId),
    );
    const newsScore = scoreNewsSwing(trade.signalScore ?? 50, relevantImpacts.map((impact) => ({
      direction: impact.direction as NewsDirection,
      sentimentScore: Number(impact.sentimentScore),
      confidence: Number(impact.confidence),
      severity: Number(impact.severity),
      publishedAt: new Date(impact.published_at).toISOString(),
      scope: impact.scope as NewsScope,
    })));
    const assetImpacts = relevantImpacts.filter((impact) => impact.scope === "ASSET" && impact.asset_id === trade.assetId);
    const assetNewsScore = scoreNewsSwing(trade.signalScore ?? 50, assetImpacts.map((impact) => ({
      direction: impact.direction as NewsDirection,
      sentimentScore: Number(impact.sentimentScore), confidence: Number(impact.confidence),
      severity: Number(impact.severity), publishedAt: new Date(impact.published_at).toISOString(),
      scope: "ASSET" as const,
    })));
    const distanceToStopPct = currentPrice && effectiveTrailingStop !== null
      ? ((currentPrice / effectiveTrailingStop) - 1) * 100
      : currentPrice ? ((currentPrice / trade.projectedStop) - 1) * 100 : null;
    const assessment = assessTradeRisk({
      tradeState: progress.state,
      pnlPct: progress.pnlPct,
      distanceToStopPct,
      marketMove1dPct,
      marketMove2dPct,
      stockMove1dPct,
      stockMove2dPct,
      newsScore,
      assetNewsScore,
      assetNewsVerified: assetImpacts.some((impact) => impact.verified_evidence),
      newsFresh,
    });
    const revisedPlan = reviseSwingTradePlan({
      status,
      currentPrice,
      buyPrice,
      originalTarget: trade.projectedTarget,
      originalStop: trade.projectedStop,
      effectiveTrailingStop,
      atr: nullableNumber(row.current_atr) ?? nullableNumber(row.projected_atr),
      highestHighSinceEntry: nullableNumber(row.highest_high),
      lowestLowSinceEntry: nullableNumber(row.lowest_low),
      stockMove1dPct,
      stockMove2dPct,
      soldQuantity,
      remainingQuantity,
      holdingWindowExpired: progress.state === "WINDOW_EXPIRED",
      externalExitRisk: assessment.recommendation === "EXIT"
        && assessment.reasons.some((reason) => !reason.startsWith("The recorded strategy target has been reached")),
      externalExitReasons: assessment.recommendation === "EXIT"
        ? assessment.reasons.filter((reason) => !reason.startsWith("The recorded strategy target has been reached"))
        : [],
      recoveryTarget: recoveryTargets.get(trade.id)?.recoveryTarget ?? null,
      historicalTarget: recoveryTargets.get(trade.id)?.historicalTarget ?? null,
      historicalSampleSize: recoveryTargets.get(trade.id)?.sampleSize ?? 0,
      historicalHorizon: recoveryTargets.get(trade.id)?.horizon ?? 0,
    });
    return {
      ...trade,
      progress,
      revisedPlan,
      risk: {
        ...assessment,
        newsAdjustment: newsScore.newsAdjustment,
        marketMove1dPct,
        marketMove2dPct,
        stockMove1dPct,
        stockMove2dPct,
        newsAsOf,
        evidence: [...assetImpacts, ...relevantImpacts.filter((impact) => impact.scope !== "ASSET")].slice(0, 3).map((impact) => ({
          title: impact.title,
          url: impact.url,
          direction: impact.direction as NewsDirection,
          rationale: impact.rationale,
          publishedAt: new Date(impact.published_at).toISOString(),
        })),
      },
    };
  });
}
