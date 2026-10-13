"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { tx } from "@/lib/db";
import { zonedMarketClock } from "@/lib/market-calendar.mjs";
import { ARMED_PLAN_MAX_AGE_MINUTES, loadArmedPlan, validatePlanForPendingOrder } from "@/lib/armedSwingPlans";
import { DEFAULT_ORDER_VALIDITY_DAYS, nextOrderState, validatePendingFill } from "@/lib/swingPendingOrders";
import { validateShareQuantity } from "@/lib/tradeInput";

const validMarket = (value: string): "IN" | "US" => value === "US" ? "US" : "IN";
const num = (formData: FormData, key: string): number | null => {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

const addDays = (isoDate: string, days: number) => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/**
 * Record an unfilled Armed Swing buy-stop. Only the plan id and quantity come from the browser;
 * every level is copied from the server-held ARMED plan. Creates no position, capital or P&L.
 */
export async function createPendingBuyStop(formData: FormData) {
  const user = await requireUser();
  const market = validMarket(String(formData.get("market") ?? "IN"));
  const planId = String(formData.get("planId") ?? "").trim();
  const quantity = num(formData, "quantity");
  if (!quantity || quantity <= 0) throw new Error("Enter the order quantity");
  validateShareQuantity(market, quantity);
  const today = zonedMarketClock(market).date;
  const plan = await loadArmedPlan(user.id, planId);
  const planError = validatePlanForPendingOrder(plan, { today, nowMs: Date.now(), market });
  if (planError || !plan) throw new Error(planError ?? "Armed Swing plan was not found");

  let inserted = 0;
  try {
    const result = await tx((client) => client.query(
      `insert into public.swing_pending_orders
         (user_id,asset_id,market,plan_id,strategy_key,strategy_label,quantity,trigger_price,limit_price,
          projected_target,projected_stop,projected_trailing_stop,projected_atr,trailing_distance,
          expected_holding_days,signal_as_of,signal_score,projection_snapshot,placed_on,valid_until)
       select p.user_id,p.asset_id,p.market,p.id,'ARMED_SWING','Armed Strong Swing',$3,p.trigger_price,p.limit_price,
              p.projected_target,p.projected_stop,p.projected_trailing_stop,p.projected_atr,p.trailing_distance,
              p.expected_holding_days,p.latest_bar_date,p.strength_score/100,
              jsonb_build_object('planId',p.id,'orderType','BUY_STOP_LIMIT','gates',p.gates),$4::date,$5::date
         from public.armed_swing_plans p
        where p.id=$1 and p.user_id=$2 and p.status='ARMED' and p.session_date=$4::date
          and p.captured_at > now() - make_interval(mins => $6)`,
      [plan.id, user.id, quantity, today, addDays(today, DEFAULT_ORDER_VALIDITY_DAYS), ARMED_PLAN_MAX_AGE_MINUTES],
    ));
    inserted = result.rowCount ?? 0;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new Error("A pending buy-stop already exists for this stock");
    throw error;
  }
  // The INSERT … SELECT re-checks the plan; if it no longer qualifies nothing is written, and
  // that must surface as a failure rather than a success redirect.
  if (inserted !== 1) throw new Error("The Armed plan no longer qualifies; reload the Armed Swing page");
  revalidatePath(`/terminal/${market.toLowerCase()}/trade-ledger`);
  redirect(`/terminal/${market.toLowerCase()}/trade-ledger?pending=1`);
}

/**
 * Record one confirmed fill inside [trigger, limit]. Each fill becomes its own purchased ledger
 * trade at its own price; the order stays PENDING with the remainder until fully filled.
 */
export async function fillPendingBuyStop(formData: FormData) {
  const user = await requireUser();
  const market = validMarket(String(formData.get("market") ?? "IN"));
  const orderId = String(formData.get("orderId") ?? "").trim();
  const fillPrice = num(formData, "fillPrice") ?? 0;
  const fillQuantity = num(formData, "fillQuantity") ?? 0;
  const filledOn = String(formData.get("filledOn") ?? "").slice(0, 10);
  validateShareQuantity(market, fillQuantity);
  const today = zonedMarketClock(market).date;

  await tx(async (client) => {
    const result = await client.query<{
      asset_id: string; quantity: string; filled_quantity: string; trigger_price: string; limit_price: string;
      placed_on: string; valid_until: string; strategy_key: string; strategy_label: string; projected_target: string;
      projected_stop: string; projected_trailing_stop: string | null; projected_atr: string | null;
      trailing_distance: string | null; expected_holding_days: number; signal_as_of: string | null;
      signal_score: string | null; projection_snapshot: unknown; currency: string;
    }>(
      `select o.asset_id,o.quantity::text,o.filled_quantity::text,o.trigger_price::text,o.limit_price::text,
              o.placed_on::text,o.valid_until::text,o.strategy_key,o.strategy_label,o.projected_target::text,
              o.projected_stop::text,o.projected_trailing_stop::text,o.projected_atr::text,o.trailing_distance::text,
              o.expected_holding_days,o.signal_as_of::text,o.signal_score::text,o.projection_snapshot,a.currency
         from public.swing_pending_orders o join public.assets a on a.id=o.asset_id
        where o.id=$1 and o.user_id=$2 and o.market=$3 and o.status='PENDING'
        for update of o`,
      [orderId, user.id, market],
    );
    const order = result.rows[0];
    if (!order) throw new Error("Pending order was not found");
    const ordered = Number(order.quantity);
    const alreadyFilled = Number(order.filled_quantity);
    const fillError = validatePendingFill({
      trigger: Number(order.trigger_price), limit: Number(order.limit_price),
      remainingQuantity: ordered - alreadyFilled, fillPrice, fillQuantity,
      placedOn: order.placed_on, validUntil: order.valid_until, filledOn, today,
    });
    if (fillError) throw new Error(fillError);
    const inserted = await client.query<{ id: string }>(
      `insert into public.swing_trade_ledger
         (user_id,asset_id,market,status,bought_on,buy_price,quantity,currency,strategy_key,strategy_label,
          signal_verdict,signal_as_of,signal_score,projection_entry,projected_target,projected_stop,
          projected_trailing_stop,projected_atr,trailing_distance,expected_holding_days,projection_snapshot,purchase_value)
       values ($1,$2,$3,'OPEN',$4,$5,$6,$7,$8,$9,'ARMED_BUY_STOP',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,
               $5::numeric*$6::numeric)
       returning id`,
      [user.id, order.asset_id, market, filledOn, fillPrice, fillQuantity, order.currency, order.strategy_key,
        order.strategy_label, order.signal_as_of, order.signal_score, order.trigger_price, order.projected_target,
        order.projected_stop, order.projected_trailing_stop, order.projected_atr, order.trailing_distance,
        order.expected_holding_days, JSON.stringify({ ...(order.projection_snapshot as object), pendingOrderId: orderId })],
    );
    await client.query(
      `insert into public.swing_pending_order_fills (order_id,user_id,trade_id,filled_on,fill_price,quantity)
       values ($1,$2,$3,$4,$5,$6)`,
      [orderId, user.id, inserted.rows[0].id, filledOn, fillPrice, fillQuantity],
    );
    const next = nextOrderState(ordered, alreadyFilled, fillQuantity);
    await client.query(
      `update public.swing_pending_orders set filled_quantity=$1,status=$2,updated_at=now()
        where id=$3 and user_id=$4`,
      [next.filledQuantity, next.status, orderId, user.id],
    );
  });
  revalidatePath(`/terminal/${market.toLowerCase()}/trade-ledger`);
  redirect(`/terminal/${market.toLowerCase()}/trade-ledger?filled=1`);
}

/** Cancel the unfilled remainder. Earlier partial fills stay as their own ledger trades. */
export async function cancelPendingBuyStop(formData: FormData) {
  const user = await requireUser();
  const market = validMarket(String(formData.get("market") ?? "IN"));
  const orderId = String(formData.get("orderId") ?? "").trim();
  await tx((client) => client.query(
    `update public.swing_pending_orders set status='CANCELLED',updated_at=now()
      where id=$1 and user_id=$2 and market=$3 and status='PENDING'`,
    [orderId, user.id, market],
  ));
  revalidatePath(`/terminal/${market.toLowerCase()}/trade-ledger`);
}
