// Seeds deterministic market data so the analytical engines have something real
// to chew on: ~90 daily OHLCV bars per instrument (with OI on the derivative),
// 90 days of macro series, and two overlapping mutual funds with look-through.
//
//   DATABASE_URL=postgresql://... node scripts/seed-market-data.mjs
import pg from "pg";

const DAYS = 90;
const END = new Date("2026-06-12T00:00:00Z");

function dateStr(offsetFromEnd) {
  const d = new Date(END);
  d.setUTCDate(d.getUTCDate() - (DAYS - 1 - offsetFromEnd));
  return d.toISOString().slice(0, 10);
}

// Deterministic pseudo-noise (no Math.random, so re-runs are identical).
const noise = (i, k = 1) => Math.sin(i * 12.9898 + k * 78.233) * 0.5;

/** Build a close path for a given pattern, plus volume + optional OI arrays. */
function buildSeries(pattern, base) {
  const close = [];
  const volume = [];
  const oi = [];
  for (let i = 0; i < DAYS; i++) {
    let c;
    if (pattern === "coil_breakout") {
      // Genuinely tight low-vol base (±0.3%), then a clean breakout that clears
      // it decisively (+~7% over the final 6 bars).
      c = i < DAYS - 6
        ? base * (1 + 0.003 * Math.sin(i / 3) + 0.0005 * noise(i))
        : base * (1 + 0.012 * (i - (DAYS - 7)));
    } else if (pattern === "uptrend") {
      c = base * (1 + 0.0011 * i) + base * 0.01 * Math.sin(i / 7) + base * 0.002 * noise(i);
    } else {
      c = base * (1 + 0.02 * Math.sin(i / 9)) + base * 0.003 * noise(i, 3);
    }
    close.push(Number(c.toFixed(2)));
    const breakout = pattern === "coil_breakout" && i >= DAYS - 6;
    volume.push(Math.round((breakout ? 3_500_000 : 1_000_000) * (1 + 0.15 * noise(i, 5))));
    // Open interest ramps hard during the breakout (a Long Build-up).
    oi.push(breakout ? 100_000 + (i - (DAYS - 7)) * 15_000 : 100_000 + Math.round(500 * noise(i, 9)));
  }
  return { close, volume, oi };
}

const OHLCV_PLAN = [
  { ticker: "NIFTYFUT", base: 23_000, pattern: "coil_breakout", withOi: true },
  { ticker: "NVDA", base: 120, pattern: "coil_breakout", withOi: false },
  { ticker: "AAPL", base: 195, pattern: "uptrend", withOi: false },
  { ticker: "RELIANCE", base: 2900, pattern: "uptrend", withOi: false },
  { ticker: "TCS", base: 3800, pattern: "choppy", withOi: false },
];

const MACRO_PLAN = [
  { type: "US_10Y_YIELD", unit: "percent", fn: (i) => 4.3 + 0.2 * Math.sin(i / 10) + 0.02 * noise(i) },
  { type: "USD_INR", unit: "inr_per_usd", fn: (i) => 83.0 + i * 0.005 + 0.1 * Math.sin(i / 7) },
  { type: "BRENT_CRUDE", unit: "usd_per_bbl", fn: (i) => 79 + 3 * Math.sin(i / 9) + 0.2 * noise(i, 2) },
];

async function assetIdByTicker(client, ticker) {
  const r = await client.query("select id from public.assets where ticker = $1 limit 1", [ticker]);
  return r.rows[0]?.id ?? null;
}

async function ensureStock(client, ticker, name, exchange) {
  await client.query(
    `insert into public.assets (ticker, name, asset_class, exchange, country, currency)
     values ($1,$2,'STOCK',$3,'IN','INR')
     on conflict (exchange, ticker) do nothing`,
    [ticker, name, exchange],
  );
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // ---- OHLCV ----
  let bars = 0;
  for (const plan of OHLCV_PLAN) {
    const id = await assetIdByTicker(client, plan.ticker);
    if (!id) { console.log(`skip ${plan.ticker} (no asset)`); continue; }
    const { close, volume, oi } = buildSeries(plan.pattern, plan.base);
    for (let i = 0; i < DAYS; i++) {
      const c = close[i];
      const prev = i === 0 ? c : close[i - 1];
      const open = Number(prev.toFixed(2));
      const high = Number((Math.max(open, c) * 1.004).toFixed(2));
      const low = Number((Math.min(open, c) * 0.996).toFixed(2));
      await client.query(
        `insert into public.daily_ohlcv (asset_id, date, open, high, low, close, volume, open_interest)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (asset_id, date) do update set
           open=excluded.open, high=excluded.high, low=excluded.low,
           close=excluded.close, volume=excluded.volume, open_interest=excluded.open_interest`,
        [id, dateStr(i), open, high, low, c, volume[i], plan.withOi ? oi[i] : null],
      );
      bars++;
    }
  }
  console.log(`OHLCV: upserted ${bars} bars`);

  // ---- Macro ----
  let macro = 0;
  for (const m of MACRO_PLAN) {
    for (let i = 0; i < DAYS; i++) {
      await client.query(
        `insert into public.macro_indicators (indicator_type, date, value, unit)
         values ($1,$2,$3,$4)
         on conflict (indicator_type, date) do update set value=excluded.value, unit=excluded.unit`,
        [m.type, dateStr(i), Number(m.fn(i).toFixed(4)), m.unit],
      );
      macro++;
    }
  }
  console.log(`Macro: upserted ${macro} points`);

  // ---- Mutual funds + look-through ----
  await ensureStock(client, "HDFCBANK", "HDFC Bank Ltd", "NSE");
  const funds = [
    { ticker: "IGBLUE", name: "InvestoGenie Bluechip Fund", category: "Large Cap", plan: "REGULAR", er: 0.0175, amfi: "IG0001" },
    { ticker: "IGFLEXI", name: "InvestoGenie Flexi Cap Fund", category: "Flexi Cap", plan: "DIRECT", er: 0.006, amfi: "IG0002" },
  ];
  const fundIds = {};
  for (const f of funds) {
    await client.query(
      `insert into public.assets (ticker, name, asset_class, exchange, country, currency)
       values ($1,$2,'MUTUAL_FUND','AMFI','IN','INR')
       on conflict (exchange, ticker) do update set name=excluded.name`,
      [f.ticker, f.name],
    );
    const id = await assetIdByTicker(client, f.ticker);
    fundIds[f.ticker] = id;
    await client.query(
      `insert into public.mutual_fund_meta (asset_id, amfi_code_in, expense_ratio, category, plan_type)
       values ($1,$2,$3,$4,$5)
       on conflict (asset_id) do update set expense_ratio=excluded.expense_ratio, plan_type=excluded.plan_type, category=excluded.category`,
      [id, f.amfi, f.er, f.category, f.plan],
    );
  }

  // Deliberately overlapping holdings (RELIANCE/HDFCBANK/TCS/INFY shared).
  const holdings = {
    IGBLUE: [["RELIANCE", 24], ["HDFCBANK", 20], ["INFY", 14], ["TCS", 12]],
    IGFLEXI: [["RELIANCE", 22], ["HDFCBANK", 18], ["TCS", 15], ["INFY", 10]],
  };
  let mfh = 0;
  for (const [fundTicker, rows] of Object.entries(holdings)) {
    for (const [stockTicker, weight] of rows) {
      const stockId = await assetIdByTicker(client, stockTicker);
      if (!stockId) continue;
      await client.query(
        `insert into public.mutual_fund_holdings (fund_asset_id, stock_asset_id, weight_percentage, as_of_date)
         values ($1,$2,$3,$4)
         on conflict (fund_asset_id, stock_asset_id) do update set weight_percentage=excluded.weight_percentage`,
        [fundIds[fundTicker], stockId, weight, dateStr(DAYS - 1)],
      );
      mfh++;
    }
  }
  console.log(`Mutual funds: 2 funds, ${mfh} look-through holdings`);

  await client.end();
  console.log("Seed complete.");
}

main().catch((e) => { console.error(e); process.exit(1); });
