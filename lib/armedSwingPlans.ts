import { createHash } from "node:crypto";
import { query, queryOne } from "@/lib/db";
import type { ArmedSwingCandidate } from "@/lib/armedSwing";

/** Exchange tick rounding tolerance around the trigger and limit. */
const PRICE_TOLERANCE = 0.001;
/** An ARMED plan must be this recent to place a new buy-stop from it. */
export const ARMED_PLAN_MAX_AGE_MINUTES = 30;
const CAPTURED_STATUSES = new Set(["BUY_ZONE", "TRIGGERED_UNCONFIRMED", "ARMED"]);

export interface StoredArmedPlan {
  id: string;
  assetId: string;
  market: "IN" | "US";
  sessionDate: string;
  capturedAt: string;
  status: "BUY_ZONE" | "TRIGGERED_UNCONFIRMED" | "ARMED";
  trigger: number;
  limit: number;
  target: number;
  stop: number;
  trail: number | null;
  atr: number;
  trailingDistance: number | null;
  expectedDays: number;
  latestBarDate: string;
  strengthScore: number;
}

interface PlanContent {
  /** Five-minute capture bucket (ISO). Part of the identity so freshness stays measurable. */
  bucketAt: string;
  market: "IN" | "US";
  assetId: string;
  sessionDate: string;
  status: string;
  currentPrice: number;
  trigger: number;
  limit: number;
  target: number;
  stop: number;
  trail: number | null;
  atr: number;
  trailingDistance: number;
  expectedDays: number;
  latestBarDate: string;
  strengthScore: number;
  gates: unknown;
}

/**
 * Identity of one complete calculation. Any change to status, price, a level, the score or a
 * gate produces a different hash and therefore a new, separately addressable plan version.
 */
export function captureBucket(at: Date): string {
  const bucket = new Date(at);
  bucket.setUTCSeconds(0, 0);
  bucket.setUTCMinutes(bucket.getUTCMinutes() - (bucket.getUTCMinutes() % 5));
  return bucket.toISOString();
}

export function armedPlanHash(plan: PlanContent): string {
  const canonical = JSON.stringify([
    plan.bucketAt, plan.market, plan.assetId, plan.sessionDate, plan.status, plan.currentPrice, plan.trigger, plan.limit,
    plan.target, plan.stop, plan.trail, plan.atr, plan.trailingDistance, plan.expectedDays,
    plan.latestBarDate, plan.strengthScore, plan.gates,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Record the server-computed plan for every actionable candidate shown to this user, as
 * immutable versions. An identical recalculation reuses its existing row; anything different
 * becomes a new row. Rows are never updated, so an action holding a plan id executes against
 * exactly the plan that was displayed with it.
 */
export async function captureArmedSwingPlans(
  userId: string,
  market: "IN" | "US",
  sessionDate: string,
  candidates: readonly ArmedSwingCandidate[],
  trailAtrMult: number,
): Promise<Map<string, string>> {
  const actionable = candidates.filter((candidate) => CAPTURED_STATUSES.has(candidate.status));
  if (!actionable.length) return new Map();
  const bucketAt = captureBucket(new Date());
  const payload = actionable.map((candidate) => {
    const content: PlanContent = {
      bucketAt,
      market,
      assetId: candidate.assetId,
      sessionDate,
      status: candidate.status,
      currentPrice: candidate.currentPrice,
      trigger: candidate.plan.trigger,
      limit: candidate.plan.limit,
      target: candidate.plan.target,
      stop: candidate.plan.stop,
      trail: candidate.plan.trail,
      atr: candidate.atr,
      trailingDistance: trailAtrMult * candidate.atr,
      expectedDays: candidate.plan.expectedDays,
      latestBarDate: candidate.latestDate,
      strengthScore: candidate.strengthScore,
      gates: candidate.gates,
    };
    return { ...content, planHash: armedPlanHash(content) };
  });
  const rows = await query<{ id: string; asset_id: string }>(
    `with incoming as (
       select p.* from jsonb_to_recordset($4::jsonb) p(
         "assetId" uuid, "planHash" text, "bucketAt" timestamptz, status text, "currentPrice" numeric, trigger numeric, "limit" numeric,
         target numeric, stop numeric, trail numeric, atr numeric, "trailingDistance" numeric,
         "expectedDays" integer, "latestBarDate" date, "strengthScore" numeric, gates jsonb)
     ), inserted as (
       insert into public.armed_swing_plans
         (user_id,market,asset_id,session_date,bucket_at,plan_hash,status,current_price,trigger_price,limit_price,
          projected_target,projected_stop,projected_trailing_stop,projected_atr,trailing_distance,
          expected_holding_days,latest_bar_date,strength_score,gates)
       select $1,$2,i."assetId",$3::date,i."bucketAt",i."planHash",i.status,i."currentPrice",i.trigger,i."limit",i.target,
              i.stop,i.trail,i.atr,i."trailingDistance",i."expectedDays",i."latestBarDate",i."strengthScore",i.gates
         from incoming i
       on conflict (user_id,asset_id,plan_hash) do nothing
       returning id,asset_id,plan_hash
     )
     select id,asset_id from inserted
     union all
     select p.id,p.asset_id
       from public.armed_swing_plans p
       join incoming i on i."assetId"=p.asset_id and i."planHash"=p.plan_hash
      where p.user_id=$1
        and not exists (select 1 from inserted n where n.asset_id=p.asset_id and n.plan_hash=p.plan_hash)`,
    [userId, market, sessionDate, JSON.stringify(payload)],
  );
  if (Math.random() < 0.02) {
    await query(
      `delete from public.armed_swing_plans p
        where p.captured_at < now() - interval '45 days'
          and not exists (select 1 from public.swing_pending_orders o where o.plan_id=p.id)`,
    );
  }
  return new Map(rows.map((row) => [row.asset_id, row.id]));
}

export async function loadArmedPlan(userId: string, planId: string): Promise<StoredArmedPlan | null> {
  if (!/^[0-9a-f-]{36}$/i.test(planId)) return null;
  const row = await queryOne<{
    id: string; asset_id: string; market: "IN" | "US"; session_date: string; captured_at: string;
    status: StoredArmedPlan["status"]; trigger_price: string; limit_price: string; projected_target: string;
    projected_stop: string; projected_trailing_stop: string | null; projected_atr: string;
    trailing_distance: string | null; expected_holding_days: number; latest_bar_date: string; strength_score: string;
  }>(
    `select id,asset_id,market,session_date::text,to_json(captured_at)#>>'{}' captured_at,status,trigger_price::text,limit_price::text,
            projected_target::text,projected_stop::text,projected_trailing_stop::text,projected_atr::text,
            trailing_distance::text,expected_holding_days,latest_bar_date::text,strength_score::text
       from public.armed_swing_plans where id=$1 and user_id=$2`,
    [planId, userId],
  );
  if (!row) return null;
  const nullable = (value: string | null) => value === null ? null : Number(value);
  return {
    id: row.id, assetId: row.asset_id, market: row.market, sessionDate: row.session_date,
    capturedAt: row.captured_at, status: row.status,
    trigger: Number(row.trigger_price), limit: Number(row.limit_price), target: Number(row.projected_target),
    stop: Number(row.projected_stop), trail: nullable(row.projected_trailing_stop), atr: Number(row.projected_atr),
    trailingDistance: nullable(row.trailing_distance), expectedDays: row.expected_holding_days,
    latestBarDate: row.latest_bar_date, strengthScore: Number(row.strength_score),
  };
}

/** A buy-stop may be recorded only from a recent ARMED plan of the current session. */
export function validatePlanForPendingOrder(
  plan: StoredArmedPlan | null,
  context: { today: string; nowMs: number; market: "IN" | "US" },
): string | null {
  if (!plan) return "Armed Swing plan was not found; reload the Armed Swing page";
  if (plan.market !== context.market) return "The plan belongs to a different market";
  if (plan.status !== "ARMED") return "Only an ARMED setup can be recorded as a pending buy-stop";
  if (plan.sessionDate !== context.today) return "The plan is from an earlier session; reload the Armed Swing page";
  if (context.nowMs - Date.parse(plan.capturedAt) > ARMED_PLAN_MAX_AGE_MINUTES * 60_000) {
    return `The plan is more than ${ARMED_PLAN_MAX_AGE_MINUTES} minutes old; reload the Armed Swing page`;
  }
  return null;
}

/**
 * A direct Armed purchase is valid only against a BUY_ZONE plan of the same session, at a price
 * the breakout could actually have filled: at or above the trigger and not above the limit.
 */
export function validatePlanForPurchase(
  plan: StoredArmedPlan | null,
  purchase: { assetId: string; market: "IN" | "US"; boughtOn: string; buyPrice: number },
): string | null {
  if (!plan) return "Armed Swing plan was not found; buy from a Buy zone card";
  if (plan.assetId !== purchase.assetId || plan.market !== purchase.market) return "The plan does not match this stock";
  if (plan.status !== "BUY_ZONE") return "Only a Buy zone setup can be recorded as an Armed Swing purchase";
  if (purchase.boughtOn !== plan.sessionDate) return `The purchase date must be the plan's session, ${plan.sessionDate}`;
  if (purchase.buyPrice < plan.trigger * (1 - PRICE_TOLERANCE)) {
    return `An Armed Swing purchase must be at or above the ${plan.trigger.toFixed(2)} trigger`;
  }
  if (purchase.buyPrice > plan.limit * (1 + PRICE_TOLERANCE)) {
    return `An Armed Swing purchase above the ${plan.limit.toFixed(2)} limit is outside the plan`;
  }
  return null;
}

/** Edits cannot move an Armed Swing purchase below the trigger stored when it was created. */
export function armedEditViolation(strategyKey: string | null, projectionEntry: number | null, buyPrice: number): string | null {
  if (strategyKey !== "ARMED_SWING") return null;
  if (projectionEntry === null || buyPrice < projectionEntry * (1 - PRICE_TOLERANCE)) {
    return "An Armed Swing purchase cannot be edited below its recorded trigger";
  }
  return null;
}
