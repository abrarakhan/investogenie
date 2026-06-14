// Scan job: load every instrument's OHLCV, run the swing classifier, and upsert
// the result into swing_signals. Run on a schedule (cron route) or manually.
// Reusable by both the API route and a tsx script.
import { Client } from "pg";
import { classifySwingSetup, deriveLevels } from "@/lib/analytics/swingClassifier";
import type { OHLCV } from "@/lib/types";

export interface ScanSummary {
  scanned: number;
  setups: number;
  durationMs: number;
}

interface Row {
  asset_id: string;
  date: string | Date;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume: string | number;
  open_interest: string | number | null;
  ticker: string;
  country: string;
  exchange: string;
  asset_class: string;
}

export async function computeSignals(databaseUrl: string): Promise<ScanSummary> {
  const t0 = Date.now();
  const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows } = await client.query<Row>(
      `select o.asset_id, o.date, o.open, o.high, o.low, o.close, o.volume, o.open_interest,
              a.ticker, a.country, a.exchange, a.asset_class
       from public.daily_ohlcv o
       join public.assets a on a.id = o.asset_id
       order by o.asset_id, o.date asc`,
    );

    // Group bars per instrument (rows arrive grouped + chronological).
    const groups = new Map<string, { meta: Row; bars: OHLCV[] }>();
    for (const r of rows) {
      if (!groups.has(r.asset_id)) groups.set(r.asset_id, { meta: r, bars: [] });
      groups.get(r.asset_id)!.bars.push({
        date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
        open: Number(r.open), high: Number(r.high), low: Number(r.low),
        close: Number(r.close), volume: Number(r.volume),
        openInterest: r.open_interest === null ? null : Number(r.open_interest),
      });
    }

    const out: unknown[][] = [];
    let setups = 0;
    for (const { meta, bars } of groups.values()) {
      try {
        const s = classifySwingSetup(bars);
        if (s.verdict !== "NO_SETUP") setups++;
        // Store default-risk levels for convenience + raw fields for per-user derivation.
        const dir = s.bias === "SHORT" ? "SHORT" : "LONG";
        const lv = deriveLevels(s.setup, dir);
        out.push([
          meta.asset_id, meta.ticker, meta.country, meta.exchange, meta.asset_class,
          s.verdict, s.score, s.close, s.bollinger.bandwidth * 100,
          s.isSqueeze, s.isBreakout, s.isLongBuildup, s.reasons[0], s.asOf,
          lv.currentPrice, lv.entry, lv.target, lv.stopLoss,
          lv.trailingStop, s.setup.atr, lv.riskRewardRatio,
          s.bias, s.setup.longTrigger, s.setup.shortTrigger,
          s.setup.hh22, s.setup.ll22, s.setup.dailyVelocity,
        ]);
      } catch {
        // too few bars — skip
      }
    }

    const cols = 27;
    for (let i = 0; i < out.length; i += 300) {
      const batch = out.slice(i, i + 400);
      const vals: string[] = [];
      const params: unknown[] = [];
      batch.forEach((r, j) => {
        const b = j * cols;
        vals.push(`(${Array.from({ length: cols }, (_, k) => `$${b + k + 1}`).join(",")})`);
        params.push(...r);
      });
      await client.query(
        `insert into public.swing_signals
           (asset_id,ticker,country,exchange,asset_class,verdict,score,last_close,
            bandwidth_pct,is_squeeze,is_breakout,is_long_buildup,reason,as_of,
            current_price,entry_price,target_price,stop_loss,trailing_stop,atr,risk_reward,
            bias,long_trigger,short_trigger,hh22,ll22,daily_velocity)
         values ${vals.join(",")}
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
           computed_at=now()`,
        params,
      );
    }

    return { scanned: out.length, setups, durationMs: Date.now() - t0 };
  } finally {
    await client.end();
  }
}
