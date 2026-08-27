"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { deriveLevels, type SwingSetup } from "@/lib/analytics/swingClassifier";
import { STRATEGY_META, type StrategyScore } from "@/lib/analytics/legendaryStrategies";
import { getUserSwingSettings } from "@/lib/settings";

const validMarket = (value: string): "IN" | "US" => value === "US" ? "US" : "IN";
const cleanNumber = (formData: FormData, key: string): number | null => {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

type SignalRow = {
  asset_id: string; ticker: string; currency: string; current_price: string | number | null;
  last_close: string | number | null; atr: string | number | null; long_trigger: string | number | null;
  short_trigger: string | number | null; hh22: string | number | null; ll22: string | number | null;
  daily_velocity: string | number | null; verdict: string | null; score: string | number | null;
  as_of: string | null; strategy_scores: Record<string, StrategyScore> | null; quote_price: string | number | null;
};

async function resolveSignalProjection(assetId: string, market: "IN" | "US", strategyKey: string) {
  const row = await queryOne<SignalRow>(
    `select s.asset_id,s.ticker,a.currency,s.current_price,s.last_close,s.atr,s.long_trigger,s.short_trigger,
            s.hh22,s.ll22,s.daily_velocity,s.verdict,s.score,s.as_of,s.strategy_scores,q.price quote_price
       from public.swing_signals s
       join public.assets a on a.id=s.asset_id
       left join public.latest_quotes q on q.asset_id=s.asset_id
      where s.asset_id=$1 and s.country=$2`,
    [assetId, market],
  );
  if (!row) throw new Error("No current swing projection exists for this asset");
  const num = (value: string | number | null) => value === null ? 0 : Number(value);
  const setup: SwingSetup = {
    currentPrice: num(row.quote_price) || num(row.current_price) || num(row.last_close),
    atr: num(row.atr), longTrigger: num(row.long_trigger), shortTrigger: num(row.short_trigger),
    hh22: num(row.hh22), ll22: num(row.ll22), dailyVelocity: num(row.daily_velocity),
  };
  const strategyScore = row.strategy_scores?.[strategyKey];
  if (strategyKey !== "DEFAULT_SWING" && !strategyScore) {
    throw new Error("That strategy was not matched by the current signal for this stock");
  }
  const trigger = strategyScore?.entry ?? setup.longTrigger;
  const settings = await getUserSwingSettings();
  const levels = deriveLevels({ ...setup, longTrigger: trigger }, "LONG", settings);
  const label = STRATEGY_META.find((item) => item.key === strategyKey)?.label ?? "Default Swing";
  return { row, levels, label, strategyScore, trailingDistance: settings.trailAtrMult * levels.atr };
}

export async function addSwingTrade(formData: FormData) {
  const user = await requireUser();
  const market = validMarket(String(formData.get("market") ?? "IN"));
  const assetId = String(formData.get("assetId") ?? "").trim();
  const ticker = String(formData.get("ticker") ?? "").trim().toUpperCase();
  const asset = await queryOne<{ id: string; ticker: string; currency: string }>(
    assetId
      ? `select id,ticker,currency from public.assets where id=$1 and country=$2 and asset_class='STOCK'`
      : `select id,ticker,currency from public.assets where upper(ticker)=$1 and country=$2 and asset_class='STOCK'
           order by case when $2='IN' and exchange='NSE' then 0 when $2='US' and exchange='NASDAQ' then 0 else 1 end limit 1`,
    [assetId || ticker, market],
  );
  if (!asset) throw new Error("Ticker was not found in this market");

  const strategyKey = String(formData.get("strategyKey") ?? "DEFAULT_SWING").toUpperCase();
  const projection = await resolveSignalProjection(asset.id, market, strategyKey);
  const boughtOn = String(formData.get("boughtOn") ?? "").slice(0, 10);
  const buyPrice = cleanNumber(formData, "buyPrice");
  const quantity = cleanNumber(formData, "quantity");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(boughtOn) || boughtOn > new Date().toISOString().slice(0, 10)) throw new Error("Enter a valid purchase date");
  if (!buyPrice || buyPrice <= 0 || !quantity || quantity <= 0) throw new Error("Buy price and quantity must be greater than zero");

  const target = cleanNumber(formData, "projectedTarget") ?? projection.levels.target;
  const stop = cleanNumber(formData, "projectedStop") ?? projection.levels.stopLoss;
  const trail = cleanNumber(formData, "projectedTrailingStop") ?? projection.levels.trailingStop;
  const expectedDays = Math.round(cleanNumber(formData, "expectedHoldingDays") ?? projection.levels.expectedDays);
  if (target <= buyPrice || target <= stop || stop < 0 || expectedDays < 1 || expectedDays > 365) {
    throw new Error("For a buy trade, the target must be above your buy price and above the stop");
  }
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 1000) || null;
  const trailingDistance = projection.levels.atr > 0 && trail !== null
    ? projection.trailingDistance
    : null;

  await query(
    `insert into public.swing_trade_ledger
       (user_id,asset_id,market,bought_on,buy_price,quantity,currency,strategy_key,strategy_label,
        signal_verdict,signal_as_of,signal_score,projection_entry,projected_target,projected_stop,
        projected_trailing_stop,projected_atr,trailing_distance,expected_holding_days,projection_snapshot,notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21)`,
    [user.id, asset.id, market, boughtOn, buyPrice, quantity, asset.currency, strategyKey,
      projection.label, projection.row.verdict, projection.row.as_of, projection.strategyScore?.score ?? projection.row.score,
      projection.levels.entry, target, stop, trail, projection.levels.atr, trailingDistance,
      expectedDays, JSON.stringify({ levels: projection.levels, strategyScore: projection.strategyScore ?? null }), notes],
  );
  revalidatePath(`/terminal/${market.toLowerCase()}/trade-ledger`);
  redirect(`/terminal/${market.toLowerCase()}/trade-ledger?added=1`);
}

export async function closeSwingTrade(formData: FormData) {
  const user = await requireUser();
  const market = validMarket(String(formData.get("market") ?? "IN"));
  const id = String(formData.get("tradeId") ?? "");
  const closedOn = String(formData.get("closedOn") ?? "").slice(0, 10);
  const exitPrice = cleanNumber(formData, "exitPrice");
  const reason = String(formData.get("closeReason") ?? "Manual exit").trim().slice(0, 120);
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(closedOn) || !exitPrice || exitPrice <= 0) throw new Error("Enter a valid exit date and price");
  await query(
    `update public.swing_trade_ledger set status='CLOSED',closed_on=$1,exit_price=$2,close_reason=$3,updated_at=now()
      where id=$4 and user_id=$5 and status='OPEN' and bought_on <= $1`,
    [closedOn, exitPrice, reason || "Manual exit", id, user.id],
  );
  revalidatePath(`/terminal/${market.toLowerCase()}/trade-ledger`);
}

export async function deleteSwingTrade(formData: FormData) {
  const user = await requireUser();
  const market = validMarket(String(formData.get("market") ?? "IN"));
  const id = String(formData.get("tradeId") ?? "").trim();
  if (!id) throw new Error("Trade entry is required");
  await query(
    "delete from public.swing_trade_ledger where id=$1 and user_id=$2",
    [id, user.id],
  );
  revalidatePath(`/terminal/${market.toLowerCase()}/trade-ledger`);
}
