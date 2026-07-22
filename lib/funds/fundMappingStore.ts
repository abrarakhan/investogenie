import { query } from "@/lib/db";
import { inferAmc, suggestFundMapping, summarizeMapping, type FundMatchSuggestion, type SnapshotSchemeForMapping, type UserFundForMapping } from "@/lib/funds/fundMapping";
import type { MatchStatus } from "@/lib/status";

export interface SnapshotWithMapping extends SnapshotSchemeForMapping {
  mappedHoldingId: string | null;
  mappedFundName: string | null;
}

export interface UserFundMappingRow extends UserFundForMapping {
  displayStatus: MatchStatus;
  suggestion: FundMatchSuggestion;
}

export interface FundMappingData {
  funds: UserFundMappingRow[];
  snapshots: SnapshotWithMapping[];
  summary: { imported: number; matched: number; rejected: number; pending: number };
}

interface FundRow {
  holding_id: string;
  asset_id: string;
  ticker: string;
  name: string | null;
  isin: string | null;
  quantity: string | number;
  avg_cost: string | number | null;
  quote_price: string | number | null;
  category: string | null;
  mapped_scheme_code: string | null;
  mapping_status: "matched" | "rejected" | null;
}

interface SnapshotRow {
  scheme_code: string;
  name: string;
  isin: string | null;
  amc: string | null;
  category: string | null;
  latest_month: Date | string | null;
  holding_count: string | number;
  mapped_holding_id: string | null;
  mapped_fund_name: string | null;
}

const dateOnly = (value: Date | string | null): string | null => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
};

export async function getFundMappingData(userId: string): Promise<FundMappingData> {
  const [fundRows, snapshotRows] = await Promise.all([
    query<FundRow>(
      `select h.id holding_id, a.id asset_id, a.ticker, a.name,
              nullif(m.amfi_code_in, '') isin,
              h.quantity, h.avg_cost, q.price quote_price, m.category,
              map.scheme_code mapped_scheme_code, map.status mapping_status
         from public.holdings h
         join public.assets a on a.id = h.asset_id
         left join public.mutual_fund_meta m on m.asset_id = a.id
         left join public.latest_quotes q on q.asset_id = a.id
         left join public.user_fund_mappings map on map.user_id = h.user_id and map.user_holding_id = h.id
        where h.user_id = $1 and a.asset_class = 'MUTUAL_FUND' and h.quantity > 0
        order by h.updated_at desc`,
      [userId],
    ),
    query<SnapshotRow>(
      `select fs.scheme_code, fs.name, fs.isin, fs.amc, fs.category, fs.latest_month,
              count(fhs.instrument_isin)::text holding_count,
              mapped.user_holding_id mapped_holding_id,
              mapped.fund_name mapped_fund_name
         from public.fund_schemes fs
         left join public.fund_holdings_snapshot fhs
           on fhs.scheme_code = fs.scheme_code
          and fhs.month = fs.latest_month
         left join lateral (
           select map.user_holding_id, a.name fund_name
             from public.user_fund_mappings map
             join public.holdings h on h.id = map.user_holding_id
             join public.assets a on a.id = h.asset_id
            where map.scheme_code = fs.scheme_code and map.status = 'matched' and map.user_id = $1
            order by map.matched_at desc nulls last
            limit 1
         ) mapped on true
        group by fs.scheme_code, fs.name, fs.isin, fs.amc, fs.category, fs.latest_month, mapped.user_holding_id, mapped.fund_name
        order by fs.amc nulls last, fs.name`,
      [userId],
    ),
  ]);

  const snapshots: SnapshotWithMapping[] = snapshotRows.map((row) => ({
    schemeCode: row.scheme_code,
    name: row.name,
    isin: row.isin,
    amc: row.amc,
    category: row.category,
    snapshotMonth: dateOnly(row.latest_month),
    holdingCount: Number(row.holding_count),
    mappedHoldingId: row.mapped_holding_id,
    mappedFundName: row.mapped_fund_name,
  }));

  const funds = fundRows.map<UserFundMappingRow>((row) => {
    const name = row.name ?? row.ticker;
    const nav = Number(row.quote_price ?? row.avg_cost ?? 0);
    const fund: UserFundForMapping = {
      holdingId: row.holding_id,
      assetId: row.asset_id,
      fundName: name,
      isin: row.isin ?? (/^INF|^INA/.test(row.ticker) ? row.ticker : null),
      amc: inferAmc(name, row.isin ?? row.ticker),
      currentValue: Number(row.quantity) * (nav > 0 ? nav : 100),
      mappedSchemeCode: row.mapped_scheme_code,
      mappingStatus: row.mapping_status,
    };
    const suggestion = suggestFundMapping(fund, snapshots);
    return { ...fund, displayStatus: suggestion.status, suggestion };
  }).sort((a, b) => {
    const order: Record<MatchStatus, number> = { pending: 0, ambiguous: 1, rejected: 2, matched: 3, no_snapshot: 4 };
    return order[a.displayStatus] - order[b.displayStatus] || b.currentValue - a.currentValue;
  });

  return { funds, snapshots, summary: summarizeMapping(funds) };
}

export async function countSnapshotStocks(schemeCode: string): Promise<number> {
  const rows = await query<{ count: string }>(
    `select count(*)::text
       from public.fund_holdings_snapshot fhs
      where fhs.scheme_code = $1
        and fhs.month = (select max(month) from public.fund_holdings_snapshot where scheme_code = $1)
        and fhs.instrument_type = 'EQUITY'`,
    [schemeCode],
  );
  return Number(rows[0]?.count ?? 0);
}
