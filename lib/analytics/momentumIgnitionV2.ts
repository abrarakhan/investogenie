import { assessMomentumIgnition, type MomentumIgnitionAssessment, type MomentumIgnitionInput } from "@/lib/analytics/momentumIgnition";
import type { OHLCV } from "@/lib/types";

export type MomentumIgnitionV2Status =
  | "PRE_IGNITION"
  | "FIRST_THRUST"
  | "RETEST_SETUP"
  | "MOMENTUM_READY"
  | "LATE_PROFIT_BOOKING"
  | "FAILED_BREAKOUT"
  | "NOT_QUALIFIED";

export interface MomentumIgnitionV2Assessment extends Omit<MomentumIgnitionAssessment, "status" | "score" | "qualifies"> {
  legacyStatus: MomentumIgnitionAssessment["status"];
  status: MomentumIgnitionV2Status;
  qualifies: boolean;
  score: number;
  breakoutAgeSessions: number | null;
  breakoutTests10: number;
  return5Pct: number;
  retreatFromHighPct: number;
  resistancePrice: number | null;
  resistanceHeadroomPct: number | null;
  ignitionAccelerationPct: number | null;
  shortHorizonTargetPct: number;
  shortHorizonDays: 1 | 2;
  timingReasons: string[];
}

const pct = (from: number, to: number): number => from > 0 ? ((to / from) - 1) * 100 : 0;

function priorBreakoutEvents(bars: OHLCV[], atr14: number): Array<{ index: number; level: number }> {
  const events: Array<{ index: number; level: number }> = [];
  const start = Math.max(20, bars.length - 10);
  for (let index = start; index < bars.length; index++) {
    const prior = bars.slice(Math.max(0, index - 20), index);
    if (!prior.length) continue;
    const level = Math.max(...prior.map((bar) => bar.high)) + atr14 * 0.1;
    if (bars[index].high >= level && bars[index - 1].close < level) events.push({ index, level });
  }
  return events;
}

function nearestOverheadResistance(bars: OHLCV[], currentPrice: number): number | null {
  const history = bars.slice(Math.max(0, bars.length - 121), -1);
  const swingHighs: number[] = [];
  for (let index = 1; index < history.length - 1; index++) {
    const high = history[index].high;
    if (high > currentPrice * 1.003 && high >= history[index - 1].high && high >= history[index + 1].high) {
      swingHighs.push(high);
    }
  }
  return swingHighs.length ? Math.min(...swingHighs) : null;
}

function breakoutTestClusters(bars: OHLCV[], level: number, atr14: number): number {
  let clusters = 0;
  let inCluster = false;
  for (const bar of bars.slice(-11, -1)) {
    const testing = bar.high >= level - atr14 * 0.25;
    if (testing && !inCluster) clusters++;
    inCluster = testing;
  }
  return clusters;
}

/**
 * One-to-two-session discovery model. This wraps, but never changes, the
 * original Momentum Ignition assessment or any Swing/Strong Swing engine.
 */
export function assessMomentumIgnitionV2(input: MomentumIgnitionInput): MomentumIgnitionV2Assessment {
  const legacy = assessMomentumIgnition(input);
  const bars = input.bars;
  const latest = bars.at(-1) as OHLCV;
  const previous = bars.at(-2) as OHLCV;
  const events = priorBreakoutEvents(bars, legacy.atr14);
  const latestEvent = events.at(-1);
  const breakoutAgeSessions = latestEvent ? bars.length - 1 - latestEvent.index : null;
  const breakoutTests10 = breakoutTestClusters(bars, legacy.breakoutLevel, legacy.atr14);
  const fiveStart = bars.at(-Math.min(6, bars.length)) as OHLCV;
  const return5Pct = pct(fiveStart.close, input.currentPrice);
  const retreatFromHighPct = latest.high > 0 ? Math.max(0, pct(latest.high, input.currentPrice) * -1) : 0;
  const resistancePrice = nearestOverheadResistance(bars, input.currentPrice);
  const resistanceHeadroomPct = resistancePrice === null ? null : pct(input.currentPrice, resistancePrice);
  const ignitionAccelerationPct = legacy.relativeStrength5Pct === null || legacy.relativeStrength20Pct === null
    ? null
    : legacy.relativeStrength5Pct - legacy.relativeStrength20Pct * 0.25;

  const gatePassed = (key: string) => legacy.gates.find((item) => item.key === key)?.passed ?? false;
  const breakoutTriggered = input.currentPrice >= legacy.entryTrigger;
  const freshThrust = breakoutTriggered && previous.close < legacy.entryTrigger && (breakoutAgeSessions ?? 0) <= 1;
  const recentBreakout = latestEvent !== undefined && (breakoutAgeSessions ?? 99) <= 3;
  const retestLevel = latestEvent?.level ?? legacy.breakoutLevel;
  const retestHeld = recentBreakout
    && latest.low <= retestLevel + legacy.atr14 * 0.25
    && input.currentPrice >= retestLevel;
  const enoughHeadroom = resistanceHeadroomPct === null || resistanceHeadroomPct >= 5;
  const earlyRun = return5Pct <= 12;
  const acceleration = (ignitionAccelerationPct ?? Number.NEGATIVE_INFINITY) > 0;
  const strongClose = legacy.closeLocation >= 0.8 && retreatFromHighPct <= 1.25;
  const volumeConfirmed = legacy.projectedVolumeRatio >= 1.5;
  const extensionSafe = legacy.entryExtensionAtr <= 0.3;
  const repeatSafe = breakoutTests10 <= 1;
  const safetyPassed = gatePassed("freshness") && gatePassed("liquidity") && gatePassed("circuit")
    && gatePassed("volatility") && input.currentPrice >= (input.priceFloor ?? 20);
  const structurePassed = gatePassed("trend") && gatePassed("relative_strength");
  const preIgnition = !breakoutTriggered && legacy.distanceToBreakoutPct >= 0
    && legacy.distanceToBreakoutPct <= 3 && structurePassed && safetyPassed;
  const failedBreakout = recentBreakout && input.currentPrice < retestLevel - legacy.atr14 * 0.25;
  const late = breakoutTriggered && (!earlyRun || !enoughHeadroom || !acceleration || !strongClose || !repeatSafe);

  const rawScore =
    (freshThrust || retestHeld ? 25 : preIgnition ? 15 : 0)
    + (enoughHeadroom ? 20 : 0)
    + (volumeConfirmed ? 15 : 0)
    + (strongClose ? 15 : 0)
    + (acceleration ? 10 : 0)
    + (gatePassed("compression") || gatePassed("dry_up") ? 10 : 0)
    + (legacy.marketRegimePositive ? 5 : 0)
    - (breakoutTests10 >= 2 ? 25 : 0)
    - (retreatFromHighPct > 1.5 ? 20 : 0)
    - (!acceleration ? 20 : 0)
    - (!earlyRun ? 20 : 0)
    - (!enoughHeadroom ? 15 : 0);
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  let status: MomentumIgnitionV2Status = "NOT_QUALIFIED";
  if (safetyPassed && structurePassed && failedBreakout) status = "FAILED_BREAKOUT";
  else if (safetyPassed && structurePassed && late) status = "LATE_PROFIT_BOOKING";
  else if (safetyPassed && structurePassed && retestHeld && acceleration && enoughHeadroom && earlyRun) {
    status = volumeConfirmed && strongClose ? "MOMENTUM_READY" : "RETEST_SETUP";
  } else if (safetyPassed && structurePassed && freshThrust && acceleration && enoughHeadroom && earlyRun && repeatSafe) {
    status = volumeConfirmed && strongClose && extensionSafe ? "MOMENTUM_READY" : "FIRST_THRUST";
  } else if (preIgnition) status = "PRE_IGNITION";

  const timingReasons: string[] = [];
  if (!acceleration) timingReasons.push("Relative strength is decelerating.");
  if (!enoughHeadroom && resistancePrice !== null) timingReasons.push(`Only ${resistanceHeadroomPct?.toFixed(1)}% headroom to resistance ${resistancePrice.toFixed(2)}.`);
  if (!earlyRun) timingReasons.push(`The stock has already risen ${return5Pct.toFixed(1)}% over five sessions.`);
  if (!strongClose) timingReasons.push(`Price is ${retreatFromHighPct.toFixed(1)}% below the session high or outside the top 20% of its range.`);
  if (!repeatSafe) timingReasons.push(`${breakoutTests10} recent tests near the breakout increase profit-booking risk.`);
  if (timingReasons.length === 0) {
    timingReasons.push(status === "RETEST_SETUP" ? "The first retest is holding; renewed volume and a strong close are still required."
      : status === "PRE_IGNITION" ? "The stock is approaching its first breakout trigger."
      : "Early continuation timing checks pass.");
  }

  const atrPct = input.currentPrice > 0 ? (legacy.atr14 / input.currentPrice) * 100 : 0;
  const unconstrainedTargetPct = Math.max(3, Math.min(5, atrPct * 1.25));
  const headroomCap = resistanceHeadroomPct === null ? 5 : Math.max(0, resistanceHeadroomPct - 0.5);
  const shortHorizonTargetPct = Math.max(0, Math.min(unconstrainedTargetPct, headroomCap));

  return {
    ...legacy,
    legacyStatus: legacy.status,
    status,
    qualifies: status !== "NOT_QUALIFIED",
    score,
    breakoutAgeSessions,
    breakoutTests10,
    return5Pct,
    retreatFromHighPct,
    resistancePrice,
    resistanceHeadroomPct,
    ignitionAccelerationPct,
    shortHorizonTargetPct,
    shortHorizonDays: status === "RETEST_SETUP" ? 2 : 1,
    timingReasons,
  };
}
