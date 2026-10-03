"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { getAdaptiveBacktest, resolveAdaptiveAsset } from "@/lib/adaptiveAllocation";
import type { MarketId } from "@/lib/types";

const marketOf = (value: FormDataEntryValue | null): MarketId => value === "US" ? "US" : "IN";
const numberOf = (data: FormData, key: string, fallback: number) => {
  const value = Number(data.get(key));
  return Number.isFinite(value) ? value : fallback;
};

export async function saveAdaptiveStrategy(formData: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const market = marketOf(formData.get("market"));
  const tickerA = String(formData.get("tickerA") ?? "").trim().toUpperCase();
  const tickerB = String(formData.get("tickerB") ?? "").trim().toUpperCase();
  const initialCapital = Math.max(1, numberOf(formData, "initialCapital", 100000));
  const feeBps = Math.max(0, numberOf(formData, "feeBps", 15));
  const noTradeBandPct = Math.max(0, numberOf(formData, "noTradeBandPct", 1));
  const lookbackYears = Math.max(1, Math.min(20, Math.round(numberOf(formData, "lookbackYears", 5))));
  const [assetA, assetB] = await Promise.all([resolveAdaptiveAsset(market, tickerA), resolveAdaptiveAsset(market, tickerB)]);
  const name = String(formData.get("name") ?? `${tickerA} / ${tickerB}`).trim().slice(0, 80) || `${tickerA} / ${tickerB}`;
  const backtest = await getAdaptiveBacktest({ market, tickerA, tickerB, initialCapital, feeBps, noTradeBandPct, lookbackYears });
  const strategy = await queryOne<{ id: string }>(
    `insert into public.adaptive_allocation_strategies
       (user_id,market,name,asset_a_id,asset_b_id,initial_capital,fee_bps,no_trade_band_pct,lookback_years)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [user.id, market, name, assetA.id, assetB.id, initialCapital, feeBps, noTradeBandPct, lookbackYears],
  );
  if (!strategy) throw new Error("Could not save the paper strategy.");
  await query(
    `insert into public.adaptive_allocation_runs
       (strategy_id,as_of,target_weight_a,target_weight_b,verdict,result_json)
     values ($1,$2,$3,$4,$5,$6::jsonb)`,
    [strategy.id, backtest.result.endDate, backtest.result.latestTarget[0], backtest.result.latestTarget[1], backtest.result.verdict, JSON.stringify(backtest.result)],
  );
  revalidatePath(`/terminal/${market.toLowerCase()}/adaptive-allocation`);
}

export async function deleteAdaptiveStrategy(formData: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const market = marketOf(formData.get("market"));
  await query("delete from public.adaptive_allocation_strategies where id=$1 and user_id=$2", [String(formData.get("strategyId") ?? ""), user.id]);
  revalidatePath(`/terminal/${market.toLowerCase()}/adaptive-allocation`);
}
