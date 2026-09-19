import { queryOne } from "@/lib/db";
import { deriveLevels, type SwingSetup } from "@/lib/analytics/swingClassifier";
import { STRATEGY_META, type StrategyScore } from "@/lib/analytics/legendaryStrategies";
import { getUserSwingSettings } from "@/lib/settings";

type SignalRow = {
  asset_id: string; ticker: string; currency: string; current_price: string | number | null;
  last_close: string | number | null; atr: string | number | null; long_trigger: string | number | null;
  short_trigger: string | number | null; hh22: string | number | null; ll22: string | number | null;
  daily_velocity: string | number | null; verdict: string | null; score: string | number | null;
  as_of: string | null; strategy_scores: Record<string, StrategyScore> | null; quote_price: string | number | null;
};

export async function resolveSignalProjection(
  assetId: string,
  market: "IN" | "US",
  preferredStrategy: string,
  buyPrice: number,
  userId?: string,
) {
  const row = await queryOne<SignalRow>(
    `select s.asset_id,s.ticker,a.currency,s.current_price,s.last_close,s.atr,s.long_trigger,s.short_trigger,
            s.hh22,s.ll22,s.daily_velocity,s.verdict,s.score,s.as_of,s.strategy_scores,q.price quote_price
       from public.swing_signals s
       join public.assets a on a.id=s.asset_id
       left join public.latest_quotes q on q.asset_id=s.asset_id
      where s.asset_id=$1 and s.country=$2`,
    [assetId, market],
  );
  if (!row) throw new Error("No swing projection has been calculated for this stock yet");
  const num = (value: string | number | null) => value === null ? 0 : Number(value);
  const availableLongStrategies = Object.entries(row.strategy_scores ?? {})
    .filter(([, score]) => score.dir === "LONG")
    .sort(([, left], [, right]) => right.score - left.score);
  const preferredScore = row.strategy_scores?.[preferredStrategy];
  const isStrongSwing = preferredStrategy === "STRONG_SWING";
  const isMomentumIgnition = preferredStrategy === "MOMENTUM_IGNITION";
  const strategyKey = isStrongSwing || isMomentumIgnition
    ? preferredStrategy
    : preferredStrategy && preferredScore?.dir === "LONG"
      ? preferredStrategy
      : availableLongStrategies[0]?.[0] ?? "DEFAULT_SWING";
  const setup: SwingSetup = {
    currentPrice: buyPrice,
    atr: num(row.atr), longTrigger: buyPrice, shortTrigger: num(row.short_trigger),
    hh22: Math.min(num(row.hh22) || buyPrice, buyPrice), ll22: num(row.ll22), dailyVelocity: num(row.daily_velocity),
  };
  const strategyScore = isStrongSwing || isMomentumIgnition ? undefined : row.strategy_scores?.[strategyKey];
  const settings = await getUserSwingSettings(userId);
  const levels = deriveLevels(setup, "LONG", settings);
  const label = isStrongSwing
    ? "Strong Swing"
    : isMomentumIgnition
      ? "Momentum Ignition"
      : STRATEGY_META.find((item) => item.key === strategyKey)?.label ?? "Default Swing";
  return { row, levels, label, strategyKey, strategyScore, trailingDistance: settings.trailAtrMult * levels.atr };
}
