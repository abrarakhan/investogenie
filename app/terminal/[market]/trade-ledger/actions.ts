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

async function resolveSignalProjection(assetId: string, market: "IN" | "US", preferredStrategy: string, buyPrice: number) {
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
  const strategyKey = isStrongSwing
    ? "STRONG_SWING"
    : preferredStrategy && preferredScore?.dir === "LONG"
      ? preferredStrategy
      : availableLongStrategies[0]?.[0] ?? "DEFAULT_SWING";
  const setup: SwingSetup = {
    currentPrice: buyPrice,
    atr: num(row.atr), longTrigger: buyPrice, shortTrigger: num(row.short_trigger),
    hh22: Math.min(num(row.hh22) || buyPrice, buyPrice), ll22: num(row.ll22), dailyVelocity: num(row.daily_velocity),
  };
  const strategyScore = isStrongSwing ? undefined : row.strategy_scores?.[strategyKey];
  const settings = await getUserSwingSettings();
  const levels = deriveLevels(setup, "LONG", settings);
  const label = isStrongSwing
    ? "Strong Swing"
    : STRATEGY_META.find((item) => item.key === strategyKey)?.label ?? "Default Swing";
  return { row, levels, label, strategyKey, strategyScore, trailingDistance: settings.trailAtrMult * levels.atr };
}

export async function addSwingTrade(formData: FormData) {
  const user = await requireUser();
  const requestedMarket = validMarket(String(formData.get("market") ?? "IN"));
  const assetId = String(formData.get("assetId") ?? "").trim();
  const stockQuery = String(formData.get("ticker") ?? "").trim();
  const ticker = stockQuery.toUpperCase();
  const asset = await queryOne<{ id: string; ticker: string; currency: string; country: "IN" | "US" }>(
    assetId
      ? `select id,ticker,currency,country from public.assets where id=$1 and asset_class='STOCK'`
      : `select id,ticker,currency,country from public.assets
          where country=$2 and asset_class='STOCK'
            and (upper(ticker)=$1 or upper(coalesce(name,''))=$1 or upper(coalesce(name,'')) like $1 || '%')
          order by case when upper(ticker)=$1 then 0 when upper(coalesce(name,''))=$1 then 1 else 2 end,
                   case when $2='IN' and exchange='NSE' then 0 when $2='US' and exchange='NASDAQ' then 0 else 1 end
          limit 1`,
    assetId ? [assetId] : [ticker, requestedMarket],
  );
  if (!asset) throw new Error("Ticker was not found in this market");

  const market = asset.country;
  const boughtOn = String(formData.get("boughtOn") ?? "").slice(0, 10);
  const entryStatus = String(formData.get("entryStatus") ?? "OPEN") === "CLOSED" ? "CLOSED" : "OPEN";
  const buyPrice = cleanNumber(formData, "buyPrice");
  const quantity = cleanNumber(formData, "quantity");
  const today = new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(boughtOn) || boughtOn > today) throw new Error("Enter a valid purchase date");
  if (!buyPrice || buyPrice <= 0 || !quantity || quantity <= 0) throw new Error("Buy price and quantity must be greater than zero");

  const closedOn = entryStatus === "CLOSED" ? String(formData.get("closedOn") ?? "").slice(0, 10) : null;
  const exitPrice = entryStatus === "CLOSED" ? cleanNumber(formData, "exitPrice") : null;
  const closeReason = entryStatus === "CLOSED"
    ? String(formData.get("closeReason") ?? "Manual exit").trim().slice(0, 120) || "Manual exit"
    : null;
  if (entryStatus === "CLOSED" && (
    !closedOn
    || !/^\d{4}-\d{2}-\d{2}$/.test(closedOn)
    || closedOn < boughtOn
    || closedOn > today
    || !exitPrice
    || exitPrice <= 0
  )) throw new Error("Enter a valid exit date and price for the past trade");

  const preferredStrategy = String(formData.get("strategyKey") ?? "").toUpperCase();
  const projection = await resolveSignalProjection(asset.id, market, preferredStrategy, buyPrice);
  const suppliedEntry = cleanNumber(formData, "projectionEntry");
  const suppliedTarget = cleanNumber(formData, "projectedTarget");
  const suppliedStop = cleanNumber(formData, "projectedStop");
  const suppliedTrail = cleanNumber(formData, "projectedTrailingStop");
  const target = suppliedTarget !== null && suppliedTarget > buyPrice ? suppliedTarget : projection.levels.target;
  const stop = suppliedStop !== null && suppliedStop >= 0 && suppliedStop < buyPrice ? suppliedStop : projection.levels.stopLoss;
  const trail = suppliedTrail !== null && suppliedTrail >= 0 && suppliedTrail < buyPrice ? suppliedTrail : projection.levels.trailingStop;
  const expectedDays = Math.round(cleanNumber(formData, "expectedHoldingDays") ?? projection.levels.expectedDays);
  if (target <= buyPrice || target <= stop || stop < 0 || expectedDays < 1 || expectedDays > 365) {
    throw new Error("For a buy trade, the target must be above your buy price and above the stop");
  }
  const notes = null;
  const trailingDistance = projection.levels.atr > 0 && trail !== null
    ? projection.trailingDistance
    : null;

  await query(
    `insert into public.swing_trade_ledger
       (user_id,asset_id,market,status,bought_on,buy_price,quantity,currency,strategy_key,strategy_label,
        signal_verdict,signal_as_of,signal_score,projection_entry,projected_target,projected_stop,
        projected_trailing_stop,projected_atr,trailing_distance,expected_holding_days,projection_snapshot,notes,
        closed_on,exit_price,close_reason)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22,$23,$24,$25)`,
    [user.id, asset.id, market, entryStatus, boughtOn, buyPrice, quantity, asset.currency, projection.strategyKey,
      projection.label, projection.row.verdict, projection.row.as_of, projection.strategyScore?.score ?? projection.row.score,
      suppliedEntry ?? projection.levels.entry, target, stop, trail, projection.levels.atr, trailingDistance,
      expectedDays, JSON.stringify({ levels: projection.levels, strategyScore: projection.strategyScore ?? null }), notes,
      closedOn, exitPrice, closeReason],
  );
  revalidatePath(`/terminal/${market.toLowerCase()}/trade-ledger`);
  redirect(`/terminal/${market.toLowerCase()}/trade-ledger?added=1`);
}

export async function updateSwingTrade(formData: FormData) {
  const user = await requireUser();
  const market = validMarket(String(formData.get("market") ?? "IN"));
  const id = String(formData.get("tradeId") ?? "").trim();
  const boughtOn = String(formData.get("boughtOn") ?? "").slice(0, 10);
  const buyPrice = cleanNumber(formData, "buyPrice");
  const quantity = cleanNumber(formData, "quantity");
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 500) || null;
  const today = new Date().toISOString().slice(0, 10);
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(boughtOn) || boughtOn > today) throw new Error("Enter a valid purchase date");
  if (!buyPrice || buyPrice <= 0 || !quantity || quantity <= 0) throw new Error("Buy price and quantity must be greater than zero");

  const trade = await queryOne<{ status: "OPEN" | "CLOSED" }>(
    "select status from public.swing_trade_ledger where id=$1 and user_id=$2 and market=$3",
    [id, user.id, market],
  );
  if (!trade) throw new Error("Trade entry was not found");

  const closedOn = trade.status === "CLOSED" ? String(formData.get("closedOn") ?? "").slice(0, 10) : null;
  const exitPrice = trade.status === "CLOSED" ? cleanNumber(formData, "exitPrice") : null;
  const closeReason = trade.status === "CLOSED"
    ? String(formData.get("closeReason") ?? "Manual exit").trim().slice(0, 120) || "Manual exit"
    : null;
  if (trade.status === "CLOSED" && (
    !closedOn
    || !/^\d{4}-\d{2}-\d{2}$/.test(closedOn)
    || closedOn < boughtOn
    || closedOn > today
    || !exitPrice
    || exitPrice <= 0
  )) throw new Error("Enter a valid exit date and price");

  await query(
    `update public.swing_trade_ledger
        set bought_on=$1,buy_price=$2,quantity=$3,notes=$4,
            closed_on=case when status='CLOSED' then $5::date else null end,
            exit_price=case when status='CLOSED' then $6::numeric else null end,
            close_reason=case when status='CLOSED' then $7 else null end,
            updated_at=now()
      where id=$8 and user_id=$9 and market=$10`,
    [boughtOn, buyPrice, quantity, notes, closedOn, exitPrice, closeReason, id, user.id, market],
  );
  revalidatePath(`/terminal/${market.toLowerCase()}/trade-ledger`);
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
