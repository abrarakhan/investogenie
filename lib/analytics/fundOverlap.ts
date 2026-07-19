// =============================================================================
// Mutual Fund Congruence & Overlap Engine
// -----------------------------------------------------------------------------
// Given a user's parsed holding statement (CAMS-style) and the look-through
// stock allocations of each fund, this engine:
//   1. weights each fund by its rupee/dollar value share of the portfolio,
//   2. computes the portfolio's *effective* underlying stock exposure,
//   3. computes pairwise fund overlap (Σ min(weight_a, weight_b)),
//   4. flags duplicate concentration above a threshold (default 30%), and
//   5. emits rule-based rebalancing + DIRECT-plan optimization instructions.
// =============================================================================

import type { PlanType, UserFundHolding, FundStockWeight } from "@/lib/types";

export interface FundMeta {
  ticker: string;
  expenseRatio?: number; // fractional, 0.0125 = 1.25%
  planType?: PlanType;
}

export interface OverlapConfig {
  /** Pairwise overlap at or above this is flagged (0..100). */
  overlapThresholdPct: number;
  /** A single underlying stock above this aggregate weight is flagged (0..100). */
  concentrationThresholdPct: number;
}

export const DEFAULT_OVERLAP_CONFIG: OverlapConfig = {
  overlapThresholdPct: 30,
  concentrationThresholdPct: 30,
};

export interface PairwiseOverlap {
  fundA: string;
  fundB: string;
  overlapPct: number;
  sharedStocks: string[];
}

export interface StockExposure {
  stockTicker: string;
  /** Effective % of total portfolio value exposed to this stock (0..100). */
  effectiveWeightPct: number;
  contributingFunds: string[];
}

export interface RebalanceInstruction {
  kind: "TRIM_OVERLAP" | "SWITCH_TO_DIRECT" | "REDUCE_CONCENTRATION" | "DISCLOSURE_REQUIRED";
  message: string;
  /** Estimated annual cost saved by a REGULAR→DIRECT switch (fractional of AUM). */
  estimatedAnnualSavingPct?: number;
}

export interface SnapshotCatalogEntry {
  schemeCode: string;
  name: string;
  amc: string | null;
  month: string;
  lineItems: number;
  equityWeightPct: number | null;
  weightsOk: boolean;
}

export interface OverlapReport {
  totalValue: number;
  fundValues: { ticker: string; value: number; sharePct: number }[];
  stockExposure: StockExposure[];
  pairwiseOverlaps: PairwiseOverlap[];
  flaggedOverlaps: PairwiseOverlap[];
  concentratedStocks: StockExposure[];
  instructions: RebalanceInstruction[];
  /** Disclosures loaded in the snapshot store, even if they are not yet linked
   *  to the user's held fund assets. This lets the UI show what data exists
   *  instead of looking empty while awaiting scheme mapping/imports. */
  availableSnapshots?: SnapshotCatalogEntry[];
  /** Reference overlap across loaded disclosures. Not portfolio-weighted unless
   *  those schemes are actually held and linked. */
  referenceOverlaps?: PairwiseOverlap[];
  referenceStockExposure?: StockExposure[];
}

/** Within-fund weight map: fundTicker -> (stockTicker -> weight% 0..100). */
function buildLookThrough(
  lookThrough: FundStockWeight[],
): Map<string, Map<string, number>> {
  const m = new Map<string, Map<string, number>>();
  for (const row of lookThrough) {
    if (!m.has(row.fundTicker)) m.set(row.fundTicker, new Map());
    const inner = m.get(row.fundTicker)!;
    inner.set(row.stockTicker, (inner.get(row.stockTicker) ?? 0) + row.weightPercentage);
  }
  return m;
}

/** Classic overlap metric: Σ over shared stocks of min(weightA, weightB). */
function pairOverlap(
  a: Map<string, number>,
  b: Map<string, number>,
): { overlapPct: number; shared: string[] } {
  let overlap = 0;
  const shared: string[] = [];
  for (const [stock, wA] of a) {
    const wB = b.get(stock);
    if (wB !== undefined) {
      overlap += Math.min(wA, wB);
      shared.push(stock);
    }
  }
  return { overlapPct: overlap, shared };
}

export function analyzeFundOverlap(
  portfolio: UserFundHolding[],
  lookThrough: FundStockWeight[],
  meta: FundMeta[] = [],
  config: OverlapConfig = DEFAULT_OVERLAP_CONFIG,
): OverlapReport {
  const metaByTicker = new Map(meta.map((m) => [m.ticker, m]));
  const lt = buildLookThrough(lookThrough);

  // ---- 1. Fund values + portfolio shares ----
  const fundValueEntries = portfolio.map((h) => ({
    ticker: h.fundTicker,
    value: h.units * h.navValue,
    planType: h.planType ?? metaByTicker.get(h.fundTicker)?.planType,
  }));
  const totalValue = fundValueEntries.reduce((a, f) => a + f.value, 0);
  const fundValues = fundValueEntries.map((f) => ({
    ticker: f.ticker,
    value: f.value,
    sharePct: totalValue === 0 ? 0 : (f.value / totalValue) * 100,
  }));
  const shareByFund = new Map(fundValues.map((f) => [f.ticker, f.sharePct]));

  // ---- 2. Effective portfolio-level stock exposure ----
  // effective(stock) = Σ_fund [ fundShare% × withinFundWeight% / 100 ]
  const exposure = new Map<string, { weight: number; funds: Set<string> }>();
  for (const { ticker: fund } of fundValues) {
    const share = shareByFund.get(fund) ?? 0;
    const inner = lt.get(fund);
    if (!inner) continue;
    for (const [stock, w] of inner) {
      const contribution = (share * w) / 100;
      if (!exposure.has(stock)) exposure.set(stock, { weight: 0, funds: new Set() });
      const e = exposure.get(stock)!;
      e.weight += contribution;
      e.funds.add(fund);
    }
  }
  const stockExposure: StockExposure[] = [...exposure.entries()]
    .map(([stockTicker, e]) => ({
      stockTicker,
      effectiveWeightPct: e.weight,
      contributingFunds: [...e.funds],
    }))
    .sort((a, b) => b.effectiveWeightPct - a.effectiveWeightPct);

  // ---- 3. Pairwise fund overlap ----
  const funds = [...lt.keys()].filter((f) => shareByFund.has(f));
  const pairwiseOverlaps: PairwiseOverlap[] = [];
  for (let i = 0; i < funds.length; i++) {
    for (let j = i + 1; j < funds.length; j++) {
      const { overlapPct, shared } = pairOverlap(lt.get(funds[i])!, lt.get(funds[j])!);
      if (shared.length > 0) {
        pairwiseOverlaps.push({
          fundA: funds[i],
          fundB: funds[j],
          overlapPct: Number(overlapPct.toFixed(2)),
          sharedStocks: shared,
        });
      }
    }
  }
  pairwiseOverlaps.sort((a, b) => b.overlapPct - a.overlapPct);

  // ---- 4. Flagging ----
  const flaggedOverlaps = pairwiseOverlaps.filter(
    (o) => o.overlapPct >= config.overlapThresholdPct,
  );
  const concentratedStocks = stockExposure.filter(
    (s) => s.effectiveWeightPct >= config.concentrationThresholdPct,
  );

  // ---- 5. Rule-based instructions ----
  const instructions: RebalanceInstruction[] = [];

  for (const o of flaggedOverlaps) {
    // Prefer trimming the more expensive / REGULAR-plan fund of the pair.
    const erA = metaByTicker.get(o.fundA)?.expenseRatio ?? 0;
    const erB = metaByTicker.get(o.fundB)?.expenseRatio ?? 0;
    const trim = erA >= erB ? o.fundA : o.fundB;
    const keep = trim === o.fundA ? o.fundB : o.fundA;
    instructions.push({
      kind: "TRIM_OVERLAP",
      message:
        `${o.fundA} and ${o.fundB} overlap ${o.overlapPct.toFixed(1)}% ` +
        `(> ${config.overlapThresholdPct}%). Consolidate by trimming ${trim} ` +
        `(higher cost) and retaining ${keep} to remove redundant exposure to ` +
        `${o.sharedStocks.slice(0, 5).join(", ")}${o.sharedStocks.length > 5 ? "…" : ""}.`,
    });
  }

  for (const s of concentratedStocks) {
    instructions.push({
      kind: "REDUCE_CONCENTRATION",
      message:
        `${s.stockTicker} represents ${s.effectiveWeightPct.toFixed(1)}% of the ` +
        `whole portfolio via ${s.contributingFunds.join(", ")} ` +
        `(> ${config.concentrationThresholdPct}% single-name limit). Diversify across ` +
        `a fund with differentiated holdings.`,
    });
  }

  // DIRECT-plan optimization: any REGULAR holding leaks expense-ratio alpha.
  for (const f of fundValueEntries) {
    if (f.planType === "REGULAR") {
      const er = metaByTicker.get(f.ticker)?.expenseRatio;
      // Typical REGULAR→DIRECT saving is ~0.5–1.0% p.a.; use ER delta if known.
      const saving = er !== undefined ? Math.min(er, 0.01) : 0.0075;
      instructions.push({
        kind: "SWITCH_TO_DIRECT",
        message:
          `${f.ticker} is held in a REGULAR plan. Switching to the DIRECT plan ` +
          `eliminates distributor commission and compounds ~${(saving * 100).toFixed(2)}% p.a. ` +
          `back into NAV.`,
        estimatedAnnualSavingPct: saving,
      });
    }
  }

  return {
    totalValue,
    fundValues,
    stockExposure,
    pairwiseOverlaps,
    flaggedOverlaps,
    concentratedStocks,
    instructions,
  };
}
