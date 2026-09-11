import { assessMomentumIgnition, type MomentumIgnitionAssessment } from "@/lib/analytics/momentumIgnition";
import { query } from "@/lib/db";
import type { SwingSettings } from "@/lib/settings";
import type { OHLCV } from "@/lib/types";

interface PreliminaryRow {
  asset_id: string;
  ticker: string;
  name: string | null;
  exchange: string;
  current_price: string | number;
  quote_change_pct: string | number | null;
  quote_as_of: string;
  latest_date: string;
  base_score: string | number | null;
  base_verdict: string | null;
}

interface BarRow {
  asset_id: string;
  date: string;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume: string | number;
  open_interest: string | number | null;
}

export interface MomentumIgnitionCandidate extends MomentumIgnitionAssessment {
  assetId: string;
  ticker: string;
  name: string | null;
  exchange: string;
  currentPrice: number;
  quoteChangePct: number | null;
  quoteAsOf: string;
  latestDate: string;
  baseScore: number;
  baseVerdict: string;
  projectedStop: number;
  projectedTarget: number;
  projectedTrail: number;
}

export interface MomentumIgnitionResult {
  market: "IN" | "US";
  universeScanned: number;
  detailedAssessments: number;
  candidates: MomentumIgnitionCandidate[];
}

const toBar = (row: BarRow): OHLCV => ({
  date: row.date.slice(0, 10),
  open: Number(row.open),
  high: Number(row.high),
  low: Number(row.low),
  close: Number(row.close),
  volume: Number(row.volume),
  openInterest: row.open_interest === null ? null : Number(row.open_interest),
});

function indiaSession(now = new Date()): { date: string; open: boolean; progress: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const weekday = parts.weekday !== "Sat" && parts.weekday !== "Sun";
  const start = 9 * 60 + 15;
  const end = 15 * 60 + 30;
  return {
    date,
    open: weekday && minutes >= start && minutes <= end,
    progress: Math.max(0, Math.min(1, (minutes - start) / (end - start))),
  };
}

const PRELIMINARY_SQL = `
  with universe as materialized (
    select a.id,a.ticker,a.name,a.exchange
      from public.assets a
     where a.country='IN' and a.exchange='NSE' and a.asset_class='STOCK'
       and a.is_active
       and not exists (
         select 1 from public.asset_tracking_exclusions x where x.asset_id=a.id
       )
  ), ranked as materialized (
    select o.asset_id,o.date,o.close,o.high,o.volume,
           row_number() over(partition by o.asset_id order by o.date desc) rn
      from public.daily_ohlcv o
      join universe u on u.id=o.asset_id
     where o.date >= current_date - interval '420 days'
  ), stats as (
    select asset_id,
           count(*) filter(where rn<=200) history_count,
           max(date) filter(where rn=1) latest_date,
           max(close) filter(where rn=1) last_close,
           avg(close) filter(where rn<=20) sma20,
           avg(close) filter(where rn<=50) sma50,
           avg(close) filter(where rn<=200) sma200,
           max(high) filter(where rn between 2 and 21) breakout_level,
           avg(close*volume) filter(where rn between 2 and 21) traded_value20
      from ranked
     where rn<=220
     group by asset_id
  )
  select u.id asset_id,u.ticker,u.name,u.exchange,
         q.price current_price,q.change_pct quote_change_pct,q.as_of::text quote_as_of,
         st.latest_date::text latest_date,s.score base_score,s.verdict base_verdict
    from universe u
    join stats st on st.asset_id=u.id
    join public.latest_quotes q on q.asset_id=u.id
    left join public.swing_signals s on s.asset_id=u.id
   where st.history_count>=200
     and q.price>=20
     and q.price>st.sma20 and st.sma20>st.sma50 and st.sma50>st.sma200
     and q.price>=st.breakout_level*0.90
     and st.traded_value20>=10000000
     and st.latest_date >= case
       when extract(isodow from now() at time zone 'Asia/Kolkata') between 1 and 5
        and (now() at time zone 'Asia/Kolkata')::time between time '09:15' and time '15:30'
         then (now() at time zone 'Asia/Kolkata')::date
       else current_date-4
     end
     and q.as_of >= case
       when extract(isodow from now() at time zone 'Asia/Kolkata') between 1 and 5
        and (now() at time zone 'Asia/Kolkata')::time between time '09:15' and time '15:30'
         then (now() at time zone 'Asia/Kolkata')::date
       else current_date-4
     end
   order by
     case when q.price>=st.breakout_level then 0 else 1 end,
     abs((q.price/st.breakout_level)-1),
     coalesce(s.score,0) desc,
     u.ticker
   limit 350`;

/**
 * Scan the complete active NSE stock catalog in SQL, then apply the richer
 * TypeScript model to a bounded near-breakout shortlist for predictable AWS
 * memory and response time.
 */
export async function getMomentumIgnitionCandidates(
  market: "IN" | "US",
  settings: SwingSettings,
): Promise<MomentumIgnitionResult> {
  if (market !== "IN") {
    return { market, universeScanned: 0, detailedAssessments: 0, candidates: [] };
  }

  const [countRows, preliminary, benchmarkRows] = await Promise.all([
    query<{ count: string | number }>(
      `select count(*) count from public.assets a
        where a.country='IN' and a.exchange='NSE' and a.asset_class='STOCK' and a.is_active
          and not exists (select 1 from public.asset_tracking_exclusions x where x.asset_id=a.id)`,
    ),
    query<PreliminaryRow>(PRELIMINARY_SQL),
    query<BarRow>(
      `with chosen as (
         select a.id from public.assets a
          where a.country='IN' and a.ticker='NIFTYBEES'
          order by (select count(*) from public.daily_ohlcv o where o.asset_id=a.id) desc
          limit 1
       )
       select o.asset_id,o.date::text date,o.open,o.high,o.low,o.close,o.volume,o.open_interest
         from public.daily_ohlcv o join chosen c on c.id=o.asset_id
        order by o.date desc limit 260`,
    ),
  ]);
  const universeScanned = Number(countRows[0]?.count ?? 0);
  if (!preliminary.length) {
    return { market, universeScanned, detailedAssessments: 0, candidates: [] };
  }

  const ids = preliminary.map((row) => row.asset_id);
  const barRows = await query<BarRow>(
    `select asset_id,date::text date,open,high,low,close,volume,open_interest
       from (
         select o.*,row_number() over(partition by asset_id order by date desc) rn
           from public.daily_ohlcv o where asset_id=any($1::uuid[])
       ) ranked
      where rn<=260 order by asset_id,date`,
    [ids],
  );
  const barsByAsset = new Map<string, OHLCV[]>();
  for (const row of barRows) {
    const bars = barsByAsset.get(row.asset_id) ?? [];
    bars.push(toBar(row));
    barsByAsset.set(row.asset_id, bars);
  }
  const benchmarkBars = benchmarkRows.map(toBar).reverse();
  const session = indiaSession();
  const candidates: MomentumIgnitionCandidate[] = [];
  for (const row of preliminary) {
    const bars = barsByAsset.get(row.asset_id) ?? [];
    if (bars.length < 200) continue;
    const assessment = assessMomentumIgnition({
      currentPrice: Number(row.current_price),
      bars,
      benchmarkBars,
      currentSessionVolume: session.open && bars.at(-1)?.date === session.date,
      sessionProgressFraction: session.progress,
    });
    if (!assessment.qualifies) continue;
    const risk = assessment.atr14 * settings.stopAtrMult;
    candidates.push({
      ...assessment,
      assetId: row.asset_id,
      ticker: row.ticker,
      name: row.name,
      exchange: row.exchange,
      currentPrice: Number(row.current_price),
      quoteChangePct: row.quote_change_pct === null ? null : Number(row.quote_change_pct),
      quoteAsOf: row.quote_as_of,
      latestDate: row.latest_date,
      baseScore: Number(row.base_score ?? 0),
      baseVerdict: row.base_verdict ?? "NO_SETUP",
      projectedStop: assessment.entryTrigger - risk,
      projectedTarget: assessment.entryTrigger + risk * settings.targetRR,
      projectedTrail: assessment.entryTrigger - assessment.atr14 * settings.trailAtrMult,
    });
  }

  const statusRank = {
    ENTRY_READY: 0,
    BREAKOUT_TRIGGERED: 1,
    WAIT_FOR_PULLBACK: 2,
    EARLY_WATCH: 3,
    NOT_QUALIFIED: 4,
  } as const;
  candidates.sort((left, right) =>
    statusRank[left.status] - statusRank[right.status]
      || right.score - left.score
      || right.baseScore - left.baseScore
      || left.ticker.localeCompare(right.ticker),
  );
  return {
    market,
    universeScanned,
    detailedAssessments: preliminary.length,
    candidates: candidates.slice(0, 80),
  };
}
