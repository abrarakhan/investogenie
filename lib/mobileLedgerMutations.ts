import { query, queryOne, tx } from "@/lib/db";
import { resolveSignalProjection } from "@/lib/swingTradeProjection";

type Market = "IN" | "US";

function positive(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be greater than zero`);
  return number;
}

function date(value: unknown, label: string, minimum?: string): string {
  const result = String(value ?? "").slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || result > today || (minimum && result < minimum)) {
    throw new Error(`Enter a valid ${label}`);
  }
  return result;
}

function optionalLevel(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export interface CreateMobileTradeInput {
  assetId: string;
  market: Market;
  boughtOn: string;
  buyPrice: number;
  quantity: number;
  strategyKey?: string;
  projectionEntry?: number;
  projectedTarget?: number;
  projectedStop?: number;
  projectedTrailingStop?: number;
  expectedHoldingDays?: number;
}

export async function createMobileTrade(userId: string, input: CreateMobileTradeInput): Promise<string> {
  const market: Market = input.market === "US" ? "US" : "IN";
  const boughtOn = date(input.boughtOn, "purchase date");
  const buyPrice = positive(input.buyPrice, "Buy price");
  const quantity = positive(input.quantity, "Quantity");
  const asset = await queryOne<{ id: string; currency: string; country: Market }>(
    `select id,currency,country from public.assets
      where id=$1 and country=$2 and asset_class='STOCK' and is_active`,
    [input.assetId, market],
  );
  if (!asset) throw new Error("Stock was not found in this market");

  const preferredStrategy = String(input.strategyKey ?? "STRONG_SWING").toUpperCase();
  const projection = await resolveSignalProjection(asset.id, market, preferredStrategy, buyPrice, userId);
  const suppliedEntry = optionalLevel(input.projectionEntry);
  const suppliedTarget = optionalLevel(input.projectedTarget);
  const suppliedStop = optionalLevel(input.projectedStop);
  const suppliedTrail = optionalLevel(input.projectedTrailingStop);
  const target = suppliedTarget !== null && suppliedTarget > buyPrice ? suppliedTarget : projection.levels.target;
  const stop = suppliedStop !== null && suppliedStop >= 0 && suppliedStop < buyPrice ? suppliedStop : projection.levels.stopLoss;
  const trail = suppliedTrail !== null && suppliedTrail >= 0 && suppliedTrail < buyPrice ? suppliedTrail : projection.levels.trailingStop;
  const expectedDays = Math.round(Number(input.expectedHoldingDays ?? projection.levels.expectedDays));
  if (target <= buyPrice || target <= stop || stop < 0 || expectedDays < 1 || expectedDays > 365) {
    throw new Error("For a buy trade, the target must be above your buy price and above the stop");
  }
  const trailingDistance = projection.levels.atr > 0 && trail !== null ? projection.trailingDistance : null;
  const inserted = await queryOne<{ id: string }>(
    `insert into public.swing_trade_ledger
       (user_id,asset_id,market,status,bought_on,buy_price,quantity,currency,strategy_key,strategy_label,
        signal_verdict,signal_as_of,signal_score,projection_entry,projected_target,projected_stop,
        projected_trailing_stop,projected_atr,trailing_distance,expected_holding_days,projection_snapshot,notes)
     values ($1,$2,$3,'OPEN',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,null)
     returning id`,
    [userId, asset.id, market, boughtOn, buyPrice, quantity, asset.currency, projection.strategyKey,
      projection.label, projection.row.verdict, projection.row.as_of,
      projection.strategyScore?.score ?? projection.row.score, suppliedEntry ?? projection.levels.entry,
      target, stop, trail, projection.levels.atr, trailingDistance, expectedDays,
      JSON.stringify({ levels: projection.levels, strategyScore: projection.strategyScore ?? null })],
  );
  if (!inserted) throw new Error("Trade could not be recorded");
  return inserted.id;
}

export async function updateMobileTrade(userId: string, tradeId: string, input: {
  market: Market; boughtOn: string; buyPrice: number; quantity: number; notes?: string;
}): Promise<void> {
  const market: Market = input.market === "US" ? "US" : "IN";
  const boughtOn = date(input.boughtOn, "purchase date");
  const buyPrice = positive(input.buyPrice, "Buy price");
  const quantity = positive(input.quantity, "Quantity");
  const trade = await queryOne<{ sold_quantity: string }>(
    `select coalesce(sum(e.quantity),0)::text sold_quantity
       from public.swing_trade_ledger l left join public.swing_trade_exits e on e.trade_id=l.id
      where l.id=$1 and l.user_id=$2 and l.market=$3 group by l.id`,
    [tradeId, userId, market],
  );
  if (!trade) throw new Error("Trade entry was not found");
  if (quantity + 0.000001 < Number(trade.sold_quantity)) throw new Error("Quantity cannot be below shares already sold");
  await query(
    `update public.swing_trade_ledger
        set bought_on=$1,buy_price=$2,quantity=$3,notes=$4,updated_at=now()
      where id=$5 and user_id=$6 and market=$7`,
    [boughtOn, buyPrice, quantity, String(input.notes ?? "").trim().slice(0, 500) || null, tradeId, userId, market],
  );
}

async function synchronizeTradeClosure(client: import("pg").PoolClient, tradeId: string, originalQuantity: number) {
  const totals = (await client.query<{
    sold_quantity: string; average_price: string | null; closed_on: string | null; close_reason: string | null;
  }>(
    `select coalesce(sum(quantity),0)::text sold_quantity,
            (sum(quantity * exit_price) / nullif(sum(quantity),0))::text average_price,
            max(sold_on)::text closed_on,
            (array_agg(reason order by sold_on desc,created_at desc))[1] close_reason
       from public.swing_trade_exits where trade_id=$1`,
    [tradeId],
  )).rows[0];
  const fullySold = Number(totals.sold_quantity) >= originalQuantity - 0.000001;
  await client.query(
    `update public.swing_trade_ledger
        set status=$1,closed_on=case when $1='CLOSED' then $2::date else null end,
            exit_price=case when $1='CLOSED' then $3::numeric else null end,
            close_reason=case when $1='CLOSED' then $4 else null end,updated_at=now()
      where id=$5`,
    [fullySold ? "CLOSED" : "OPEN", totals.closed_on, totals.average_price ? Number(totals.average_price) : null, totals.close_reason, tradeId],
  );
}

export async function recordMobileTradeSale(userId: string, tradeId: string, input: {
  market: Market; soldOn: string; quantity: number; exitPrice: number; reason?: string;
}): Promise<void> {
  const market: Market = input.market === "US" ? "US" : "IN";
  const soldQuantity = positive(input.quantity, "Sale quantity");
  const exitPrice = positive(input.exitPrice, "Sale price");
  await tx(async (client) => {
    const trade = (await client.query<{ quantity: string; bought_on: string }>(
      `select quantity,bought_on::text from public.swing_trade_ledger
        where id=$1 and user_id=$2 and market=$3 and status='OPEN' for update`,
      [tradeId, userId, market],
    )).rows[0];
    if (!trade) throw new Error("Open trade entry was not found");
    const soldOn = date(input.soldOn, "sale date", trade.bought_on);
    const alreadySold = Number((await client.query<{ quantity: string }>(
      "select coalesce(sum(quantity),0)::text quantity from public.swing_trade_exits where trade_id=$1",
      [tradeId],
    )).rows[0]?.quantity ?? 0);
    const originalQuantity = Number(trade.quantity);
    if (soldQuantity > originalQuantity - alreadySold + 0.000001) throw new Error("Sale quantity exceeds shares remaining");
    await client.query(
      `insert into public.swing_trade_exits(trade_id,user_id,sold_on,quantity,exit_price,sale_value,reason)
       values($1,$2,$3,$4,$5,$4*$5,$6)`,
      [tradeId, userId, soldOn, soldQuantity, exitPrice, String(input.reason ?? "Manual exit").slice(0, 120)],
    );
    await synchronizeTradeClosure(client, tradeId, originalQuantity);
  });
}

export async function updateMobileTradeSale(userId: string, tradeId: string, saleId: string, input: {
  market: Market; soldOn: string; quantity: number; exitPrice: number; reason?: string;
}): Promise<void> {
  const market: Market = input.market === "US" ? "US" : "IN";
  const soldQuantity = positive(input.quantity, "Sale quantity");
  const exitPrice = positive(input.exitPrice, "Sale price");
  await tx(async (client) => {
    const trade = (await client.query<{ quantity: string; bought_on: string }>(
      `select quantity,bought_on::text from public.swing_trade_ledger
        where id=$1 and user_id=$2 and market=$3 for update`,
      [tradeId, userId, market],
    )).rows[0];
    if (!trade) throw new Error("Trade entry was not found");
    const soldOn = date(input.soldOn, "sale date", trade.bought_on);
    const sale = (await client.query(
      `select id from public.swing_trade_exits where id=$1 and trade_id=$2 and user_id=$3 for update`,
      [saleId, tradeId, userId],
    )).rows[0];
    if (!sale) throw new Error("Recorded sale was not found");
    const otherSold = Number((await client.query<{ quantity: string }>(
      `select coalesce(sum(quantity),0)::text quantity from public.swing_trade_exits
        where trade_id=$1 and id<>$2`,
      [tradeId, saleId],
    )).rows[0]?.quantity ?? 0);
    const originalQuantity = Number(trade.quantity);
    if (soldQuantity > originalQuantity - otherSold + 0.000001) throw new Error("Sale quantity exceeds shares available");
    await client.query(
      `update public.swing_trade_exits set sold_on=$1,quantity=$2,exit_price=$3,sale_value=$2*$3,realized_pnl=null,reason=$4,updated_at=now()
        where id=$5`,
      [soldOn, soldQuantity, exitPrice, String(input.reason ?? "Manual exit").slice(0, 120), saleId],
    );
    await synchronizeTradeClosure(client, tradeId, originalQuantity);
  });
}

export async function deleteMobileTrade(userId: string, tradeId: string): Promise<void> {
  const rows = await query<{ id: string }>(
    "delete from public.swing_trade_ledger where id=$1 and user_id=$2 returning id",
    [tradeId, userId],
  );
  if (!rows.length) throw new Error("Trade entry was not found");
}
