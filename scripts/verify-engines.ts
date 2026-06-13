// Runtime self-verification of the three analytical engines. Run:
//   npx tsx scripts/verify-engines.ts
import { classifySwingSetup } from "../lib/analytics/swingClassifier";
import { analyzeFundOverlap } from "../lib/analytics/fundOverlap";
import { buildMacroMatrix } from "../lib/analytics/macroCorrelator";
import type { OHLCV } from "../lib/types";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

// ---------------------------------------------------------------------------
// 1. Swing classifier: build a derivative series that squeezes, then breaks out
//    on rising price + rising OI (a textbook Long Build-up).
// ---------------------------------------------------------------------------
const bars: OHLCV[] = [];
let oi = 100_000;
for (let i = 0; i < 40; i++) {
  // Flat, low-volatility base (the squeeze) for the first 35 bars...
  const base = 100 + Math.sin(i) * 0.3;
  // ...then a clean breakout over the last 5 bars with OI expanding.
  const breakout = i >= 35 ? (i - 34) * 2.2 : 0;
  const close = base + breakout;
  oi += i >= 35 ? 12_000 : 200; // OI ramps hard during the breakout
  bars.push({
    date: `2026-05-${String(i + 1).padStart(2, "0")}`,
    open: close - 0.2,
    high: close + 0.4,
    low: close - 0.5,
    close,
    volume: i >= 35 ? 3_000_000 : 1_000_000,
    openInterest: oi,
  });
}
const swing = classifySwingSetup(bars);
check("swing: flags LONG_BREAKOUT", swing.verdict === "LONG_BREAKOUT", `verdict=${swing.verdict}, score=${swing.score.toFixed(2)}`);
check("swing: confirms Long Build-up via OI", swing.isLongBuildup, `oiΔ=${(swing.oiChangePct * 100).toFixed(1)}%`);

// ---------------------------------------------------------------------------
// 2. Fund overlap: two INR funds sharing >30% holdings, one REGULAR plan.
//    Verifies multi-currency (INR) handling + DIRECT-plan optimization.
// ---------------------------------------------------------------------------
const overlap = analyzeFundOverlap(
  [
    { fundTicker: "FUND_A", units: 1000, navValue: 95.2, planType: "REGULAR" }, // INR NAV
    { fundTicker: "FUND_B", units: 500, navValue: 210.4, planType: "DIRECT" },
  ],
  [
    { fundTicker: "FUND_A", stockTicker: "RELIANCE", weightPercentage: 25 },
    { fundTicker: "FUND_A", stockTicker: "HDFCBANK", weightPercentage: 20 },
    { fundTicker: "FUND_A", stockTicker: "INFY", weightPercentage: 15 },
    { fundTicker: "FUND_B", stockTicker: "RELIANCE", weightPercentage: 22 },
    { fundTicker: "FUND_B", stockTicker: "HDFCBANK", weightPercentage: 18 },
    { fundTicker: "FUND_B", stockTicker: "TCS", weightPercentage: 14 },
  ],
  [
    { ticker: "FUND_A", expenseRatio: 0.0175, planType: "REGULAR" },
    { ticker: "FUND_B", expenseRatio: 0.006, planType: "DIRECT" },
  ],
);
check("overlap: flags pair > 30%", overlap.flaggedOverlaps.length >= 1, `top=${overlap.pairwiseOverlaps[0]?.overlapPct}%`);
check("overlap: emits DIRECT-plan switch", overlap.instructions.some((i) => i.kind === "SWITCH_TO_DIRECT"));
check("overlap: computes total value in fund currency", overlap.totalValue === 1000 * 95.2 + 500 * 210.4, `total=${overlap.totalValue}`);

// ---------------------------------------------------------------------------
// 3. Macro correlator: a macro series that LEADS a sector by ~3 days.
// ---------------------------------------------------------------------------
const days = 120;
const macroPts = [];
const sectorPts = [];
const macroVals: number[] = [];
for (let i = 0; i < days; i++) {
  const v = 50 + 10 * Math.sin(i / 6);
  macroVals.push(v);
}
for (let i = 0; i < days; i++) {
  const d = `2026-${String(1 + Math.floor(i / 30)).padStart(2, "0")}-${String((i % 30) + 1).padStart(2, "0")}`;
  macroPts.push({ date: d, value: macroVals[i] });
  // sector echoes the macro value from 3 days earlier (macro leads).
  sectorPts.push({ date: d, value: i >= 3 ? macroVals[i - 3] * 2 : 100 });
}
const matrix = buildMacroMatrix(
  [{ key: "US_10Y_YIELD", points: macroPts }],
  [{ key: "TECH", points: sectorPts }],
);
const pair = matrix.pairs[0];
check("macro: detects a positive lead/lag relationship", Math.abs(pair.bestCoef) > 0.5, `bestCoef=${pair.bestCoef}, lag=${pair.bestLag}d, signal=${pair.signal}`);

console.log(`\n${failures === 0 ? "ALL ENGINES VERIFIED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
