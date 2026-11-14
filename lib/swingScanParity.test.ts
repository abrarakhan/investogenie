import { describe, expect, it } from "vitest";
import { classifySwingSetup, deriveLevels } from "@/lib/analytics/swingClassifier";
import { evaluateLegendary, strategyTradeLevels } from "@/lib/analytics/legendaryStrategies";
import { momentumLeaderPercentiles, relativeStrengthRatings } from "@/lib/analytics/legendaryStrategies";
import { swingTieBreakScore } from "@/lib/analytics/candidateRanking";
import { runPythonStrategyBatch } from "@/lib/pythonStrategyMath";
import { entryState } from "@/lib/screener";
import type { OHLCV } from "@/lib/types";

function bars(seed: number, count = 280): OHLCV[] {
  let state = seed >>> 0;
  const random = () => { state = (1664525 * state + 1013904223) >>> 0; return state / 4294967296; };
  let close = 30 + seed;
  return Array.from({ length: count }, (_, index) => {
    close = Math.max(2, close * (1 + (random() - 0.47) * 0.045));
    const range = close * (0.01 + random() * 0.04);
    return {
      date: new Date(Date.UTC(2025, 0, 1) + index * 86_400_000).toISOString().slice(0, 10),
      open: close * (0.99 + random() * 0.02), high: close + range * random(),
      low: Math.max(0.01, close - range * random()), close,
      volume: Math.round(100_000 + random() * 2_000_000), openInterest: null,
    };
  });
}

describe("Base Swing and named-strategy Python parity", () => {
  it("matches the TypeScript oracle on varied complete histories", async () => {
    const inputs = Array.from({ length: 20 }, (_, index) => ({
      bars: bars(index + 1), rsRating: 40 + index * 3,
      momentumPercentile: 70 + index, minTradedValue: 0, tick: 0.05,
      risk: { stopAtrMult: 1.5, targetRR: 2, trailAtrMult: 3 },
    }));
    const python = await runPythonStrategyBatch<typeof inputs[number], {
      signal: ReturnType<typeof classifySwingSetup>;
      levels: ReturnType<typeof deriveLevels>;
      legendary: ReturnType<typeof evaluateLegendary>;
      tieBreak: ReturnType<typeof swingTieBreakScore>;
    }>("swing_scan", inputs);
    inputs.forEach((input, index) => {
      const signal = classifySwingSetup(input.bars);
      const levels = deriveLevels(signal.setup, signal.bias === "SHORT" ? "SHORT" : "LONG", input.risk);
      const named = evaluateLegendary(input.bars, input);
      const tie = swingTieBreakScore({ isBreakout: signal.isBreakout, close: signal.close,
        donchianHigh: signal.donchianHigh, upperBand: signal.bollinger.upper,
        atr: signal.setup.atr, volumeExpansion: signal.volumeExpansion, rsRating: input.rsRating });
      expect(python[index].signal.verdict).toBe(signal.verdict);
      expect(python[index].signal.bias).toBe(signal.bias);
      expect(python[index].signal.score).toBeCloseTo(signal.score, 12);
      expect(python[index].signal.setup).toEqual(signal.setup);
      expect(python[index].levels).toEqual(levels);
      expect(python[index].legendary.tags).toEqual(named.tags);
      expect(python[index].legendary.scores).toEqual(named.scores);
      expect(python[index].legendary.results.map((item) => item.direction))
        .toEqual(named.results.map((item) => item.direction));
      expect(python[index].tieBreak.rankScore).toBe(tie.rankScore);
      expect(python[index].tieBreak.breakoutClearanceAtr).toBeCloseTo(tie.breakoutClearanceAtr, 12);
    });
  }, 120_000);

  it("covers actual matches for the named strategies", async () => {
    const make = (points: Array<[number, number, number, number?]>): OHLCV[] => points.map(([high, low, close, volume = 1000], index) => ({
      date: new Date(Date.UTC(2025, 0, 1) + index * 86_400_000).toISOString().slice(0, 10),
      open: index ? points[index - 1][2] : close, high, low, close, volume, openInterest: null,
    }));
    const trend = (count: number, from: number, to: number, volume = 1000, spread = .01): Array<[number, number, number, number]> =>
      Array.from({ length: count }, (_, index) => { const close = from + (to - from) * index / Math.max(1, count - 1); return [close * (1 + spread), close * (1 - spread), close, volume]; });
    const darvas: Array<[number, number, number, number?]> = [[105,100,103],[104,99,101],[103,97,98],[102,95,97],[101,96,99],[102,97,100],[103,98,101],[102.5,98,100]];
    const simonsCloses = [...Array(200).fill(60), 100, ...Array(19).fill(100).map((c, i) => c + (i % 2 ? 1 : -1)), 90];
    const fixtures = [make([...trend(250,50,100),...darvas]), make(trend(260,80,100)), make(simonsCloses.map((close) => [close*1.01,close*.99,close,1000]))];
    const inputs = fixtures.map((bars) => ({ bars, rsRating: 90, momentumPercentile: 99, minTradedValue: 0, tick: .01, risk: { stopAtrMult: 1.5, targetRR: 2, trailAtrMult: 3 } }));
    const python = await runPythonStrategyBatch<typeof inputs[number], { legendary: ReturnType<typeof evaluateLegendary> }>("swing_scan", inputs);
    inputs.forEach((input, index) => {
      const expected = evaluateLegendary(input.bars, input);
      expect(python[index].legendary.tags).toEqual(expected.tags);
      expect(python[index].legendary.scores).toEqual(expected.scores);
    });
    expect(python.flatMap((item) => item.legendary.tags)).toEqual(expect.arrayContaining(["DARVAS", "PTJ", "SIMONS"]));
  }, 120_000);

  it("owns cross-sectional RS and momentum ranks in Python", async () => {
    const items = [
      { id: "weak", closes: { c0: 80, c21: 100, c63: 100, c126: 100, c189: 100, c252: 100 } },
      { id: "flat", closes: { c0: 100, c21: 100, c63: 100, c126: 100, c189: 100, c252: 100 } },
      { id: "strong", closes: { c0: 150, c21: 100, c63: 100, c126: 100, c189: 100, c252: 100 } },
    ];
    const [python] = await runPythonStrategyBatch<{ items: typeof items }, { rsRatings: Record<string, number>; momentumPercentiles: Record<string, number> }>("swing_cross_section", [{ items }]);
    const rs = relativeStrengthRatings(new Map(items.map((item) => [item.id, item.closes])));
    const momentum = momentumLeaderPercentiles(new Map(items.map((item) => [item.id, item.closes])));
    expect(python.rsRatings).toEqual(Object.fromEntries(rs));
    expect(python.momentumPercentiles).toEqual(Object.fromEntries(momentum));
  });

  it("derives live default and named-strategy levels in Python", async () => {
    const setup = { currentPrice: 105, atr: 2, longTrigger: 100, shortTrigger: 90, hh22: 106, ll22: 88, dailyVelocity: 1 };
    const score = { score: 1, dir: "LONG" as const, entry: 100, stop: 92, target: null, trail: 95, maxRisk: .08, triggered: true, confirmed: false, volumeRatio: 1.2 };
    const risk = { stopAtrMult: 1.5, targetRR: 2, trailAtrMult: 3 };
    const input = { setup, direction: "LONG" as const, risk, scores: { MINERVINI: score }, noSetup: false };
    const [python] = await runPythonStrategyBatch<typeof input, { default: ReturnType<typeof deriveLevels>; entryState: string | null; strategies: Record<string, { entry: number; target: number; stopLoss: number; trailingStop: number; state: string | null }> }>("swing_levels", [input]);
    expect(python.default).toEqual(deriveLevels(setup, "LONG", risk));
    const expected = strategyTradeLevels(setup, score, risk);
    expect(python.strategies.MINERVINI).toMatchObject({ entry: expected.entry, target: expected.target, stopLoss: expected.stopLoss, trailingStop: expected.trailingStop });
    expect(python.strategies.MINERVINI.state).toBe(entryState({ direction: "LONG", price: 105, atr: 2, trigger: 100, stop: expected.stopLoss, triggered: true, confirmed: false }));
  });
});
