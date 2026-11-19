// Turn the newer engines' server-produced candidates into frozen forward-test
// calls. Each call is a resting buy order at the engine's own entry, with the
// engine's own target and stop — nothing is recalculated here.

export const ENGINE_METHODS = {
  STRONG_SWING: "ENGINE:STRONG_SWING",
  MOMENTUM_IGNITION: "ENGINE:MOMENTUM_IGNITION",
  MOMENTUM_IGNITION_V2: "ENGINE:MOMENTUM_IGNITION_V2",
  TREND_CONTINUATION: "ENGINE:TREND_CONTINUATION",
  TREND_DAY_TWO: "ENGINE:TREND_DAY_TWO",
  TREND_DAY_TWO_WATCH: "ENGINE:TREND_DAY_TWO_WATCH",
  ARMED_SWING: "ENGINE:ARMED_SWING",
} as const;

/** Statuses at which the engine would have a trader place (or hold) an entry order. */
export const ENROLLABLE_STATUSES: Record<keyof typeof ENGINE_METHODS, readonly string[]> = {
  STRONG_SWING: ["EXECUTION_READY", "WAIT_FOR_ENTRY"],
  MOMENTUM_IGNITION: ["ENTRY_READY", "BREAKOUT_TRIGGERED"],
  MOMENTUM_IGNITION_V2: ["MOMENTUM_READY", "RETEST_SETUP"],
  TREND_CONTINUATION: ["TREND_CONTINUATION_READY"],
  // The second-day staircase: entries that pass every gate, and (paper only) the
  // ones held back, so the gates themselves are tested against what happens next.
  TREND_DAY_TWO: ["TREND_CONTINUATION_READY"],
  TREND_DAY_TWO_WATCH: ["IMPULSE_DETECTED"],
  ARMED_SWING: ["ARMED", "BUY_ZONE", "TRIGGERED_UNCONFIRMED"],
};

export interface EngineCall {
  method: string;
  assetId: string;
  ticker: string;
  status: string;
  entry: number;
  target: number;
  stop: number;
  horizonDays: number;
}

export interface EngineCandidates {
  strong: Array<{ assetId: string; ticker: string; status: string; strongEntry: number; strongTarget: number; strongStop: number; strongExpectedDays: number }>;
  momentum: Array<{ assetId: string; ticker: string; status: string; projectedEntry: number; projectedTarget: number; projectedStop: number; projectedDays: number }>;
  momentumV2: Array<{ assetId: string; ticker: string; status: string; projectedEntry: number; projectedTarget: number; projectedStop: number; projectedDays: number }>;
  trend: Array<{
    assetId: string; ticker: string; status: string; entry: number | null; target: number | null; stop: number | null;
    currentPrice?: number | null; metrics?: Record<string, unknown>;
  }>;
  armed: Array<{ assetId: string; ticker: string; status: string; plan: { trigger: number; target: number; stop: number; expectedDays: number } }>;
}

const DEFAULT_HORIZON_DAYS = 10;
const MAX_HORIZON_DAYS = 30;

function horizon(days: number | null | undefined): number {
  if (!Number.isFinite(days) || !days || days <= 0) return DEFAULT_HORIZON_DAYS;
  return Math.min(MAX_HORIZON_DAYS, Math.max(1, Math.round(days)));
}

const isStaircase = (c: { metrics?: Record<string, unknown> }) => c.metrics?.developing_staircase === true;

/**
 * The first `limit` rows with distinct keys, in the order given. A stock can
 * appear twice in a ranked pool (a repeated strategy tag, two listings of one
 * scan row); without this it took both slots and the second insert was dropped
 * by the database, so fewer distinct stocks were tested than intended.
 */
export function takeDistinct<T>(rows: readonly T[], limit: number, key: (row: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (out.length >= limit) break;
    const id = key(row);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

/** One row per method and stock, keeping the first: what the unique index would keep. */
export function distinctCalls<T extends Record<string, unknown>>(rows: readonly T[]): T[] {
  return takeDistinct(rows, rows.length, (row) => `${row.method}|${row.asset_id}`);
}

/** A long call is gradable only if stop < entry < target. */
export function validLongLevels(entry: number | null, target: number | null, stop: number | null): boolean {
  return [entry, target, stop].every((value) => typeof value === "number" && Number.isFinite(value) && value > 0)
    && stop! < entry! && entry! < target!;
}

/**
 * Pick up to `perMethod` enrollable candidates per engine, in the engine's own
 * ranking order, skipping assets that already have an active call for that method.
 */
export function selectEngineCalls(
  candidates: EngineCandidates,
  perMethod: number,
  active: Set<string> = new Set(),
): EngineCall[] {
  const pools: Array<[keyof typeof ENGINE_METHODS, Array<Omit<EngineCall, "method">>]> = [
    ["STRONG_SWING", candidates.strong.map((c) => ({
      assetId: c.assetId, ticker: c.ticker, status: c.status,
      entry: c.strongEntry, target: c.strongTarget, stop: c.strongStop, horizonDays: horizon(c.strongExpectedDays),
    }))],
    ["MOMENTUM_IGNITION", candidates.momentum.map((c) => ({
      assetId: c.assetId, ticker: c.ticker, status: c.status,
      entry: c.projectedEntry, target: c.projectedTarget, stop: c.projectedStop, horizonDays: horizon(c.projectedDays),
    }))],
    ["MOMENTUM_IGNITION_V2", candidates.momentumV2.map((c) => ({
      assetId: c.assetId, ticker: c.ticker, status: c.status,
      entry: c.projectedEntry, target: c.projectedTarget, stop: c.projectedStop, horizonDays: horizon(c.projectedDays),
    }))],
    ["TREND_CONTINUATION", candidates.trend.filter((c) => !isStaircase(c)).map((c) => ({
      assetId: c.assetId, ticker: c.ticker, status: c.status,
      entry: c.entry ?? NaN, target: c.target ?? NaN, stop: c.stop ?? NaN, horizonDays: DEFAULT_HORIZON_DAYS,
    }))],
    ["TREND_DAY_TWO", candidates.trend.filter(isStaircase).map((c) => ({
      assetId: c.assetId, ticker: c.ticker, status: c.status,
      entry: c.entry ?? NaN, target: c.target ?? NaN, stop: c.stop ?? NaN, horizonDays: DEFAULT_HORIZON_DAYS,
    }))],
    // Held-back staircases have no entry of their own, so the paper call rests at the last price.
    ["TREND_DAY_TWO_WATCH", candidates.trend.filter(isStaircase).map((c) => ({
      assetId: c.assetId, ticker: c.ticker, status: c.status,
      entry: c.currentPrice ?? NaN, target: c.target ?? NaN, stop: c.stop ?? NaN, horizonDays: DEFAULT_HORIZON_DAYS,
    }))],
    ["ARMED_SWING", candidates.armed.map((c) => ({
      assetId: c.assetId, ticker: c.ticker, status: c.status,
      entry: c.plan.trigger, target: c.plan.target, stop: c.plan.stop, horizonDays: horizon(c.plan.expectedDays),
    }))],
  ];

  const calls: EngineCall[] = [];
  for (const [engine, pool] of pools) {
    const method = ENGINE_METHODS[engine];
    const allowed = ENROLLABLE_STATUSES[engine];
    let taken = 0;
    const seen = new Set<string>();
    for (const call of pool) {
      if (taken >= perMethod) break;
      if (!allowed.includes(call.status)) continue;
      if (!validLongLevels(call.entry, call.target, call.stop)) continue;
      if (active.has(`${method}|${call.assetId}`) || seen.has(call.assetId)) continue;
      seen.add(call.assetId);
      calls.push({ method, ...call });
      taken++;
    }
  }
  return calls;
}
