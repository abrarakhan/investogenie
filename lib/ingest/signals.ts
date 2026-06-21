// Scan job: run the swing classifier + legendary strategies over every
// instrument's OHLCV and upsert the result into swing_signals. Processes the
// universe in batches of assets so memory stays bounded — only one batch's bars
// are resident at a time (the full daily_ohlcv table can be millions of rows).
// Reusable by both the API route and a manual runner.
import { Client } from "pg";
import { classifySwingSetup, deriveLevels } from "@/lib/analytics/swingClassifier";
import { evaluateLegendary } from "@/lib/analytics/legendaryStrategies";
import type { OHLCV } from "@/lib/types";

export interface ScanSummary {
  scanned: number;
  setups: number;
  durationMs: number;
}

interface AssetMeta {
  id: string;
  ticker: string;
  country: string;
  exchange: string;
  asset_class: string;
}

interface BarRow {
  asset_id: string;
  date: string | Date;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume: string | number;
  open_interest: string | number | null;
}

const UPSERT_SQL = `insert into public.swing_signals
    (asset_id,ticker,country,exchange,asset_class,verdict,score,last_close,
     bandwidth_pct,is_squeeze,is_breakout,is_long_buildup,reason,as_of,
     current_price,entry_price,target_price,stop_loss,trailing_stop,atr,risk_reward,
     bias,long_trigger,short_trigger,hh22,ll22,daily_velocity,
     strategy_tags,strategy_scores)
  values %VALUES%
  on conflict (asset_id) do update set
    verdict=excluded.verdict, score=excluded.score, last_close=excluded.last_close,
    bandwidth_pct=excluded.bandwidth_pct, is_squeeze=excluded.is_squeeze,
    is_breakout=excluded.is_breakout, is_long_buildup=excluded.is_long_buildup,
    reason=excluded.reason, as_of=excluded.as_of, current_price=excluded.current_price,
    entry_price=excluded.entry_price, target_price=excluded.target_price,
    stop_loss=excluded.stop_loss, trailing_stop=excluded.trailing_stop,
    atr=excluded.atr, risk_reward=excluded.risk_reward, bias=excluded.bias,
    long_trigger=excluded.long_trigger, short_trigger=excluded.short_trigger,
    hh22=excluded.hh22, ll22=excluded.ll22, daily_velocity=excluded.daily_velocity,
    strategy_tags=excluded.strategy_tags, strategy_scores=excluded.strategy_scores,
    computed_at=now()`;

const COLS = 29;
const ASSET_BATCH = 60; // assets per round → bounded memory + small upserts

export async function computeSignals(databaseUrl: string): Promise<ScanSummary> {
  const t0 = Date.now();
  const client = new Client({
    connectionString: databaseUrl,
    ssl: /127\.0\.0\.1|localhost/.test(databaseUrl) ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    // Only assets that actually have bars (skips the bulk of the 17k catalog).
    const { rows: assets } = await client.query<AssetMeta>(
      `select a.id, a.ticker, a.country, a.exchange, a.asset_class
         from public.assets a
        where exists (select 1 from public.daily_ohlcv o where o.asset_id = a.id)
        order by a.id`,
    );

    let scanned = 0;
    let setups = 0;

    for (let i = 0; i < assets.length; i += ASSET_BATCH) {
      const slice = assets.slice(i, i + ASSET_BATCH);
      const metaById = new Map(slice.map((a) => [a.id, a]));
      const ids = slice.map((a) => a.id);

      const { rows } = await client.query<BarRow>(
        `select asset_id, date, open, high, low, close, volume, open_interest
           from public.daily_ohlcv
          where asset_id = any($1)
          order by asset_id, date asc`,
        [ids],
      );

      // Group this batch's bars per asset (rows arrive grouped + chronological).
      const bars = new Map<string, OHLCV[]>();
      for (const r of rows) {
        let arr = bars.get(r.asset_id);
        if (!arr) { arr = []; bars.set(r.asset_id, arr); }
        arr.push({
          date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
          open: Number(r.open), high: Number(r.high), low: Number(r.low),
          close: Number(r.close), volume: Number(r.volume),
          openInterest: r.open_interest === null ? null : Number(r.open_interest),
        });
      }

      const out: unknown[][] = [];
      for (const [assetId, series] of bars) {
        const meta = metaById.get(assetId);
        if (!meta) continue;
        try {
          const s = classifySwingSetup(series);
          if (s.verdict !== "NO_SETUP") setups++;
          const dir = s.bias === "SHORT" ? "SHORT" : "LONG";
          const lv = deriveLevels(s.setup, dir);
          const legendary = evaluateLegendary(series);
          out.push([
            meta.id, meta.ticker, meta.country, meta.exchange, meta.asset_class,
            s.verdict, s.score, s.close, s.bollinger.bandwidth * 100,
            s.isSqueeze, s.isBreakout, s.isLongBuildup, s.reasons[0], s.asOf,
            lv.currentPrice, lv.entry, lv.target, lv.stopLoss,
            lv.trailingStop, s.setup.atr, lv.riskRewardRatio,
            s.bias, s.setup.longTrigger, s.setup.shortTrigger,
            s.setup.hh22, s.setup.ll22, s.setup.dailyVelocity,
            legendary.tags, JSON.stringify(legendary.scores),
          ]);
        } catch {
          // too few bars — skip
        }
      }

      if (out.length) {
        const vals: string[] = [];
        const params: unknown[] = [];
        out.forEach((r, j) => {
          const b = j * COLS;
          vals.push(`(${Array.from({ length: COLS }, (_, k) => `$${b + k + 1}`).join(",")})`);
          params.push(...r);
        });
        await client.query(UPSERT_SQL.replace("%VALUES%", vals.join(",")), params);
        scanned += out.length;
      }
    }

    return { scanned, setups, durationMs: Date.now() - t0 };
  } finally {
    await client.end();
  }
}
