import { query } from "@/lib/db";
import { scoreNewsSwing, type NewsDirection, type NewsScope } from "@/lib/analytics/newsSwing";
import { assessTradeRisk, type TradeRiskAssessment, type TradeRiskState } from "@/lib/analytics/tradeRisk";

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
  quantity: number;
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
  closedOn: string | null;
  exitPrice: number | null;
  closeReason: string | null;
  notes: string | null;
  progress: SwingTradeProgress;
  risk: TradeRiskAssessment & {
    state: TradeRiskState;
    newsAdjustment: number;
    marketMove1dPct: number | null;
    marketMove2dPct: number | null;
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

type LedgerValue = string | number | Date | null;
type LedgerRow = Record<string, LedgerValue>;
const dateText = (value: LedgerValue) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};
const nullableNumber = (value: LedgerValue) => value === null ? null : Number(value);

export async function getSwingTradeLedger(userId: string, market: "IN" | "US"): Promise<SwingLedgerTrade[]> {
  const rows = await query<LedgerRow>(
    `select l.*, a.ticker, a.name asset_name, a.exchange, a.sector asset_sector,
            q.price current_price, q.as_of quote_as_of,
            case
              when l.projected_trailing_stop is null then null
              when l.trailing_distance is null or path.highest_high is null then l.projected_trailing_stop
              else greatest(l.projected_trailing_stop, path.highest_high - l.trailing_distance)
            end effective_trailing_stop
       from public.swing_trade_ledger l
       join public.assets a on a.id = l.asset_id
       left join public.latest_quotes q on q.asset_id = l.asset_id
       left join lateral (
         select max(d.high) highest_high
           from public.daily_ohlcv d
          where d.asset_id = l.asset_id
            and d.date >= l.bought_on
            and d.date <= coalesce(l.closed_on, current_date)
       ) path on true
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
  };
  const openRows = rows.filter((row) => String(row.status) === "OPEN");
  const assetIds = openRows.map((row) => String(row.asset_id));
  const impacts = assetIds.length ? await query<ImpactRow>(
    `select i.asset_id,i.sector,i.scope,i.direction,i.sentiment_score "sentimentScore",
            i.confidence,i.severity,a.title,a.url,i.rationale,a.published_at
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
  const benchmark = await query<{ price: string | number | null; change_pct: string | number | null; two_session_reference: string | number | null }>(
    `select q.price,q.change_pct,h.two_session_reference
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
  const benchmarkPrice = nullableNumber(benchmark[0]?.price ?? null);
  const marketMove1dPct = nullableNumber(benchmark[0]?.change_pct ?? null);
  const twoSessionReference = nullableNumber(benchmark[0]?.two_session_reference ?? null);
  const marketMove2dPct = benchmarkPrice !== null && twoSessionReference && twoSessionReference > 0
    ? ((benchmarkPrice / twoSessionReference) - 1) * 100
    : null;

  return rows.map((row) => {
    const boughtOn = dateText(row.bought_on) ?? "";
    const status = String(row.status) as "OPEN" | "CLOSED";
    const currentPrice = nullableNumber(row.current_price);
    const effectiveTrailingStop = nullableNumber(row.effective_trailing_stop);
    const trade = {
      id: String(row.id), assetId: String(row.asset_id), ticker: String(row.ticker),
      assetName: row.asset_name === null ? null : String(row.asset_name),
      exchange: row.exchange === null ? null : String(row.exchange), market,
      status, boughtOn, buyPrice: Number(row.buy_price), quantity: Number(row.quantity),
      currency: String(row.currency), strategyKey: String(row.strategy_key),
      strategyLabel: String(row.strategy_label),
      signalVerdict: row.signal_verdict === null ? null : String(row.signal_verdict),
      signalAsOf: dateText(row.signal_as_of), signalScore: nullableNumber(row.signal_score),
      projectionEntry: nullableNumber(row.projection_entry), projectedTarget: Number(row.projected_target),
      projectedStop: Number(row.projected_stop), projectedTrailingStop: nullableNumber(row.projected_trailing_stop),
      effectiveTrailingStop, expectedHoldingDays: Number(row.expected_holding_days),
      currentPrice, quoteAsOf: dateText(row.quote_as_of), closedOn: dateText(row.closed_on),
      exitPrice: nullableNumber(row.exit_price), closeReason: row.close_reason === null ? null : String(row.close_reason),
      notes: row.notes === null ? null : String(row.notes),
    };
    const progress = calculateSwingTradeProgress({
      status, boughtOn, buyPrice: trade.buyPrice, quantity: trade.quantity,
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
    const distanceToStopPct = currentPrice && effectiveTrailingStop !== null
      ? ((currentPrice / effectiveTrailingStop) - 1) * 100
      : currentPrice ? ((currentPrice / trade.projectedStop) - 1) * 100 : null;
    const assessment = assessTradeRisk({
      tradeState: progress.state,
      pnlPct: progress.pnlPct,
      distanceToStopPct,
      marketMove1dPct,
      marketMove2dPct,
      newsScore,
      newsFresh,
    });
    return {
      ...trade,
      progress,
      risk: {
        ...assessment,
        newsAdjustment: newsScore.newsAdjustment,
        marketMove1dPct,
        marketMove2dPct,
        newsAsOf,
        evidence: relevantImpacts.slice(0, 3).map((impact) => ({
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
