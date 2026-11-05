import { query } from "@/lib/db";

interface RecordedPositionRow {
  ledger_id: string;
  asset_id: string;
  ticker: string;
  name: string | null;
  asset_class: string;
  exchange: string | null;
  currency: string;
  country: string;
  quantity: string | number;
  sold_quantity: string | number;
  buy_price: string | number;
  strategy_label: string;
}

export interface RecordedLedgerPosition {
  id: string;
  quantity: number;
  avgCost: number;
  sourceLabel: string;
  asset: {
    id: string;
    ticker: string;
    name: string | null;
    asset_class: string;
    exchange: string | null;
    currency: string;
    country: string;
  };
}

export function mapRecordedPositionRows(rows: RecordedPositionRow[]): RecordedLedgerPosition[] {
  return rows.flatMap((row) => {
    const remaining = Math.max(0, Number(row.quantity) - Number(row.sold_quantity));
    if (!Number.isFinite(remaining) || remaining <= 0) return [];
    return [{
      id: `ledger:${row.ledger_id}`,
      quantity: remaining,
      avgCost: Number(row.buy_price),
      sourceLabel: row.strategy_label,
      asset: {
        id: row.asset_id,
        ticker: row.ticker,
        name: row.name,
        asset_class: row.asset_class,
        exchange: row.exchange,
        currency: row.currency,
        country: row.country,
      },
    }];
  });
}

/** Open, user-recorded swing positions for the Terminal portfolio card. */
export async function getRecordedLedgerPositions(userId: string, market: "IN" | "US") {
  const rows = await query<RecordedPositionRow>(
    `select l.id ledger_id,l.asset_id,a.ticker,a.name,a.asset_class::text asset_class,
            a.exchange,a.currency,a.country,l.quantity,l.buy_price,l.strategy_label,
            coalesce(exits.sold_quantity,0) sold_quantity
       from public.swing_trade_ledger l
       join public.assets a on a.id=l.asset_id
       left join lateral (
         select sum(e.quantity) sold_quantity
           from public.swing_trade_exits e
          where e.trade_id=l.id
       ) exits on true
      where l.user_id=$1 and l.market=$2 and l.status='OPEN'
      order by l.bought_on desc,l.created_at desc`,
    [userId, market],
  );
  return mapRecordedPositionRows(rows);
}
