import { query } from "@/lib/db";

export type HoldingSource = "ICICI" | "MUTUAL_FUND";

export interface ConsolidatedHolding {
  key: string;
  source: HoldingSource;
  ticker: string;
  name: string | null;
  quantity: number;
  /** Price used for value: latest quote/NAV, else the statement price. */
  price: number | null;
  priceSource: "LIVE" | "STATEMENT" | null;
  value: number | null;
  invested: number | null;
  asOf: string | null;
  /** The price is more than five days old, so the value is not current. */
  stale: boolean;
  /** Latest one-day move, only when the price is a current AMFI NAV / quote. */
  dayChangePct: number | null;
  dayChange: number | null;
}

export interface ConsolidatedHoldings {
  holdings: ConsolidatedHolding[];
  totals: Record<HoldingSource, { value: number; count: number; unpriced: number; stale: number }>;
  totalValue: number;
  iciciCapturedAt: string | null;
  fundStatementDate: string | null;
}

const num = (value: string | number | null | undefined) => value === null || value === undefined ? null : Number(value);
const iso = (value: Date | string | null) => value ? new Date(value).toISOString() : null;
const STALE_AFTER_MS = 5 * 86_400_000;
const isStale = (asOf: string | null) => !asOf || Date.now() - Date.parse(asOf) > STALE_AFTER_MS;

/** Rupee move implied by today's % change: value - value / (1 + pct). */
function dayMove(value: number | null, pct: number | null, current: boolean) {
  if (!current || value === null || pct === null || !Number.isFinite(pct) || pct <= -100) {
    return { dayChangePct: null, dayChange: null };
  }
  return { dayChangePct: pct, dayChange: value - value / (1 + pct / 100) };
}

/**
 * India holdings across sources for the Terminal:
 * - ICICI demat holdings from the latest Breeze account sync, valued at the latest quote.
 * - Mutual funds from the imported CAS, valued at the latest NAV, else the statement value.
 * CAS equity lines are excluded: they describe the same demat shares as the live ICICI feed
 * (as of an older statement), so including both would double-count the stocks.
 */
export async function getConsolidatedIndiaHoldings(userId: string): Promise<ConsolidatedHoldings> {
  const [icici, funds] = await Promise.all([
    query<{
      id: string; stock_code: string | null; quantity: string | number | null; captured_at: Date | string;
      ticker: string | null; name: string | null; isin: string | null;
      broker_price: string | number | null; broker_avg: string | number | null; broker_change: string | null;
      live_price: string | number | null; live_change: string | number | null; live_at: Date | string | null;
    }>(
      // ICICI holdings are valued only from Breeze: the broker's own price and average cost
      // captured with the holding, or a newer Breeze live tick. Exchange-file or Yahoo quotes
      // are deliberately not used here.
      `select s.id::text,s.stock_code,s.quantity,s.captured_at,a.ticker,a.name,
              s.raw_data->>'stock_ISIN' isin,
              s.market_price broker_price,s.average_price broker_avg,s.raw_data->>'change_percentage' broker_change,
              q.price live_price,q.change_pct live_change,q.updated_at live_at
         from public.breeze_broker_snapshots s
         left join public.breeze_instrument_map m
           on m.exchange_code=coalesce(s.exchange_code,'NSE') and upper(m.stock_code)=upper(s.stock_code)
         left join public.assets a on a.id=m.asset_id
         left join public.latest_quotes q on q.asset_id=a.id and q.source='BREEZE_LIVE' 
        where s.user_id=$1 and s.snapshot_type='HOLDING' and coalesce(s.quantity,0) > 0
        order by coalesce(a.ticker,s.stock_code)`,
      [userId],
    ).catch((error) => {
      if ((error as { code?: string }).code === "42P01") return [];
      throw error;
    }),
    query<{
      holding_id: string; ticker: string; name: string | null; quantity: string | number; avg_cost: string | number | null;
      nav: string | number | null; nav_as_of: Date | string | null; nav_source: string | null;
      nav_change_pct: string | number | null; statement_value: string | number | null;
      cost_value: string | number | null; statement_date: Date | string | null;
    }>(
      `select h.id holding_id,a.ticker,a.name,h.quantity,h.avg_cost,q.price nav,q.as_of nav_as_of,
              q.source nav_source,q.change_pct nav_change_pct,
              chd.market_value statement_value,chd.cost_value,coalesce(chd.as_of_date,chd.imported_at::date) statement_date
         from public.holdings h
         join public.assets a on a.id=h.asset_id
         left join public.latest_quotes q on q.asset_id=a.id
         left join public.cas_holding_details chd on chd.holding_id=h.id and chd.user_id=h.user_id
        where h.user_id=$1 and a.asset_class='MUTUAL_FUND'::asset_class and h.quantity > 0
        order by coalesce(chd.market_value,0) desc,a.ticker`,
      [userId],
    ),
  ]);

  const holdings: ConsolidatedHolding[] = [];
  for (const row of icici) {
    const quantity = Number(row.quantity ?? 0);
    const brokerPrice = num(row.broker_price);
    const livePrice = num(row.live_price);
    const capturedAt = iso(row.captured_at);
    const liveAt = iso(row.live_at);
    const useLive = livePrice !== null && livePrice > 0 && liveAt !== null
      && (brokerPrice === null || (capturedAt !== null && Date.parse(liveAt) > Date.parse(capturedAt)));
    const price = useLive ? livePrice : brokerPrice !== null && brokerPrice > 0 ? brokerPrice : null;
    const asOf = useLive ? liveAt : capturedAt;
    const average = num(row.broker_avg);
    const value = price === null ? null : price * quantity;
    holdings.push({
      key: `icici:${row.id}`, source: "ICICI", ticker: row.ticker ?? row.stock_code ?? row.isin ?? "Unmapped",
      name: row.name, quantity, price, priceSource: price === null ? null : "LIVE",
      value, invested: average !== null && average > 0 ? average * quantity : null,
      asOf,
      stale: price !== null && isStale(asOf),
      ...dayMove(value, useLive ? num(row.live_change) : num(row.broker_change), price !== null && !isStale(asOf)),
    });
  }
  for (const row of funds) {
    const units = Number(row.quantity);
    const nav = num(row.nav);
    const statementValue = num(row.statement_value);
    const live = nav !== null && nav > 0;
    const value = live ? nav * units : statementValue;
    const cost = num(row.cost_value);
    holdings.push({
      key: `mf:${row.holding_id}`, source: "MUTUAL_FUND", ticker: row.ticker, name: row.name, quantity: units,
      price: live ? nav : statementValue !== null && units > 0 ? statementValue / units : null,
      priceSource: live ? "LIVE" : statementValue !== null ? "STATEMENT" : null,
      value, invested: cost !== null && cost > 0 ? cost : null,
      asOf: live ? iso(row.nav_as_of) : iso(row.statement_date),
      stale: value !== null && isStale(live ? iso(row.nav_as_of) : iso(row.statement_date)),
      ...dayMove(value, num(row.nav_change_pct), live && row.nav_source === "AMFI_NAV" && !isStale(iso(row.nav_as_of))),
    });
  }

  const totals: ConsolidatedHoldings["totals"] = {
    ICICI: { value: 0, count: 0, unpriced: 0, stale: 0 },
    MUTUAL_FUND: { value: 0, count: 0, unpriced: 0, stale: 0 },
  };
  for (const holding of holdings) {
    const bucket = totals[holding.source];
    bucket.count++;
    if (holding.stale) bucket.stale++;
    if (holding.value === null) bucket.unpriced++;
    else bucket.value += holding.value;
  }
  const statementDates = funds.map((row) => iso(row.statement_date)).filter((value): value is string => Boolean(value)).sort();
  return {
    holdings,
    totals,
    totalValue: totals.ICICI.value + totals.MUTUAL_FUND.value,
    iciciCapturedAt: icici.map((row) => iso(row.captured_at)).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null,
    fundStatementDate: statementDates.at(-1) ?? null,
  };
}
