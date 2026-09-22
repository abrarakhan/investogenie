import { query } from "@/lib/db";
import { scoreNewsSwing, type NewsDirection, type NewsScope } from "@/lib/analytics/newsSwing";
import { assessTradeRisk, type TradeRiskAssessment, type TradeRiskState } from "@/lib/analytics/tradeRisk";
import { reviseSwingTradePlan, type TradePlanRevision } from "@/lib/analytics/tradePlanRevision";
import { isMarketOpenNow, refreshMarketHolidays } from "@/lib/market-calendar.mjs";

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
  currentOpenValue: number;
  roiPct: number | null;
  xirrPct: number | null;
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
  const cashFlows: DatedCashFlow[] = [];
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
    if (trade.boughtOn) cashFlows.push({ date: trade.boughtOn, amount: -purchaseValue });
    for (const exit of trade.exits ?? []) cashFlows.push({ date: exit.soldOn, amount: exit.saleValue });
    if (!(trade.exits?.length) && trade.status === "CLOSED" && trade.closedOn && trade.exitPrice && quantity > 0) {
      cashFlows.push({ date: trade.closedOn, amount: trade.exitPrice * quantity });
    }
    if (trade.status === "OPEN" && currentOpenValue > 0) cashFlows.push({ date: asOf, amount: currentOpenValue });
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
    currentOpenValue: 0,
    roiPct: null,
    xirrPct: null,
  });
  summary.roiPct = summary.totalInvestedValue > 0 ? (summary.overallPnlValue / summary.totalInvestedValue) * 100 : null;
  summary.xirrPct = calculateXirr(cashFlows);
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
export function tradingDaysBetween(from: string, to: string): number {
  const start = utcDate(from);
  const end = utcDate(to);
  if (end <= start) return 0;
  let count = 0;
  const cursor = new Date(start);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor <= end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export function calculateSwingTradeProgress(input: SwingTradeProgressInput): SwingTradeProgress {
  const today = (input.asOf ?? new Date().toISOString()).slice(0, 10);
  const daysHeld = tradingDaysBetween(input.boughtOn, today);
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
  const rows = await query<LedgerRow>(
    `select l.*, a.ticker, a.name asset_name, a.exchange, a.sector asset_sector,
            q.price current_price, q.as_of quote_as_of, q.updated_at quote_updated_at,
            s.atr current_atr,
            stock_path.prior_close, stock_path.two_session_close,
            coalesce(sales.sold_quantity,0) sold_quantity,
            coalesce(sales.realized_proceeds,0) realized_proceeds,
            coalesce(sales.exits,'[]'::jsonb) exits,
            case
              when l.projected_trailing_stop is null then l.projected_stop
              when l.trailing_distance is null or path.highest_high is null
                then greatest(l.projected_stop, l.projected_trailing_stop)
              else greatest(l.projected_stop, l.projected_trailing_stop, path.highest_high - l.trailing_distance)
            end effective_trailing_stop
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
         select max(d.high) highest_high, min(d.low) lowest_low
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
    [userId, market],
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
    const effectiveTrailingStop = nullableNumber(row.effective_trailing_stop);
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
      effectiveTrailingStop, expectedHoldingDays: Number(row.expected_holding_days),
      currentPrice,
      quoteAsOf: dateText(row.quote_as_of),
      quoteUpdatedAt: row.quote_updated_at instanceof Date
        ? row.quote_updated_at.toISOString()
        : row.quote_updated_at ? String(row.quote_updated_at) : null,
      closedOn: dateText(row.closed_on),
      exitPrice: legacyExitPrice, closeReason: row.close_reason === null ? null : String(row.close_reason),
      notes: row.notes === null ? null : String(row.notes),
    };
    const progress = calculateSwingTradeProgress({
      status, boughtOn, buyPrice: trade.buyPrice,
      quantity: status === "OPEN" ? trade.remainingQuantity : trade.quantity,
      currentPrice, target: trade.projectedTarget, stop: trade.projectedStop,
      trailingStop: effectiveTrailingStop, expectedDays: trade.expectedHoldingDays,
      exitPrice: trade.exitPrice, asOf: trade.closedOn ?? undefined,
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
      externalExitRisk: assessment.recommendation === "EXIT"
        && assessment.reasons.some((reason) => !reason.startsWith("The recorded strategy target has been reached")),
      externalExitReasons: assessment.recommendation === "EXIT"
        ? assessment.reasons.filter((reason) => !reason.startsWith("The recorded strategy target has been reached"))
        : [],
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
