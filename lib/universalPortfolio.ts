import "server-only";
import type { UniversalBacktestConfig, UniversalBacktestResult, UniversalPricePoint } from "@/lib/analytics/universalPortfolio";
import { runPythonStrategyBatch } from "@/lib/pythonStrategyMath";

export async function backtestUniversalPortfolio(points: UniversalPricePoint[], config: UniversalBacktestConfig): Promise<UniversalBacktestResult> {
  const [result] = await runPythonStrategyBatch<{ points: UniversalPricePoint[]; config: UniversalBacktestConfig }, UniversalBacktestResult>("adaptive_backtest", [{ points, config }]);
  return result;
}
