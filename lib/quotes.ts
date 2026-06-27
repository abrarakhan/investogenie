// Latest quotes by asset id → Map<assetId, Quote>, via direct SQL.
import { query } from "@/lib/db";
import { MARKETS, MARKET_COUNTRY } from "@/lib/markets";
import type { LiveMarketQuotes, MarketId, TickerQuote } from "@/lib/types";

export interface Quote {
  price: number;
  changePct: number | null;
  currency: string | null;
  asOf: string | null;
}

interface Row {
  asset_id: string;
  price: string | number;
  change_pct: string | number | null;
  currency: string | null;
  as_of: string | null;
}

export async function getQuotesByAssetIds(ids: string[]): Promise<Map<string, Quote>> {
  const map = new Map<string, Quote>();
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return map;

  const rows = await query<Row>(
    "select asset_id, price, change_pct, currency, as_of from public.latest_quotes where asset_id = any($1)",
    [unique],
  );
  for (const q of rows) {
    map.set(q.asset_id, {
      price: Number(q.price),
      changePct: q.change_pct === null ? null : Number(q.change_pct),
      currency: q.currency ?? null,
      asOf: q.as_of ?? null,
    });
  }
  return map;
}

export async function getLiveMarketQuotes(): Promise<LiveMarketQuotes> {
  const result = {} as LiveMarketQuotes;

  for (const marketId of Object.keys(MARKETS) as MarketId[]) {
    const cfg = MARKETS[marketId];
    const instruments = [...cfg.tickers, ...cfg.benchmarks];
    const rows = await query<{
      ticker: string;
      price: string | number;
      change_pct: string | number | null;
    }>(
      `select a.ticker, q.price, q.change_pct
         from public.assets a
         join public.latest_quotes q on q.asset_id = a.id
        where a.country = $1 and a.ticker = any($2)`,
      [MARKET_COUNTRY[marketId], instruments.map((item) => item.ticker)],
    );
    const live = new Map(rows.map((row) => [row.ticker, row]));
    const hydrate = (items: typeof instruments): TickerQuote[] =>
      items.flatMap((item) => {
        const quote = live.get(item.ticker);
        if (!quote) return [];
        return [{
          ...item,
          last: Number(quote.price),
          changePct: quote.change_pct === null ? null : Number(quote.change_pct),
        }];
      });

    result[marketId] = {
      tickers: hydrate(cfg.tickers),
      benchmarks: hydrate(cfg.benchmarks),
    };
  }

  return result;
}
