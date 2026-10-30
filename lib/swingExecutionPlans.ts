import { createHash } from "node:crypto";
import { query, queryOne } from "@/lib/db";
import { isMomentumExecutionReady } from "@/lib/momentumExecution";
import type { StrongSwingCandidate } from "@/lib/strongSwing";

export type ProtectedSwingStrategy = "STRONG_SWING" | "MOMENTUM_IGNITION";
export const EXECUTION_PLAN_MAX_AGE_MINUTES = 30;

export interface ExecutionPlanInput {
  assetId: string;
  strategyKey: ProtectedSwingStrategy;
  status: string;
  entry: number;
  target: number;
  stop: number;
  trail: number | null;
  atr: number;
  expectedDays: number;
  signalAsOf: string;
  score: number | null;
  snapshot: unknown;
}

export interface StoredExecutionPlan extends ExecutionPlanInput {
  id: string;
  market: "IN" | "US";
  sessionDate: string;
  capturedAt: string;
  trailingDistance: number | null;
}

const hashPlan = (market: "IN" | "US", sessionDate: string, plan: ExecutionPlanInput) =>
  createHash("sha256").update(JSON.stringify([market, sessionDate, plan])).digest("hex");

/**
 * Fail closed before a malformed candidate can abort the whole candidate page.
 * The database repeats the critical constraints; this guard keeps one unsafe
 * plan from preventing every otherwise-valid candidate from rendering.
 */
export function isExecutablePlanGeometry(plan: ExecutionPlanInput): boolean {
  return Number.isFinite(plan.entry) && plan.entry > 0
    && Number.isFinite(plan.target) && plan.target > plan.entry
    && Number.isFinite(plan.stop) && plan.stop >= 0 && plan.stop < plan.entry
    && (plan.trail === null || (Number.isFinite(plan.trail) && plan.trail >= 0 && plan.trail < plan.entry))
    && Number.isFinite(plan.atr) && plan.atr >= 0
    && Number.isInteger(plan.expectedDays) && plan.expectedDays >= 1 && plan.expectedDays <= 365;
}

export async function captureExecutionPlans(
  userId: string,
  market: "IN" | "US",
  sessionDate: string,
  plans: readonly ExecutionPlanInput[],
  trailAtrMult: number,
): Promise<Map<string, string>> {
  const executablePlans = plans.filter(isExecutablePlanGeometry);
  if (!executablePlans.length) return new Map();
  const payload = executablePlans.map((plan) => ({
    ...plan,
    planHash: hashPlan(market, sessionDate, plan),
    trailingDistance: trailAtrMult * plan.atr,
  }));
  const rows = await query<{ id: string; asset_id: string; strategy_key: ProtectedSwingStrategy; status: string }>(
    `with incoming as (
       select p.* from jsonb_to_recordset($4::jsonb) p(
         "assetId" uuid,"strategyKey" text,status text,entry numeric,target numeric,stop numeric,trail numeric,
         atr numeric,"expectedDays" integer,"signalAsOf" date,score numeric,snapshot jsonb,"planHash" text,"trailingDistance" numeric)
     ), inserted as (
       insert into public.swing_execution_plans
         (user_id,asset_id,market,strategy_key,status,session_date,plan_hash,entry_price,projected_target,
          projected_stop,projected_trailing_stop,projected_atr,trailing_distance,expected_holding_days,
          signal_as_of,signal_score,snapshot)
       select $1,i."assetId",$2,i."strategyKey",i.status,$3::date,i."planHash",i.entry,i.target,i.stop,
              i.trail,i.atr,i."trailingDistance",i."expectedDays",i."signalAsOf",i.score,i.snapshot
         from incoming i
       on conflict (user_id,asset_id,strategy_key,plan_hash) do nothing
       returning id,asset_id,strategy_key,status,plan_hash
     )
     select id,asset_id,strategy_key,status from inserted
     union all
     select p.id,p.asset_id,p.strategy_key,p.status from public.swing_execution_plans p
       join incoming i on i."assetId"=p.asset_id and i."strategyKey"=p.strategy_key and i."planHash"=p.plan_hash
      where p.user_id=$1 and not exists (
        select 1 from inserted n where n.asset_id=p.asset_id and n.strategy_key=p.strategy_key and n.plan_hash=p.plan_hash)`,
    [userId, market, sessionDate, JSON.stringify(payload)],
  );
  return new Map(rows.map((row) => [`${row.strategy_key}:${row.status}:${row.asset_id}`, row.id]));
}

export async function loadExecutionPlan(userId: string, planId: string): Promise<StoredExecutionPlan | null> {
  if (!/^[0-9a-f-]{36}$/i.test(planId)) return null;
  const row = await queryOne<Record<string, string | null>>(
    `select id,asset_id,market,strategy_key,status,session_date::text,to_json(captured_at)#>>'{}' captured_at,
            entry_price::text,projected_target::text,projected_stop::text,projected_trailing_stop::text,
            projected_atr::text,trailing_distance::text,expected_holding_days::text,signal_as_of::text,
            signal_score::text,snapshot::text
       from public.swing_execution_plans where id=$1 and user_id=$2`,
    [planId, userId],
  );
  if (!row) return null;
  return {
    id: row.id!, assetId: row.asset_id!, market: row.market as "IN" | "US",
    strategyKey: row.strategy_key as ProtectedSwingStrategy, status: row.status!, sessionDate: row.session_date!,
    capturedAt: row.captured_at!, entry: Number(row.entry_price), target: Number(row.projected_target),
    stop: Number(row.projected_stop), trail: row.projected_trailing_stop === null ? null : Number(row.projected_trailing_stop),
    atr: Number(row.projected_atr), trailingDistance: row.trailing_distance === null ? null : Number(row.trailing_distance),
    expectedDays: Number(row.expected_holding_days), signalAsOf: row.signal_as_of!,
    score: row.signal_score === null ? null : Number(row.signal_score), snapshot: JSON.parse(row.snapshot ?? "{}"),
  };
}

export function validateExecutionPlanPurchase(plan: StoredExecutionPlan | null, input: {
  assetId: string; market: "IN" | "US"; strategyKey: ProtectedSwingStrategy;
  boughtOn: string; buyPrice: number; today: string; nowMs: number;
}): string | null {
  if (!plan) return "Execution plan was not found; buy from the current candidate card";
  if (plan.assetId !== input.assetId || plan.market !== input.market || plan.strategyKey !== input.strategyKey) {
    return "The execution plan does not match this stock and strategy";
  }
  const actionable = plan.strategyKey === "STRONG_SWING"
    ? plan.status === "EXECUTION_READY"
    : plan.status === "ENTRY_READY" || plan.status === "MOMENTUM_READY";
  if (!actionable) return "The stored plan is not execution ready";
  if (plan.sessionDate !== input.today || input.boughtOn !== plan.sessionDate) return "The execution plan is not from today's market session";
  if (input.nowMs - Date.parse(plan.capturedAt) > EXECUTION_PLAN_MAX_AGE_MINUTES * 60_000) return "The execution plan is stale; reload the candidate page";
  if (input.buyPrice < plan.entry * 0.999) return `The purchase must be at or above the ${plan.entry.toFixed(2)} confirmed entry`;
  if (input.buyPrice >= plan.target) return "The purchase price must remain below the frozen target";
  return null;
}

export function protectedExecutionEditViolation(strategyKey: string | null, entry: number | null, buyPrice: number): string | null {
  if (strategyKey !== "STRONG_SWING" && strategyKey !== "MOMENTUM_IGNITION") return null;
  if (entry === null || buyPrice < entry * 0.999) return "A protected strategy purchase cannot be edited below its recorded entry";
  return null;
}

/**
 * Execution plans for EXECUTION_READY Strong Swing candidates. Shared by the web page and the
 * mobile API so both record the identical server-held plan a purchase is validated against.
 */
export function strongSwingExecutionPlanInputs(
  candidates: readonly StrongSwingCandidate[], trailAtrMult: number,
): ExecutionPlanInput[] {
  return candidates.filter((candidate) => candidate.status === "EXECUTION_READY").map((candidate) => ({
    assetId: candidate.assetId, strategyKey: "STRONG_SWING" as const, status: candidate.status,
    entry: candidate.strongEntry, target: candidate.strongTarget, stop: candidate.strongStop,
    trail: candidate.strongTrail, atr: (candidate.strongEntry - candidate.strongTrail) / trailAtrMult,
    expectedDays: candidate.strongExpectedDays,
    signalAsOf: candidate.latestDate, score: candidate.strengthScore / 100, snapshot: { gates: candidate.gates },
  }));
}

/** Momentum Ignition candidates (legacy or V2) whose status allows a purchase. */
export function momentumExecutionPlanInputs(
  candidates: ReadonlyArray<{
    assetId: string; status: string; projectedEntry: number; projectedTarget: number; projectedStop: number;
    projectedTrail: number; atr14: number; projectedDays: number; latestDate: string; score: number; gates: unknown;
  }>,
  model: "LEGACY" | "V2",
): ExecutionPlanInput[] {
  return candidates.filter((candidate) => isMomentumExecutionReady(candidate.status)).map((candidate) => ({
    assetId: candidate.assetId, strategyKey: "MOMENTUM_IGNITION" as const, status: candidate.status,
    entry: candidate.projectedEntry, target: candidate.projectedTarget, stop: candidate.projectedStop,
    trail: candidate.projectedTrail, atr: candidate.atr14, expectedDays: candidate.projectedDays,
    signalAsOf: candidate.latestDate, score: candidate.score / 100, snapshot: { model, gates: candidate.gates },
  }));
}

/** Key under which captureExecutionPlans returns a plan id. */
export const executionPlanKey = (strategyKey: ProtectedSwingStrategy, status: string, assetId: string) =>
  `${strategyKey}:${status}:${assetId}`;
