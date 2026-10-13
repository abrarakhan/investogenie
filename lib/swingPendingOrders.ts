import { query } from "@/lib/db";
import { zonedMarketClock } from "@/lib/market-calendar.mjs";

/** Fill-price tolerance for exchange tick rounding around the trigger and limit. */
const FILL_TOLERANCE = 0.001;
export const DEFAULT_ORDER_VALIDITY_DAYS = 7;

/**
 * A buy-stop limit can only fill at or above its trigger and never above its limit. A fill
 * outside that band means the order did not execute as planned and must not become a trade.
 */
export function validatePendingFill(input: {
  trigger: number; limit: number; remainingQuantity: number;
  fillPrice: number; fillQuantity: number;
  placedOn: string; validUntil: string; filledOn: string; today: string;
}): string | null {
  if (!(input.fillPrice > 0) || !(input.fillQuantity > 0)) return "Fill price and quantity must be greater than zero";
  if (input.fillQuantity > input.remainingQuantity + 1e-6) {
    return `The fill quantity cannot exceed the ${input.remainingQuantity} unfilled shares`;
  }
  if (input.fillPrice < input.trigger * (1 - FILL_TOLERANCE)) {
    return `A buy-stop cannot fill below its ${input.trigger.toFixed(2)} trigger; the order has not executed`;
  }
  if (input.fillPrice > input.limit * (1 + FILL_TOLERANCE)) {
    return `A buy-stop limit cannot fill above its ${input.limit.toFixed(2)} limit`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.filledOn) || input.filledOn < input.placedOn || input.filledOn > input.today) {
    return "The fill date must be between the order date and today";
  }
  if (input.filledOn > input.validUntil) return "The order had expired before that fill date";
  return null;
}

/** After a fill the order stays PENDING with its remainder; it is FILLED only when complete. */
export function nextOrderState(ordered: number, alreadyFilled: number, fillQuantity: number): {
  filledQuantity: number; status: "PENDING" | "FILLED";
} {
  const filledQuantity = alreadyFilled + fillQuantity;
  // Snap float residue so a complete fill satisfies the filled_quantity = quantity constraint.
  if (filledQuantity >= ordered - 1e-6) return { filledQuantity: ordered, status: "FILLED" };
  return { filledQuantity, status: "PENDING" };
}

export interface PendingOrder {
  id: string;
  assetId: string;
  ticker: string;
  market: "IN" | "US";
  strategyLabel: string;
  quantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  trigger: number;
  limit: number;
  target: number;
  stop: number;
  trail: number | null;
  expectedDays: number;
  placedOn: string;
  validUntil: string;
  expired: boolean;
  currentPrice: number | null;
  /** The latest quote has reached the trigger: the order may have filled. */
  triggerReached: boolean;
}

export async function getPendingOrders(userId: string, market: "IN" | "US"): Promise<PendingOrder[]> {
  const today = zonedMarketClock(market).date;
  const rows = await query<{
    id: string; asset_id: string; ticker: string; strategy_label: string; quantity: string; filled_quantity: string;
    trigger_price: string; limit_price: string; projected_target: string; projected_stop: string;
    projected_trailing_stop: string | null; expected_holding_days: number;
    placed_on: string; valid_until: string; current_price: string | null;
  }>(
    `select o.id,o.asset_id,a.ticker,o.strategy_label,o.quantity::text,o.filled_quantity::text,o.trigger_price::text,o.limit_price::text,
            o.projected_target::text,o.projected_stop::text,o.projected_trailing_stop::text,o.expected_holding_days,
            o.placed_on::text,o.valid_until::text,q.price::text current_price
       from public.swing_pending_orders o
       join public.assets a on a.id=o.asset_id
       left join public.latest_quotes q on q.asset_id=o.asset_id
      where o.user_id=$1 and o.market=$2 and o.status='PENDING'
      order by o.placed_on desc,o.created_at desc`,
    [userId, market],
  ).catch((error) => {
    if ((error as { code?: string }).code === "42P01") return [];
    throw error;
  });
  return rows.map((row) => {
    const currentPrice = row.current_price === null ? null : Number(row.current_price);
    const trigger = Number(row.trigger_price);
    return {
      id: row.id,
      assetId: row.asset_id,
      ticker: row.ticker,
      market,
      strategyLabel: row.strategy_label,
      quantity: Number(row.quantity),
      filledQuantity: Number(row.filled_quantity),
      remainingQuantity: Number(row.quantity) - Number(row.filled_quantity),
      trigger,
      limit: Number(row.limit_price),
      target: Number(row.projected_target),
      stop: Number(row.projected_stop),
      trail: row.projected_trailing_stop === null ? null : Number(row.projected_trailing_stop),
      expectedDays: row.expected_holding_days,
      placedOn: row.placed_on,
      validUntil: row.valid_until,
      expired: row.valid_until < today,
      currentPrice,
      triggerReached: currentPrice !== null && currentPrice >= trigger,
    };
  });
}
