import "server-only";
import {
  LONG_TERM_STRATEGY_KEYS,
  criteriaFor,
  type LongTermFundamentals,
  type LongTermMarket,
  type LongTermScore,
} from "@/lib/analytics/longTermStrategies";
import { runPythonStrategyBatch } from "@/lib/pythonStrategyMath";

/** One Python process scores the complete market cross-section against all six rule sets. */
export async function scoreLongTermBatch(
  fundamentals: LongTermFundamentals[],
  market: LongTermMarket,
): Promise<LongTermScore[][]> {
  const strategies = LONG_TERM_STRATEGY_KEYS.map((key) => ({ key, criteria: criteriaFor(key, market) }));
  const [scores] = await runPythonStrategyBatch<
    { market: LongTermMarket; fundamentals: LongTermFundamentals[]; strategies: typeof strategies },
    LongTermScore[][]
  >("long_term_scores", [{ market, fundamentals, strategies }]);
  if (scores.length !== fundamentals.length) throw new Error("Python Long-Term scorer returned an invalid universe");
  return scores;
}
