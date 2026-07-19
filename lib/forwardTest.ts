// Forward testing: enroll frozen predictions, then grade them against what
// actually happened. Deliberately reuses the live engines (runScreener,
// getProbabilitySummary) so the calls under test are the same ones the app
// shows — a separate code path would be testing something the user never sees.

import { query, tx } from "@/lib/db";
import { runScreener } from "@/lib/screener";
import { getProbabilitySummary } from "@/lib/probability-runtime";
import { MARKET_COUNTRY } from "@/lib/markets";
import type { MarketId } from "@/lib/types";

const PER_METHOD = 2;
const FILL_WINDOW_DAYS = 10;

/** Keep forward tests on instruments a person could actually trade. The US
 *  screener universe includes preferreds, units and OTC lines (AILLM, AIIA-UN,
 *  BANC-PF, APTOF all got enrolled on the first run), and grading a strategy on
 *  those measures nothing useful. */
function isTradableCommon(row: { ticker: string; exchange: string; country: string; lastQuote: number | null; close: number }): boolean {
  if (row.country === "US") {
    if (!["NASDAQ", "NYSE"].includes(row.exchange)) return false;
    // '-' and '.' mark preferred series, units and warrants (BANC-PF, AIIA-UN).
    if (/[-.]/.test(row.ticker)) return false;
    // 5-letter US tickers ending W/R/U are warrants/rights/units.
    if (row.ticker.length >= 5 && /[WRU]$/.test(row.ticker)) return false;
    if ((row.lastQuote ?? row.close) < 5) return false;
  }
  return true;
}
const SWING_HORIZON_DAYS = 21;

export interface EnrollSummary {
  market: MarketId;
  enrolled: number;
  byMethod: Record<string, string[]>;
  skipped: number;
}

/**
 * Enroll the top `PER_METHOD` candidates for every swing strategy plus the
 * probability engine. Everything the engine projected is written now and never
 * recomputed — re-deriving at evaluation time would grade the model against a
 * forecast it only made with hindsight.
 */
export async function enrollCohort(market: MarketId): Promise<EnrollSummary> {
  const country = MARKET_COUNTRY[market];
  const byMethod: Record<string, string[]> = {};
  let enrolled = 0;
  let skipped = 0;

  // --- Swing: one bucket per legendary strategy -----------------------------
  const rows = await runScreener(country);
  const byStrategy = new Map<string, typeof rows>();
  for (const row of rows) {
    if (row.verdict === "NO_SETUP") continue;
    if (!isTradableCommon(row)) { skipped++; continue; }
    for (const tag of row.strategyTags) {
      const bucket = byStrategy.get(tag) ?? [];
      bucket.push(row);
      byStrategy.set(tag, bucket);
    }
  }

  const inserts: Record<string, unknown>[] = [];
  for (const [strategy, bucket] of byStrategy) {
    const ranked = [...bucket].sort((a, b) => {
      const sa = a.strategyLevels[strategy]?.score ?? a.score;
      const sb = b.strategyLevels[strategy]?.score ?? b.score;
      return sb - sa;
    });
    for (const row of ranked.slice(0, PER_METHOD)) {
      const lv = row.strategyLevels[strategy];
      // Anchor to the strategy's ENTRY TRIGGER, not spot. target/stop are
      // derived from the trigger, so pricing entry at spot left them on a
      // different anchor — which is how a long got a stop above its entry.
      const trigger = lv?.entry ?? row.entry;
      const target = lv?.target ?? row.target;
      const stop = lv?.stopLoss ?? row.stopLoss;
      if (!trigger || trigger <= 0) { skipped++; continue; }
      const entry = trigger;
      inserts.push({
        method: `SWING:${strategy}`,
        market,
        asset_id: row.assetId,
        ticker: row.ticker,
        horizon_days: lv?.expectedDays ?? row.expectedDays ?? SWING_HORIZON_DAYS,
        direction: (lv?.direction ?? row.direction) === "SHORT" ? "SHORT" : "LONG",
        entry_price: entry,
        trigger_price: trigger,
        // A swing call is a resting order: it only becomes a position if price
        // reaches the trigger inside the fill window.
        status: "PENDING",
        projected_target: target,
        projected_stop: stop,
        // Swing "projection" is the move to target from entry.
        projected_return_pct: target ? ((target - entry) / entry) * 100 : null,
        projected_prob_up_pct: null,
        projected_p5_pct: null,
        projected_p95_pct: null,
        projection: JSON.stringify({ strategy, verdict: row.verdict, score: row.score, levels: lv ?? null }),
      });
      (byMethod[`SWING:${strategy}`] ??= []).push(row.ticker);
    }
  }

  // --- Probability engine ---------------------------------------------------
  const prob = await getProbabilitySummary(market);
  for (const row of prob.rows.slice(0, PER_METHOD)) {
    if (!row.lastPrice || row.lastPrice <= 0) { skipped++; continue; }
    inserts.push({
      method: "PROBABILITY",
      market,
      asset_id: row.assetId,
      ticker: row.ticker,
      horizon_days: prob.horizonDays,
      direction: "LONG",
      entry_price: row.lastPrice,
      trigger_price: null,
      status: "OPEN",
      // No levels: this engine forecasts a distribution, so it closes on expiry.
      projected_target: null,
      projected_stop: null,
      projected_return_pct: row.percentiles.p50,
      projected_prob_up_pct: row.probabilityUpPct,
      projected_p5_pct: row.percentiles.p5,
      projected_p95_pct: row.percentiles.p95,
      projection: JSON.stringify({
        percentiles: row.percentiles, sigma21Pct: row.sigma21Pct,
        drawdownRiskPct: row.drawdownRiskPct, contributions: row.contributions,
      }),
    });
    (byMethod.PROBABILITY ??= []).push(row.ticker);
  }

  await tx(async (c) => {
    for (const r of inserts) {
      const res = await c.query(
        `insert into public.forward_test_positions
           (method, market, asset_id, ticker, horizon_days, direction, entry_price,
            projected_target, projected_stop, projected_return_pct, projected_prob_up_pct,
            projected_p5_pct, projected_p95_pct, projection, trigger_price, status, fill_window_days)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17)
         on conflict (method, asset_id, enrolled_on) do nothing`,
        [r.method, r.market, r.asset_id, r.ticker, r.horizon_days, r.direction, r.entry_price,
         r.projected_target, r.projected_stop, r.projected_return_pct, r.projected_prob_up_pct,
         r.projected_p5_pct, r.projected_p95_pct, r.projection,
         r.trigger_price ?? null, r.status ?? "OPEN", FILL_WINDOW_DAYS],
      );
      enrolled += res.rowCount ?? 0;
    }
  });

  return { market, enrolled, byMethod, skipped };
}

interface OpenPosition {
  id: string;
  asset_id: string;
  direction: string;
  horizon_days: number;
  enrolled_on: string | Date;
  entry_price: string | number;
  projected_target: string | number | null;
  projected_stop: string | number | null;
  projected_p5_pct: string | number | null;
  projected_p95_pct: string | number | null;
  status: string;
  trigger_price: string | number | null;
  fill_window_days: number;
  filled_on: string | Date | null;
}

export interface EvaluateSummary {
  examined: number;
  closed: number;
  byStatus: Record<string, number>;
}

/**
 * Grade every OPEN position against the bars that have printed since it was
 * enrolled. Rules:
 *   - target/stop are checked against the bar's HIGH/LOW, i.e. an intraday
 *     touch, which is what a resting order would actually do;
 *   - if one bar touches BOTH, the stop wins — intrabar order is unknowable, so
 *     we take the worst case rather than flattering the strategy;
 *   - a position with no levels (the probability engine) runs to horizon and
 *     closes at that bar's close.
 */
export async function evaluateOpenPositions(): Promise<EvaluateSummary> {
  const positions = await query<OpenPosition>(
    `select id, asset_id, direction, horizon_days, enrolled_on, entry_price,
            projected_target, projected_stop, projected_p5_pct, projected_p95_pct
       , status, trigger_price, fill_window_days, filled_on
       from public.forward_test_positions where status in ('PENDING','OPEN')`,
  );
  const byStatus: Record<string, number> = {};
  let closed = 0;
  if (!positions.length) return { examined: 0, closed: 0, byStatus };

  const n = (v: string | number | null) => (v === null ? null : Number(v));

  for (const p of positions) {
    const enrolledOn = p.enrolled_on instanceof Date
      ? p.enrolled_on.toISOString().slice(0, 10)
      : String(p.enrolled_on).slice(0, 10);

    const bars = await query<{ date: string | Date; high: string | number; low: string | number; close: string | number }>(
      `select date, high, low, close from public.daily_ohlcv
        where asset_id = $1 and date > $2 order by date asc`,
      [p.asset_id, enrolledOn],
    );
    if (!bars.length) continue;

    const entry = Number(p.entry_price);
    const isLong = p.direction !== "SHORT";
    const target = n(p.projected_target);
    const stop = n(p.projected_stop);
    const signed = (price: number) => (isLong ? (price - entry) / entry : (entry - price) / entry) * 100;

    const trigger = n(p.trigger_price);
    let pending = p.status === "PENDING" && trigger !== null;
    let filledOn: string | null = p.filled_on
      ? (p.filled_on instanceof Date ? p.filled_on.toISOString().slice(0, 10) : String(p.filled_on).slice(0, 10))
      : null;
    let sincePending = 0;
    let maxFav = 0;
    let maxAdv = 0;
    let status: string | null = null;
    let exitPrice: number | null = null;
    let exitDate: string | null = null;
    let held = 0;

    for (const bar of bars) {
      const high = Number(bar.high);
      const low = Number(bar.low);
      const date = bar.date instanceof Date ? bar.date.toISOString().slice(0, 10) : String(bar.date).slice(0, 10);

      if (pending) {
        sincePending++;
        // Filled when price trades through the trigger.
        const filled = isLong ? high >= trigger! : low <= trigger!;
        if (filled) { pending = false; filledOn = date; }
        else if (sincePending >= p.fill_window_days) { status = "UNFILLED"; exitDate = date; break; }
        else continue;
      }
      held++;
      // Direction-aware path extremes.
      maxFav = Math.max(maxFav, signed(isLong ? high : low));
      maxAdv = Math.min(maxAdv, signed(isLong ? low : high));

      const hitStop = stop !== null && (isLong ? low <= stop : high >= stop);
      const hitTarget = target !== null && (isLong ? high >= target : low <= target);

      if (hitStop) { status = "STOP_HIT"; exitPrice = stop; exitDate = date; break; }
      if (hitTarget) { status = "TARGET_HIT"; exitPrice = target; exitDate = date; break; }
      if (held >= p.horizon_days) { status = "EXPIRED"; exitPrice = Number(bar.close); exitDate = date; break; }
    }

    const lastBar = bars[bars.length - 1];
    const lastDate = lastBar.date instanceof Date
      ? lastBar.date.toISOString().slice(0, 10)
      : String(lastBar.date).slice(0, 10);

    if (!status) {
      // Still running: record path stats so drawdown is visible before close.
      await query(
        `update public.forward_test_positions
            set max_favorable_pct=$2, max_adverse_pct=$3, evaluated_through=$4,
                status=$5, filled_on=coalesce(filled_on, $6::date), updated_at=now()
          where id=$1`,
        [p.id, maxFav, maxAdv, lastDate, pending ? "PENDING" : "OPEN", filledOn],
      );
      continue;
    }

    if (status === "UNFILLED") {
      await query(
        `update public.forward_test_positions
            set status='UNFILLED', closed_at=$2::date, evaluated_through=$2::date, updated_at=now()
          where id=$1`,
        [p.id, exitDate],
      );
      closed++; byStatus.UNFILLED = (byStatus.UNFILLED ?? 0) + 1;
      continue;
    }
    const realized = signed(exitPrice!);
    const p5 = n(p.projected_p5_pct);
    const p95 = n(p.projected_p95_pct);
    const withinBand = p5 !== null && p95 !== null ? realized >= p5 && realized <= p95 : null;

    await query(
      `update public.forward_test_positions
          set status = $2, exit_price = $3, closed_at = $4::date, realized_return_pct = $5,
              max_favorable_pct = $6, max_adverse_pct = $7, within_projected_band = $8,
              evaluated_through = $4::date, updated_at = now()
        where id = $1`,
      [p.id, status, exitPrice, exitDate, realized, maxFav, maxAdv, withinBand],
    );
    closed++;
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  }

  return { examined: positions.length, closed, byStatus };
}

export interface ScorecardRow {
  method: string;
  market: string;
  total: number;
  open_positions: number;
  closed_positions: number;
  win_rate_pct: number | null;
  avg_realized_pct: number | null;
  avg_projected_pct: number | null;
  avg_projection_error_pct: number | null;
  avg_max_adverse_pct: number | null;
  band_coverage_pct: number | null;
}

export async function getForwardTestScorecard(market?: MarketId): Promise<ScorecardRow[]> {
  const rows = await query<Record<string, unknown>>(
    `select * from public.forward_test_scorecard
      ${market ? "where market = $1" : ""}
      order by method`,
    market ? [market] : [],
  );
  return rows.map((r) => ({
    method: String(r.method),
    market: String(r.market),
    total: Number(r.total),
    open_positions: Number(r.open_positions),
    closed_positions: Number(r.closed_positions),
    win_rate_pct: r.win_rate_pct === null ? null : Number(r.win_rate_pct),
    avg_realized_pct: r.avg_realized_pct === null ? null : Number(r.avg_realized_pct),
    avg_projected_pct: r.avg_projected_pct === null ? null : Number(r.avg_projected_pct),
    avg_projection_error_pct: r.avg_projection_error_pct === null ? null : Number(r.avg_projection_error_pct),
    avg_max_adverse_pct: r.avg_max_adverse_pct === null ? null : Number(r.avg_max_adverse_pct),
    band_coverage_pct: r.band_coverage_pct === null ? null : Number(r.band_coverage_pct),
  }));
}
