export interface UniversalPricePoint {
  date: string;
  prices: [number, number];
}

export interface UniversalBacktestConfig {
  initialCapital: number;
  feeBps: number;
  noTradeBandPct: number;
  gridSteps?: number;
}

export interface UniversalSeriesPoint {
  date: string;
  universalNet: number;
  universalGross: number;
  buyHold: number;
  equalCrpNet: number;
  targetWeightA: number;
  turnover: number;
}

export interface UniversalMetrics {
  finalValue: number;
  totalReturnPct: number;
  cagrPct: number;
  annualVolatilityPct: number;
  maxDrawdownPct: number;
}

export interface UniversalBacktestResult {
  sessions: number;
  startDate: string;
  endDate: string;
  universalNet: UniversalMetrics;
  universalGross: UniversalMetrics;
  buyHold: UniversalMetrics;
  equalCrpNet: UniversalMetrics;
  hindsightBestCrp: UniversalMetrics & { weightA: number };
  latestTarget: [number, number];
  totalTurnover: number;
  estimatedCosts: number;
  series: UniversalSeriesPoint[];
  verdict: "SUCCESS" | "MIXED" | "FAILURE";
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

function softmax(logValues: number[]): number[] {
  const max = Math.max(...logValues);
  const exp = logValues.map((value) => Math.exp(value - max));
  const total = exp.reduce((sum, value) => sum + value, 0);
  return exp.map((value) => value / total);
}

function metrics(values: number[], dailyReturns: number[], dates: string[]): UniversalMetrics {
  const initial = values[0];
  const finalValue = values.at(-1) ?? initial;
  const years = Math.max(1 / 252, (Date.parse(`${dates.at(-1)}T00:00:00Z`) - Date.parse(`${dates[0]}T00:00:00Z`)) / (365.25 * 86_400_000));
  const totalReturnPct = (finalValue / initial - 1) * 100;
  const cagrPct = (Math.pow(finalValue / initial, 1 / years) - 1) * 100;
  const mean = dailyReturns.reduce((sum, value) => sum + value, 0) / Math.max(1, dailyReturns.length);
  const variance = dailyReturns.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / Math.max(1, dailyReturns.length - 1);
  let peak = values[0];
  let maxDrawdownPct = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    maxDrawdownPct = Math.min(maxDrawdownPct, (value / peak - 1) * 100);
  }
  return { finalValue, totalReturnPct, cagrPct, annualVolatilityPct: Math.sqrt(variance * 252) * 100, maxDrawdownPct };
}

export function backtestUniversalPortfolio(
  points: UniversalPricePoint[],
  config: UniversalBacktestConfig,
): UniversalBacktestResult {
  if (points.length < 30) throw new Error("At least 30 common trading sessions are required.");
  const initialCapital = Math.max(1, config.initialCapital);
  const costRate = Math.max(0, config.feeBps) / 10_000;
  const noTradeBand = Math.max(0, config.noTradeBandPct) / 100;
  const steps = clamp(Math.round(config.gridSteps ?? 100), 10, 500);
  const weights = Array.from({ length: steps + 1 }, (_, index) => index / steps);
  const candidateGrossLogs = weights.map(() => 0);
  const candidateNetLogs = weights.map(() => 0);

  let universalGross = initialCapital;
  let universalNet = initialCapital;
  let equalCrpNet = initialCapital;
  let buyHold = initialCapital;
  let grossWeights: [number, number] = [0.5, 0.5];
  let netWeights: [number, number] = [0.5, 0.5];
  let equalWeights: [number, number] = [0.5, 0.5];
  let target: [number, number] = [0.5, 0.5];
  let totalTurnover = 0;
  let estimatedCosts = 0;

  const valuesGross = [initialCapital];
  const valuesNet = [initialCapital];
  const valuesEqual = [initialCapital];
  const valuesBuyHold = [initialCapital];
  const returnsGross: number[] = [];
  const returnsNet: number[] = [];
  const returnsEqual: number[] = [];
  const returnsBuyHold: number[] = [];
  const series: UniversalSeriesPoint[] = [];
  const dates = points.map((point) => point.date);
  const initialPrices = points[0].prices;

  for (let day = 1; day < points.length; day++) {
    const previous = points[day - 1].prices;
    const current = points[day].prices;
    const relatives: [number, number] = [current[0] / previous[0], current[1] / previous[1]];
    if (relatives.some((value) => !Number.isFinite(value) || value <= 0 || value < 0.6 || value > 1.6)) {
      throw new Error(`Suspicious corporate-action discontinuity on ${points[day].date}. Refresh adjusted history before backtesting.`);
    }

    for (let index = 0; index < weights.length; index++) {
      const weightA = weights[index];
      const factor = weightA * relatives[0] + (1 - weightA) * relatives[1];
      candidateGrossLogs[index] += Math.log(factor);
      const postA = weightA * relatives[0] / factor;
      const turnover = Math.abs(weightA - postA);
      candidateNetLogs[index] += Math.log(factor * Math.max(1e-12, 1 - turnover * costRate));
    }

    const grossFactor = grossWeights[0] * relatives[0] + grossWeights[1] * relatives[1];
    const netFactor = netWeights[0] * relatives[0] + netWeights[1] * relatives[1];
    const equalFactor = equalWeights[0] * relatives[0] + equalWeights[1] * relatives[1];
    const netPostA = netWeights[0] * relatives[0] / netFactor;
    const equalPostA = equalWeights[0] * relatives[0] / equalFactor;

    universalGross *= grossFactor;
    universalNet *= netFactor;
    equalCrpNet *= equalFactor;
    buyHold = initialCapital * (0.5 * current[0] / initialPrices[0] + 0.5 * current[1] / initialPrices[1]);

    const posterior = softmax(candidateNetLogs);
    const nextWeightA = posterior.reduce((sum, probability, index) => sum + probability * weights[index], 0);
    target = [nextWeightA, 1 - nextWeightA];
    const grossPosterior = softmax(candidateGrossLogs);
    const grossTargetA = grossPosterior.reduce((sum, probability, index) => sum + probability * weights[index], 0);
    grossWeights = [grossTargetA, 1 - grossTargetA];

    const drift = Math.abs(target[0] - netPostA);
    let turnover = 0;
    if (drift >= noTradeBand) {
      turnover = drift;
      const cost = universalNet * turnover * costRate;
      universalNet -= cost;
      estimatedCosts += cost;
      totalTurnover += turnover;
      netWeights = target;
    } else {
      netWeights = [netPostA, 1 - netPostA];
    }

    const equalTurnover = Math.abs(0.5 - equalPostA);
    equalCrpNet *= Math.max(1e-12, 1 - equalTurnover * costRate);
    equalWeights = [0.5, 0.5];

    const previousGross = valuesGross.at(-1) as number;
    const previousNet = valuesNet.at(-1) as number;
    const previousEqual = valuesEqual.at(-1) as number;
    const previousBuyHold = valuesBuyHold.at(-1) as number;
    valuesGross.push(universalGross);
    valuesNet.push(universalNet);
    valuesEqual.push(equalCrpNet);
    valuesBuyHold.push(buyHold);
    returnsGross.push(universalGross / previousGross - 1);
    returnsNet.push(universalNet / previousNet - 1);
    returnsEqual.push(equalCrpNet / previousEqual - 1);
    returnsBuyHold.push(buyHold / previousBuyHold - 1);
    series.push({ date: points[day].date, universalNet, universalGross, buyHold, equalCrpNet, targetWeightA: target[0], turnover });
  }

  const bestIndex = candidateNetLogs.reduce((best, value, index) => value > candidateNetLogs[best] ? index : best, 0);
  const bestWeightA = weights[bestIndex];
  const bestValues = [initialCapital];
  const bestReturns: number[] = [];
  let bestWealth = initialCapital;
  for (let day = 1; day < points.length; day++) {
    const previous = points[day - 1].prices;
    const current = points[day].prices;
    const relativeA = current[0] / previous[0];
    const relativeB = current[1] / previous[1];
    const factor = bestWeightA * relativeA + (1 - bestWeightA) * relativeB;
    const postWeightA = bestWeightA * relativeA / factor;
    const turnover = Math.abs(bestWeightA - postWeightA);
    const previousWealth = bestWealth;
    bestWealth *= factor * Math.max(1e-12, 1 - turnover * costRate);
    bestValues.push(bestWealth);
    bestReturns.push(bestWealth / previousWealth - 1);
  }
  const universalNetMetrics = metrics(valuesNet, returnsNet, dates);
  const equalMetrics = metrics(valuesEqual, returnsEqual, dates);
  const buyHoldMetrics = metrics(valuesBuyHold, returnsBuyHold, dates);
  const verdict = universalNetMetrics.finalValue > Math.max(equalMetrics.finalValue, buyHoldMetrics.finalValue)
    ? "SUCCESS"
    : universalNetMetrics.finalValue > Math.min(equalMetrics.finalValue, buyHoldMetrics.finalValue) ? "MIXED" : "FAILURE";

  return {
    sessions: points.length,
    startDate: points[0].date,
    endDate: points.at(-1)!.date,
    universalNet: universalNetMetrics,
    universalGross: metrics(valuesGross, returnsGross, dates),
    buyHold: buyHoldMetrics,
    equalCrpNet: equalMetrics,
    hindsightBestCrp: { ...metrics(bestValues, bestReturns, dates), weightA: bestWeightA },
    latestTarget: target,
    totalTurnover,
    estimatedCosts,
    series,
    verdict,
  };
}
