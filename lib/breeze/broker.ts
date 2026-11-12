import { query, queryOne } from "@/lib/db";

export interface BreezeReconciliation {
  scopeStart: string;
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
  /** Open NSE cash orders as of the last reconciliation; the broker is re-read before any change. */
  openOrders: Array<{
    orderId: string;
    name: string;
    action: string | null;
    status: string;
    orderType: string | null;
    quantity: number | null;
    pendingQuantity: number | null;
    price: number | null;
    capturedAt: string;
  }>;
  /** Live order updates pushed by the broker over the last two days, newest first. */
  liveOrderUpdates: Array<{
    id: string;
    name: string;
    action: string | null;
    status: string;
    quantity: number | null;
    executedQuantity: number | null;
    receivedAt: string;
  }>;
}

type SyncRow = {
  status: BreezeReconciliation["status"];
  holdings_count: number;
  positions_count: number;
  orders_count: number;
  error: string | null;
  started_at: Date | string;
  finished_at: Date | string | null;
};

export function isSyncOlderThanSession(
  syncStartedAt: Date | string | null | undefined,
  sessionUpdatedAt: Date | string | null | undefined,
): boolean {
  if (!syncStartedAt || !sessionUpdatedAt) return false;
  return new Date(syncStartedAt).getTime() < new Date(sessionUpdatedAt).getTime();
}

export function summarizeReconciliationError(error: string | null): string | null {
  if (!error) return null;
  const messages = error.split("; ").map((message) => message.trim()).filter(Boolean);
  const counts = new Map<string, number>();
  for (const message of messages) counts.set(message, (counts.get(message) ?? 0) + 1);
  return [...counts].map(([message, count]) => (
    count > 1 ? `${message} (repeated ${count} times)` : message
  )).join("; ");
}

export async function getBreezeReconciliation(userId: string): Promise<BreezeReconciliation> {
  const scopeStart = "2026-08-01";
  const empty: BreezeReconciliation = {
    scopeStart,
    configured: false, status: null, capturedAt: null, error: null,
    holdingsCount: 0, positionsCount: 0, ordersCount: 0,
    mismatches: [], rejectedOrders: [], liveOrderUpdates: [], openOrders: [],
  };
  try {
    const credential = await queryOne<{ configured: boolean; session_updated_at: Date | string | null }>(
      `select breeze_api_key_encrypted is not null
              and breeze_api_secret_encrypted is not null
              and breeze_session_token_encrypted is not null configured,
              breeze_session_updated_at session_updated_at
         from public.user_credentials where user_id=$1`,
      [userId],
    );
    const sync = await queryOne<SyncRow>(
      `select status,holdings_count,positions_count,orders_count,error,started_at,finished_at
         from public.breeze_broker_syncs where user_id=$1
        order by started_at desc limit 1`,
      [userId],
    );
    const superseded = isSyncOlderThanSession(sync?.started_at, credential?.session_updated_at);
    const scopedCounts = await queryOne<{ holdings_count: string; positions_count: string }>(
      `with tracked as (
         select distinct upper(a.ticker) ticker
           from public.swing_trade_ledger l join public.assets a on a.id=l.asset_id
          where l.user_id=$1 and l.market='IN' and l.bought_on >= $2::date
       ), scoped as (
         select s.snapshot_type,coalesce(a.ticker,s.stock_code) ticker
           from public.breeze_broker_snapshots s
           left join public.breeze_instrument_map m
             on m.exchange_code=coalesce(s.exchange_code,'NSE') and upper(m.stock_code)=upper(s.stock_code)
           left join public.assets a on a.id=m.asset_id
          where s.user_id=$1 and s.snapshot_type in ('HOLDING','POSITION')
            and upper(coalesce(a.ticker,s.stock_code)) in (select ticker from tracked)
       )
       select count(distinct ticker) filter(where snapshot_type='HOLDING')::text holdings_count,
              count(distinct ticker) filter(where snapshot_type='POSITION')::text positions_count
         from scoped`,
      [userId, scopeStart],
    );
    const mismatches = await query<{
      ticker: string; exchange: string | null; broker_quantity: string; ledger_quantity: string;
    }>(
      `with tracked as (
         select distinct upper(a.ticker) ticker
           from public.swing_trade_ledger l join public.assets a on a.id=l.asset_id
          where l.user_id=$1 and l.market='IN' and l.bought_on >= $2::date
       ), broker as (
         select coalesce(a.ticker,s.stock_code) ticker,
                coalesce(a.exchange,s.exchange_code) exchange,
                sum(case
                  when s.snapshot_type='POSITION' and lower(coalesce(s.action,''))='sell'
                    then -abs(coalesce(s.quantity,0))
                  else coalesce(s.quantity,0)
                end) broker_quantity
           from public.breeze_broker_snapshots s
           left join public.breeze_instrument_map m
             on m.exchange_code=coalesce(s.exchange_code,'NSE') and upper(m.stock_code)=upper(s.stock_code)
           left join public.assets a on a.id=m.asset_id
          where s.user_id=$1 and s.snapshot_type in ('HOLDING','POSITION')
            and upper(coalesce(a.ticker,s.stock_code)) in (select ticker from tracked)
          group by coalesce(a.ticker,s.stock_code),coalesce(a.exchange,s.exchange_code)
       ), ledger as (
         select a.ticker,a.exchange,sum(l.quantity-coalesce(x.sold,0)) ledger_quantity
           from public.swing_trade_ledger l
           join public.assets a on a.id=l.asset_id
           left join lateral (
             select sum(e.quantity) sold from public.swing_trade_exits e where e.trade_id=l.id
           ) x on true
          where l.user_id=$1 and l.status='OPEN' and a.country='IN' and l.bought_on >= $2::date
          group by a.ticker,a.exchange
       )
       select coalesce(b.ticker,l.ticker) ticker,coalesce(b.exchange,l.exchange) exchange,
              coalesce(b.broker_quantity,0)::text broker_quantity,
              coalesce(l.ledger_quantity,0)::text ledger_quantity
         from broker b full join ledger l on upper(l.ticker)=upper(b.ticker)
        where abs(coalesce(b.broker_quantity,0)-coalesce(l.ledger_quantity,0)) > 0.000001
        order by coalesce(b.ticker,l.ticker)`,
      [userId, scopeStart],
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
          and captured_at >= $2::date
          and (status ilike '%reject%' or raw_data::text ilike '%reject%')
        order by captured_at desc limit 10`,
      [userId, scopeStart],
    );
    const open = superseded ? [] : await query<{
      order_id: string; name: string | null; action: string | null; status: string; order_type: string | null;
      quantity: string | null; pending_quantity: string | null; price: string | null; captured_at: Date | string;
    }>(
      `select s.order_id,coalesce(a.ticker,s.stock_code) name,s.action,s.status,
              s.raw_data->>'order_type' order_type,s.quantity,
              nullif(s.raw_data->>'pending_quantity','')::numeric pending_quantity,
              nullif(s.raw_data->>'price','')::numeric price,s.captured_at
         from public.breeze_broker_snapshots s
         left join public.breeze_instrument_map m
           on m.exchange_code=s.exchange_code and upper(m.stock_code)=upper(s.stock_code)
         left join public.assets a on a.id=m.asset_id
        where s.user_id=$1 and s.snapshot_type='ORDER' and s.exchange_code='NSE' and s.order_id is not null
          and lower(s.status) in ('ordered','requested','queued','partially executed')
          and s.captured_at >= now() - interval '1 day'
        order by s.captured_at desc,s.order_id limit 20`,
      [userId],
    );
    // Shown newest first; a table that predates this feature simply has no rows.
    const live = await query<{
      id: string; name: string | null; action: string | null; status: string;
      quantity: string | null; executed_quantity: string | null; received_at: Date | string;
    }>(
      `select e.id::text,coalesce(a.ticker,e.stock_code) name,e.action,e.status,
              e.quantity,e.executed_quantity,e.received_at
         from public.breeze_order_events e
         left join public.assets a on a.id=e.asset_id
        where e.user_id=$1 and e.received_at >= now() - interval '2 days'
        order by e.received_at desc,e.id desc limit 8`,
      [userId],
    ).catch((error: { code?: string }) => {
      if (error.code === "42P01") return [];
      throw error;
    });
    return {
      openOrders: open.map((row) => ({
        orderId: row.order_id,
        name: row.name ?? "Order",
        action: row.action,
        status: row.status,
        orderType: row.order_type,
        quantity: row.quantity === null ? null : Number(row.quantity),
        pendingQuantity: row.pending_quantity === null ? null : Number(row.pending_quantity),
        price: row.price === null ? null : Number(row.price),
        capturedAt: new Date(row.captured_at).toISOString(),
      })),
      liveOrderUpdates: live.map((row) => ({
        id: row.id,
        name: row.name ?? "Order",
        action: row.action,
        status: row.status,
        quantity: row.quantity === null ? null : Number(row.quantity),
        executedQuantity: row.executed_quantity === null ? null : Number(row.executed_quantity),
        receivedAt: new Date(row.received_at).toISOString(),
      })),
      configured: Boolean(credential?.configured),
      scopeStart,
      status: superseded ? "RUNNING" : sync?.status ?? null,
      capturedAt: superseded ? null : sync?.finished_at ? new Date(sync.finished_at).toISOString() : null,
      error: superseded ? null : summarizeReconciliationError(sync?.error ?? null),
      holdingsCount: Number(scopedCounts?.holdings_count ?? 0),
      positionsCount: Number(scopedCounts?.positions_count ?? 0),
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
