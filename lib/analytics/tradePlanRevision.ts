export type RevisedTradeAction =
  | "FOLLOW_ORIGINAL"
  | "EXTEND_RUNNER"
  | "PROTECT_PROFIT"
  | "PROTECT_RECOVERY"
  | "EXIT"
  | "UNAVAILABLE";

export interface TradePlanRevisionInput {
  status: "OPEN" | "CLOSED";
  currentPrice: number | null;
  buyPrice: number;
  originalTarget: number;
  originalStop: number;
  effectiveTrailingStop: number | null;
  atr: number | null;
  highestHighSinceEntry: number | null;
  lowestLowSinceEntry: number | null;
  stockMove1dPct: number | null;
  stockMove2dPct: number | null;
  soldQuantity: number;
  remainingQuantity: number;
  externalExitRisk: boolean;
  holdingWindowExpired?: boolean;
  externalExitReasons: string[];
  recoveryTarget: number | null;
  historicalTarget: number | null;
  historicalSampleSize: number;
  historicalHorizon: number;
}

export interface TradePlanRevision {
  action: RevisedTradeAction;
  label: string;
  revisedTarget: number | null;
  historicalTarget: number | null;
  historicalSampleSize: number;
  historicalHorizon: number;
  protectiveStop: number | null;
  remainingUpsidePct: number | null;
  originalPlanBreached: boolean;
  atUpperCircuit: boolean;
  reasons: string[];
}

const roundPrice = (value: number): number => Math.round(value * 100) / 100;
const positive = (value: number | null): boolean => value !== null && Number.isFinite(value) && value > 0;

/**
 * Reassess an open trade without mutating its frozen entry-time projection.
 * ATR is used only as a volatility-scaled runner objective after the original
 * target is reached; it is not directional and never revives a breached plan.
 */
export function reviseSwingTradePlan(input: TradePlanRevisionInput): TradePlanRevision {
  const current = input.currentPrice;
  const originalPlanBreached = positive(input.lowestLowSinceEntry)
    && input.lowestLowSinceEntry! <= input.originalStop;
  const move = Math.abs(input.stockMove1dPct ?? 0);
  const circuitLikeMove = [5, 10, 20].some((band) => Math.abs(move - band) <= 0.3);
  const atUpperCircuit = positive(current) && positive(input.highestHighSinceEntry)
    && current! >= input.highestHighSinceEntry! * 0.999 && (input.stockMove1dPct ?? 0) > 0
    && circuitLikeMove;
  const protectiveStop = input.effectiveTrailingStop ?? input.originalStop;

  if (input.status === "CLOSED" || !positive(current) || input.remainingQuantity <= 0) {
    return {
      action: "UNAVAILABLE", label: "No open position", revisedTarget: null,
      historicalTarget: null, historicalSampleSize: 0, historicalHorizon: 0,
      protectiveStop: null, remainingUpsidePct: null, originalPlanBreached,
      atUpperCircuit, reasons: ["A revised plan is shown only for an open position with a current quote."],
    };
  }

  if (current! <= protectiveStop) {
    return {
      action: "EXIT", label: "Exit condition active", revisedTarget: null,
      historicalTarget: null, historicalSampleSize: 0, historicalHorizon: 0,
      protectiveStop, remainingUpsidePct: null, originalPlanBreached: true,
      atUpperCircuit, reasons: ["The current quote is at or below the effective protective stop."],
    };
  }

  if (input.externalExitRisk) {
    return {
      action: "EXIT", label: "Exit risk remains active", revisedTarget: null,
      historicalTarget: null, historicalSampleSize: 0, historicalHorizon: 0,
      protectiveStop, remainingUpsidePct: null, originalPlanBreached,
      atUpperCircuit, reasons: input.externalExitReasons.length
        ? input.externalExitReasons
        : ["A non-target risk condition blocks any revised upside objective."],
    };
  }

  const aboveEntry = current! > input.buyPrice;
  const heldPastWindow = Boolean(input.holdingWindowExpired) && current! < input.originalTarget;
  if (originalPlanBreached || heldPastWindow) {
    const reasons: string[] = [];
    if (originalPlanBreached) {
      reasons.push(`Position note: the session low of ${roundPrice(input.lowestLowSinceEntry!)} traded below the original stop of ${roundPrice(input.originalStop)} and the position was retained rather than exited.`);
    }
    if (heldPastWindow) reasons.push("Position note: the planned holding window has ended without the frozen target being reached.");
    reasons.push(aboveEntry
      ? "Price is now above entry, so the position is managed on a revised plan: the protective level follows the effective trail and the objectives are re-derived from current volatility and comparable past movement."
      : "The recovery objectives are advisory exit references for a position that remains open; they do not restore the original setup.");
    if (input.soldQuantity > 0) reasons.push("The guidance applies only to the shares still remaining after partial sales.");
    return {
      action: "PROTECT_RECOVERY",
      label: aboveEntry ? "Held beyond the original plan" : "Recovery objectives",
      revisedTarget: input.recoveryTarget,
      historicalTarget: input.historicalTarget,
      historicalSampleSize: input.historicalSampleSize,
      historicalHorizon: input.historicalHorizon,
      protectiveStop,
      remainingUpsidePct: input.recoveryTarget === null ? null : ((input.recoveryTarget / current!) - 1) * 100,
      originalPlanBreached,
      atUpperCircuit, reasons,
    };
  }

  const targetReached = current! >= input.originalTarget;
  const momentumPositive = (input.stockMove1dPct ?? 0) > 0 && (input.stockMove2dPct ?? 0) > 0;
  const atr = positive(input.atr) ? input.atr! : null;

  if (targetReached && momentumPositive && atr !== null) {
    const anchor = Math.max(current!, input.originalTarget, input.highestHighSinceEntry ?? 0);
    const revisedTarget = roundPrice(anchor + atr);
    const reasons = [
      "The original target has been reached and both one-session and two-session movement remain positive.",
      "The revised objective is one current ATR above the highest post-entry price; keep the effective trail as the controlling exit level.",
    ];
    if (atUpperCircuit) reasons.push("Price is at the reported upper circuit; execution and the next tradable price may be discontinuous.");
    if (input.soldQuantity > 0) reasons.push("The extension applies only to the remaining runner quantity.");
    return {
      action: "EXTEND_RUNNER", label: "Trail remaining runner", revisedTarget,
      historicalTarget: null, historicalSampleSize: 0, historicalHorizon: 0,
      protectiveStop, remainingUpsidePct: ((revisedTarget / current!) - 1) * 100,
      originalPlanBreached: false, atUpperCircuit, reasons,
    };
  }

  if (targetReached) {
    return {
      action: "PROTECT_PROFIT", label: "Protect achieved profit", revisedTarget: null,
      historicalTarget: null, historicalSampleSize: 0, historicalHorizon: 0,
      protectiveStop, remainingUpsidePct: null, originalPlanBreached: false,
      atUpperCircuit, reasons: [
        "The frozen target has been reached, but current momentum does not support an automatic target extension.",
        "Use the effective trail or record a partial/full profit rather than treating the old target as unfinished.",
      ],
    };
  }

  return {
    action: "FOLLOW_ORIGINAL", label: "Original plan remains active",
    revisedTarget: input.originalTarget, protectiveStop,
    historicalTarget: null, historicalSampleSize: 0, historicalHorizon: 0,
    remainingUpsidePct: ((input.originalTarget / current!) - 1) * 100,
    originalPlanBreached: false, atUpperCircuit,
    reasons: ["No stop breach or completed target is detected; continue measuring against the frozen target and effective trail."],
  };
}
