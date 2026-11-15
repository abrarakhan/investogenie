import "server-only";
import type { AdaptivePairSelection, AdaptiveSelectionCandidate } from "@/lib/analytics/adaptiveAllocationSelection";
import { runPythonStrategyBatch } from "@/lib/pythonStrategyMath";

export async function selectAdaptiveAllocationPair(candidates: AdaptiveSelectionCandidate[]): Promise<AdaptivePairSelection> {
  const [selected] = await runPythonStrategyBatch<{ candidates: AdaptiveSelectionCandidate[] }, AdaptivePairSelection>("adaptive_pair", [{ candidates }]);
  return selected;
}
