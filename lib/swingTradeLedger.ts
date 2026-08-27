import { query } from "@/lib/db";

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
    `select l.*, a.ticker, a.name asset_name, a.exchange,
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

  return rows.map((row) => {
    const boughtOn = dateText(row.bought_on) ?? "";
    const status = String(row.status) as "OPEN" | "CLOSED";
    const currentPrice = nullableNumber(row.current_price);
    const effectiveTrailingStop = nullableNumber(row.effective_trailing_stop);
    const trade: Omit<SwingLedgerTrade, "progress"> = {
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
    return {
      ...trade,
      progress: calculateSwingTradeProgress({
        status, boughtOn, buyPrice: trade.buyPrice, quantity: trade.quantity,
        currentPrice, target: trade.projectedTarget, stop: trade.projectedStop,
        trailingStop: effectiveTrailingStop, expectedDays: trade.expectedHoldingDays,
        exitPrice: trade.exitPrice, asOf: trade.closedOn ?? undefined,
      }),
    };
  });
}
