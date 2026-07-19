// Forward-test CLI: enroll a new cohort, evaluate open positions, or print the
// scorecard. Runs the same SQL the app uses, over plain pg, so it works without
// the Next server and can be driven from cron/launchd.
//
//   DATABASE_URL=... node scripts/forward-test.mjs evaluate
//   DATABASE_URL=... node scripts/forward-test.mjs scorecard
//
// NOTE: `enroll` needs the analytical engines (TypeScript), so it is exposed via
// the app at /api/cron/forward-test?action=enroll rather than duplicated here.
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/investogenie";
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: /127\.0\.0\.1|localhost/.test(databaseUrl) ? false : { rejectUnauthorized: false },
});

const signed = (entry, price, isLong) => ((isLong ? price - entry : entry - price) / entry) * 100;

/** Mirrors evaluateOpenPositions() in lib/forwardTest.ts: intraday touch on
 *  high/low, stop wins when a single bar touches both, expiry closes on close. */
async function evaluate() {
  const { rows: positions } = await client.query(
    `select id, asset_id, direction, horizon_days, enrolled_on, entry_price,
            projected_target, projected_stop, projected_p5_pct, projected_p95_pct,
            status, trigger_price, fill_window_days, filled_on
       from public.forward_test_positions where status in ('PENDING','OPEN')`,
  );
  let closed = 0;
  const byStatus = {};

  for (const p of positions) {
    const enrolledOn = new Date(p.enrolled_on).toISOString().slice(0, 10);
    const { rows: bars } = await client.query(
      `select date, high, low, close from public.daily_ohlcv
        where asset_id = $1 and date > $2 order by date asc`,
      [p.asset_id, enrolledOn],
    );
    if (!bars.length) continue;

    const entry = Number(p.entry_price);
    const isLong = p.direction !== "SHORT";
    const target = p.projected_target === null ? null : Number(p.projected_target);
    const stop = p.projected_stop === null ? null : Number(p.projected_stop);

    const trigger = p.trigger_price === null ? null : Number(p.trigger_price);
    let pending = p.status === "PENDING" && trigger !== null;
    let filledOn = p.filled_on ? new Date(p.filled_on).toISOString().slice(0, 10) : null;
    let sincePending = 0;
    let maxFav = 0, maxAdv = 0, status = null, exitPrice = null, exitDate = null, held = 0;
    for (const bar of bars) {
      const high = Number(bar.high), low = Number(bar.low);
      const date = new Date(bar.date).toISOString().slice(0, 10);

      if (pending) {
        sincePending++;
        // A swing call is a resting order: it only becomes a position once
        // price trades through the trigger.
        const filled = isLong ? high >= trigger : low <= trigger;
        if (filled) { pending = false; filledOn = date; }
        else if (sincePending >= p.fill_window_days) { status = "UNFILLED"; exitDate = date; break; }
        else continue;
      }
      held++;
      maxFav = Math.max(maxFav, signed(entry, isLong ? high : low, isLong));
      maxAdv = Math.min(maxAdv, signed(entry, isLong ? low : high, isLong));

      const hitStop = stop !== null && (isLong ? low <= stop : high >= stop);
      const hitTarget = target !== null && (isLong ? high >= target : low <= target);
      if (hitStop) { status = "STOP_HIT"; exitPrice = stop; exitDate = date; break; }
      if (hitTarget) { status = "TARGET_HIT"; exitPrice = target; exitDate = date; break; }
      if (held >= p.horizon_days) { status = "EXPIRED"; exitPrice = Number(bar.close); exitDate = date; break; }
    }

    const lastDate = new Date(bars[bars.length - 1].date).toISOString().slice(0, 10);
    if (!status) {
      // Persist a fill that happened without the position closing yet.
      await client.query(
        `update public.forward_test_positions
            set max_favorable_pct=$2, max_adverse_pct=$3, evaluated_through=$4,
                status=$5, filled_on=coalesce(filled_on, $6::date), updated_at=now()
          where id=$1`,
        [p.id, maxFav, maxAdv, lastDate, pending ? "PENDING" : "OPEN", filledOn],
      );
      continue;
    }

    if (status === "UNFILLED") {
      await client.query(
        `update public.forward_test_positions
            set status='UNFILLED', closed_at=$2::date, evaluated_through=$2::date, updated_at=now()
          where id=$1`,
        [p.id, exitDate],
      );
      closed++; byStatus.UNFILLED = (byStatus.UNFILLED ?? 0) + 1;
      continue;
    }

    const realized = signed(entry, exitPrice, isLong);
    const p5 = p.projected_p5_pct === null ? null : Number(p.projected_p5_pct);
    const p95 = p.projected_p95_pct === null ? null : Number(p.projected_p95_pct);
    const withinBand = p5 !== null && p95 !== null ? realized >= p5 && realized <= p95 : null;

    await client.query(
      `update public.forward_test_positions
          set status=$2, exit_price=$3, closed_at=$4::date, realized_return_pct=$5,
              max_favorable_pct=$6, max_adverse_pct=$7, within_projected_band=$8,
              evaluated_through=$4::date, updated_at=now()
        where id=$1`,
      [p.id, status, exitPrice, exitDate, realized, maxFav, maxAdv, withinBand],
    );
    closed++;
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  }
  console.log(`Examined ${positions.length} pending/open position(s); closed ${closed}`, byStatus);
}

async function scorecard() {
  const { rows } = await client.query("select * from public.forward_test_scorecard order by method");
  if (!rows.length) return console.log("No forward-test positions yet.");
  console.table(rows.map((r) => ({
    method: r.method,
    market: r.market,
    pending: Number(r.pending_positions),
    open: Number(r.open_positions),
    unfilled: Number(r.unfilled_positions),
    closed: Number(r.closed_positions),
    "win%": r.win_rate_pct,
    "realized%": r.avg_realized_pct,
    "projected%": r.avg_projected_pct,
    "error%": r.avg_projection_error_pct,
    "maxDD%": r.avg_max_adverse_pct,
    "band%": r.band_coverage_pct,
  })));
}

const action = (process.argv[2] || "scorecard").toLowerCase();
await client.connect();
try {
  if (action === "evaluate") await evaluate();
  else if (action === "scorecard") await scorecard();
  else { console.error(`Unknown action "${action}". Use: evaluate | scorecard`); process.exitCode = 1; }
} finally {
  await client.end();
}
