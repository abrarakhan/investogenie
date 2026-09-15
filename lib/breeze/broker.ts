import { query, queryOne } from "@/lib/db";

export interface BreezeReconciliation {
  configured: boolean;
  status: "SUCCESS" | "PARTIAL" | "FAILED" | "RUNNING" | null;
  capturedAt: string | null;
  error: string | null;
  holdingsCount: number;
  positionsCount: number;
  ordersCount: number;
  mismatches: Array<{
    ticker: string;
    exchange: string | null;
    brokerQuantity: number;
    ledgerQuantity: number;
  }>;
  rejectedOrders: Array<{
    orderId: string | null;
    stockCode: string | null;
    status: string;
    reason: string | null;
    capturedAt: string;
  }>;
}

type SyncRow = {
  status: BreezeReconciliation["status"];
  holdings_count: number;
  positions_count: number;
  orders_count: number;
  error: string | null;
  finished_at: Date | string | null;
};

export async function getBreezeReconciliation(userId: string): Promise<BreezeReconciliation> {
  const empty: BreezeReconciliation = {
    configured: false, status: null, capturedAt: null, error: null,
    holdingsCount: 0, positionsCount: 0, ordersCount: 0,
    mismatches: [], rejectedOrders: [],
  };
  try {
    const configured = await queryOne<{ configured: boolean }>(
      `select exists(
         select 1 from public.user_credentials
          where user_id=$1 and breeze_api_key_encrypted is not null
            and breeze_api_secret_encrypted is not null
            and breeze_session_token_encrypted is not null
       ) configured`,
      [userId],
    );
    const sync = await queryOne<SyncRow>(
      `select status,holdings_count,positions_count,orders_count,error,finished_at
         from public.breeze_broker_syncs where user_id=$1
        order by started_at desc limit 1`,
      [userId],
    );
    const mismatches = await query<{
      ticker: string; exchange: string | null; broker_quantity: string; ledger_quantity: string;
    }>(
      `with broker as (
         select coalesce(a.ticker,s.stock_code) ticker,
                coalesce(a.exchange,s.exchange_code) exchange,
                sum(coalesce(s.quantity,0)) broker_quantity
           from public.breeze_broker_snapshots s
           left join public.breeze_instrument_map m
             on m.exchange_code=coalesce(s.exchange_code,'NSE') and upper(m.stock_code)=upper(s.stock_code)
           left join public.assets a on a.id=m.asset_id
          where s.user_id=$1 and s.snapshot_type='HOLDING'
          group by coalesce(a.ticker,s.stock_code),coalesce(a.exchange,s.exchange_code)
       ), ledger as (
         select a.ticker,a.exchange,sum(l.quantity-coalesce(x.sold,0)) ledger_quantity
           from public.swing_trade_ledger l
           join public.assets a on a.id=l.asset_id
           left join lateral (
             select sum(e.quantity) sold from public.swing_trade_exits e where e.trade_id=l.id
           ) x on true
          where l.user_id=$1 and l.status='OPEN' and a.country='IN'
          group by a.ticker,a.exchange
       )
       select coalesce(b.ticker,l.ticker) ticker,coalesce(b.exchange,l.exchange) exchange,
              coalesce(b.broker_quantity,0)::text broker_quantity,
              coalesce(l.ledger_quantity,0)::text ledger_quantity
         from broker b full join ledger l on upper(l.ticker)=upper(b.ticker)
        where abs(coalesce(b.broker_quantity,0)-coalesce(l.ledger_quantity,0)) > 0.000001
        order by coalesce(b.ticker,l.ticker)`,
      [userId],
    );
    const rejected = await query<{
      order_id: string | null; stock_code: string | null; status: string | null;
      reason: string | null; captured_at: Date | string;
    }>(
      `select order_id,stock_code,coalesce(status,'Rejected') status,
              coalesce(raw_data->>'reason',raw_data->>'rejection_reason',raw_data->>'message') reason,
              captured_at
         from public.breeze_broker_snapshots
        where user_id=$1 and snapshot_type='ORDER'
          and (status ilike '%reject%' or raw_data::text ilike '%reject%')
        order by captured_at desc limit 10`,
      [userId],
    );
    return {
      configured: Boolean(configured?.configured),
      status: sync?.status ?? null,
      capturedAt: sync?.finished_at ? new Date(sync.finished_at).toISOString() : null,
      error: sync?.error ?? null,
      holdingsCount: Number(sync?.holdings_count ?? 0),
      positionsCount: Number(sync?.positions_count ?? 0),
      ordersCount: Number(sync?.orders_count ?? 0),
      mismatches: mismatches.map((row) => ({
        ticker: row.ticker,
        exchange: row.exchange,
        brokerQuantity: Number(row.broker_quantity),
        ledgerQuantity: Number(row.ledger_quantity),
      })),
      rejectedOrders: rejected.map((row) => ({
        orderId: row.order_id,
        stockCode: row.stock_code,
        status: row.status ?? "Rejected",
        reason: row.reason,
        capturedAt: new Date(row.captured_at).toISOString(),
      })),
    };
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return { ...empty, configured: true };
    throw error;
  }
}
