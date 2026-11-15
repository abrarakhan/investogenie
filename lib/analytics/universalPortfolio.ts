/** Contracts only. Universal Portfolio mathematics is owned by Python. */
export interface UniversalPricePoint { date: string; prices: [number, number] }
export interface UniversalBacktestConfig { initialCapital: number; feeBps: number; noTradeBandPct: number; gridSteps?: number }
export interface UniversalSeriesPoint { date: string; universalNet: number; universalGross: number; buyHold: number; equalCrpNet: number; targetWeightA: number; turnover: number }
export interface UniversalMetrics { finalValue: number; totalReturnPct: number; cagrPct: number; annualVolatilityPct: number; maxDrawdownPct: number }
export interface UniversalBacktestResult {
  sessions: number; startDate: string; endDate: string;
  universalNet: UniversalMetrics; universalGross: UniversalMetrics; buyHold: UniversalMetrics; equalCrpNet: UniversalMetrics;
  hindsightBestCrp: UniversalMetrics & { weightA: number };
  latestTarget: [number, number]; totalTurnover: number; estimatedCosts: number; series: UniversalSeriesPoint[];
  verdict: "SUCCESS" | "MIXED" | "FAILURE";
}
