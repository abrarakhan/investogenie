import { query } from "@/lib/db";
import {
  ARMED_SWING_RULES,
  assessArmedSwing,
  rankArmedSwingCandidates,
  resultsCalendarCoverage,
  type ArmedSwingAssessment,
} from "@/lib/analytics/armedSwing";
import {
  isMarketOpenNow,
  latestExpectedSessionDate,
  refreshMarketHolidays,
  tradingSessionLag,
  zonedMarketClock,
} from "@/lib/market-calendar.mjs";
import type { SwingSettings } from "@/lib/settings";
import type { OHLCV } from "@/lib/types";

export interface ArmedSwingCandidate extends ArmedSwingAssessment {
  assetId: string;
  ticker: string;
  name: string | null;
  exchange: string;
  country: "IN" | "US";
  currentPrice: number;
  rank: number;
}

export interface ArmedSwingResult {
  candidates: ArmedSwingCandidate[];
  universeCount: number;
  scannedCount: number;
  marketOpen: boolean;
  sessionDate: string;
  /** Assessed bases whose results calendar is verified; the rest cannot become actionable. */
  resultsVerifiedCount: number;
}

type BarRow = {
  asset_id: string; date: string; open: string | number; high: string | number; low: string | number;
  close: string | number; volume: string | number | null; open_interest: string | number | null;
};

type ShortlistRow = {
  asset_id: string; ticker: string; name: string | null; exchange: string;
  current_price: string | number | null; rs_percentile: string | number | null;
  best_bid: string | number | null; best_ask: string | number | null;
  lower_circuit: string | number | null; upper_circuit: string | number | null;
  quote_source: string | null; quote_updated_at: string | null;
};

type ResultsRow = {
  asset_id: string; next_date: string | null; last_past_date: string | null; last_success_at: string | null;
};

const CONFIG = {
  IN: {
    universeWhere: "a.country='IN' and a.exchange='NSE'",
    benchmarkTickers: ["NIFTY", "NIFTYBEES"],
    priceFloor: 20,
    liquidityFloor: 10_000_000,
    openMinutes: 9 * 60 + 15,
    closeMinutes: 15 * 60 + 30,
  },
  US: {
    universeWhere: "a.country='US' and a.exchange in ('NASDAQ','NYSE','AMEX','NYSEARCA','NYSEAMERICAN')",
    benchmarkTickers: ["SPY"],
    priceFloor: 5,
    liquidityFloor: 1_000_000,
    openMinutes: 9 * 60 + 30,
    closeMinutes: 16 * 60,
  },
} as const;

const SHORTLIST_LIMIT = 250;

const toBar = (row: BarRow): OHLCV => ({
  date: row.date.slice(0, 10),
  open: Number(row.open),
  high: Number(row.high),
  low: Number(row.low),
  close: Number(row.close),
  volume: Number(row.volume ?? 0),
  openInterest: row.open_interest === null ? null : Number(row.open_interest),
});

/**
 * Scan the whole active market in SQL for completed-session bases sitting near their 20-session
 * pivot, rank relative strength across that same universe, then run the pure Armed Swing model
 * on the bounded shortlist. The in-progress session never enters the base; its volume is used
 * only for the breakout-pace check.
 */
export async function getArmedSwingCandidates(
  market: "IN" | "US",
  settings: SwingSettings,
): Promise<ArmedSwingResult> {
  const config = CONFIG[market];
  await refreshMarketHolidays(market).catch(() => false);
  const marketOpen = isMarketOpenNow(market);
  const clock = zonedMarketClock(market);
  const sessionDate = clock.date;
  const expectedSession = latestExpectedSessionDate(market);
  const progress = Math.max(0, Math.min(1,
    (clock.minutes - config.openMinutes) / (config.closeMinutes - config.openMinutes)));

  const [countRows, shortlist, benchmarkRows] = await Promise.all([
    query<{ count: string }>(
      `select count(*)::text count from public.assets a
        where ${config.universeWhere} and a.asset_class='STOCK' and a.is_active
          and not exists (select 1 from public.asset_tracking_exclusions x where x.asset_id=a.id)`,
    ),
    query<ShortlistRow>(
      `with universe as materialized (
         select a.id,a.ticker,a.name,a.exchange from public.assets a
          where ${config.universeWhere} and a.asset_class='STOCK' and a.is_active
            and not exists (select 1 from public.asset_tracking_exclusions x where x.asset_id=a.id)
       ), ranked as materialized (
         select o.asset_id,o.date,o.close,o.high,o.volume,
                row_number() over(partition by o.asset_id order by o.date desc) rn
           from public.daily_ohlcv o join universe u on u.id=o.asset_id
          where o.date >= current_date - interval '420 days'
            and not ($1::boolean and o.date >= $2::date)
       ), stats as materialized (
         select asset_id,
                max(date) filter(where rn=1) latest_date,
                max(close) filter(where rn=1) last_close,
                max(close) filter(where rn=64) c63,
                max(close) filter(where rn=127) c126,
                max(close) filter(where rn=190) c189,
                max(close) filter(where rn=253) c252,
                max(high) filter(where rn<=20) pivot,
                avg(close*volume) filter(where rn<=20) traded_value20,
                count(*) history_count
           from ranked where rn<=253 group by asset_id
       ), rs as (
         select asset_id,
                100 * percent_rank() over(order by
                  0.4*(last_close/c63-1) + 0.2*(last_close/c126-1) + 0.2*(last_close/c189-1) + 0.2*(last_close/c252-1)
                ) rs_percentile
           from stats where c252 > 0 and c189 > 0 and c126 > 0 and c63 > 0
       )
       select u.id asset_id,u.ticker,u.name,u.exchange,
              coalesce(q.price,st.last_close) current_price,rs.rs_percentile,
              q.best_bid,q.best_ask,q.lower_circuit,q.upper_circuit,
              q.source quote_source,q.updated_at::text quote_updated_at
         from universe u
         join stats st on st.asset_id=u.id
         left join rs on rs.asset_id=u.id
         left join public.latest_quotes q on q.asset_id=u.id
        where st.history_count >= 60
          and st.latest_date >= $3::date
          and coalesce(q.price,st.last_close) >= $4
          and st.traded_value20 >= $5
          and coalesce(q.price,st.last_close) between st.pivot*0.90 and st.pivot*1.05
        order by rs.rs_percentile desc nulls last,
                 abs(coalesce(q.price,st.last_close)/st.pivot - 1),
                 u.ticker
        limit ${SHORTLIST_LIMIT}`,
      [marketOpen, sessionDate, expectedSession, config.priceFloor, config.liquidityFloor],
    ),
    query<BarRow>(
      `with chosen as (
         select a.id from public.assets a
          where a.country=$1 and a.ticker=any($2::text[])
          order by array_position($2::text[],a.ticker),
                   (select count(*) from public.daily_ohlcv o where o.asset_id=a.id) desc
          limit 1
       )
       select o.asset_id,o.date::text date,o.open,o.high,o.low,o.close,o.volume,o.open_interest
         from public.daily_ohlcv o join chosen c on c.id=o.asset_id
        where not ($3::boolean and o.date >= $4::date)
        order by o.date desc limit 260`,
      [market, config.benchmarkTickers, marketOpen, sessionDate],
    ),
  ]);

  const ids = shortlist.map((row) => row.asset_id);
  const [barRows, liveRows, resultsRows] = ids.length ? await Promise.all([
    query<BarRow>(
      `select asset_id,date::text date,open,high,low,close,volume,open_interest
         from (
           select o.*,row_number() over(partition by asset_id order by date desc) rn
             from public.daily_ohlcv o
            where asset_id=any($1::uuid[]) and not ($2::boolean and o.date >= $3::date)
         ) ranked
        where rn <= 260 order by asset_id,date`,
      [ids, marketOpen, sessionDate],
    ),
    marketOpen
      ? query<{ asset_id: string; volume: string | number | null }>(
        `select asset_id,volume from public.daily_ohlcv where asset_id=any($1::uuid[]) and date=$2::date`,
        [ids, sessionDate],
      )
      : Promise.resolve([]),
    // A missing calendar table leaves every asset unverified (fail closed), not "no results".
    query<ResultsRow>(
      `select a.id asset_id,
              (select min(e.event_date)::text from public.corporate_events e
                where e.asset_id=a.id and e.event_type='RESULTS' and e.event_date >= $2::date) next_date,
              (select max(e.event_date)::text from public.corporate_events e
                where e.asset_id=a.id and e.event_type='RESULTS' and e.event_date < $2::date) last_past_date,
              s.last_success_at::text last_success_at
         from unnest($1::uuid[]) a(id)
         left join public.corporate_event_sync_state s on s.asset_id=a.id`,
      [ids, sessionDate],
    ).catch((error) => {
      if ((error as { code?: string }).code === "42P01") return [] as ResultsRow[];
      throw error;
    }),
  ]) : [[], [], [] as ResultsRow[]];
  const resultsByAsset = new Map(resultsRows.map((row) => [row.asset_id, row]));

  const barsByAsset = new Map<string, OHLCV[]>();
  for (const row of barRows) {
    const list = barsByAsset.get(row.asset_id) ?? [];
    list.push(toBar(row));
    barsByAsset.set(row.asset_id, list);
  }
  const liveVolume = new Map(liveRows.map((row) => [row.asset_id, Number(row.volume ?? 0)]));
  const benchmarkBars = benchmarkRows.map(toBar).reverse();
  if (!benchmarkBars.length) {
    console.warn(`[armed-swing] benchmark ${config.benchmarkTickers.join("/")} has no bars for ${market}`);
  }

  const assessed: Omit<ArmedSwingCandidate, "rank">[] = [];
  let resultsVerifiedCount = 0;
  for (const row of shortlist) {
    const bars = barsByAsset.get(row.asset_id) ?? [];
    if (bars.length < 60) continue;
    const currentPrice = Number(row.current_price ?? bars.at(-1)!.close);
    // Execution data is verified only from the authoritative live source during the session:
    // Breeze for India. Any other quote, or one older than the limit, fails closed.
    const quoteAgeMinutes = row.quote_updated_at ? (Date.now() - Date.parse(row.quote_updated_at)) / 60_000 : null;
    const authoritative = market !== "IN" || row.quote_source === "BREEZE_LIVE";
    const nullable = (value: string | number | null) => value === null ? null : Number(value);
    const calendar = resultsByAsset.get(row.asset_id);
    const coverage = calendar
      ? resultsCalendarCoverage({
        today: sessionDate,
        lastSuccessAt: calendar.last_success_at,
        nextDate: calendar.next_date,
        lastPastDate: calendar.last_past_date,
      })
      : null;
    if (coverage?.verified) resultsVerifiedCount++;
    const assessment = assessArmedSwing({
      market,
      bars,
      benchmarkBars,
      currentPrice,
      rsPercentile: row.rs_percentile === null ? null : Number(row.rs_percentile),
      liveSession: marketOpen && liveVolume.has(row.asset_id)
        ? { volume: liveVolume.get(row.asset_id)!, progress }
        : null,
      expectedSessionLag: tradingSessionLag(market, bars.at(-1)!.date, expectedSession),
      execution: {
        quoteFresh: marketOpen && authoritative && quoteAgeMinutes !== null
          && quoteAgeMinutes <= ARMED_SWING_RULES.maxQuoteAgeMinutes,
        quoteAgeMinutes: marketOpen ? quoteAgeMinutes : null,
        bestBid: authoritative ? nullable(row.best_bid) : null,
        bestAsk: authoritative ? nullable(row.best_ask) : null,
        lowerCircuit: authoritative ? nullable(row.lower_circuit) : null,
        upperCircuit: authoritative ? nullable(row.upper_circuit) : null,
      },
      results: coverage ? {
        verified: coverage.verified,
        detail: coverage.detail,
        nextDate: calendar?.next_date ?? null,
        sessionsToNext: calendar?.next_date ? tradingSessionLag(market, sessionDate, calendar.next_date) : null,
      } : null,
      risk: { targetRR: settings.targetRR, trailAtrMult: settings.trailAtrMult },
    });
    assessed.push({
      ...assessment,
      assetId: row.asset_id,
      ticker: row.ticker,
      name: row.name,
      exchange: row.exchange,
      country: market,
      currentPrice,
    });
  }

  const candidates = rankArmedSwingCandidates(assessed).map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  return {
    candidates,
    universeCount: Number(countRows[0]?.count ?? 0),
    scannedCount: shortlist.length,
    marketOpen,
    sessionDate,
    resultsVerifiedCount,
  };
}
