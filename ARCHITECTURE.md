# InvestoGenie — Architecture & Feature Reference

> Living document for review and onboarding. Last updated: 2026-06-13.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.2.9 (App Router, React 19) |
| Auth + DB | Supabase (auth, RLS, PostgREST, Postgres) |
| Styling | Tailwind CSS + CSS custom properties for market theming |
| 3D Hero | React Three Fiber (@react-three/fiber 9), Three.js |
| Animations | GSAP 3 + ScrollTrigger |
| Direct SQL | `pg` (node-postgres) — used only in ingestion scripts / cron routes |
| Deployment | Vercel (with two scheduled crons) |

---

## Directory Structure

```
investogenie/
├── app/
│   ├── page.tsx                        # Landing page
│   ├── login/
│   │   ├── page.tsx                    # Sign-in / sign-up form
│   │   └── actions.ts                  # login(), signup(), signout()
│   ├── auth/confirm/route.ts           # Email OTP verification
│   ├── dashboard/page.tsx              # Redirects → /terminal/us
│   ├── screener/page.tsx               # Redirects → /terminal/us/screener
│   ├── terminal/[market]/
│   │   ├── page.tsx                    # Per-market terminal (holdings, watchlist, engines)
│   │   └── screener/page.tsx           # Per-market swing screener
│   ├── settings/
│   │   ├── page.tsx                    # Risk settings form
│   │   └── actions.ts                  # saveSwingSettings(), resetSwingSettings()
│   └── api/
│       ├── assets/search/route.ts      # GET ?q=&country= — typeahead search
│       └── cron/
│           ├── refresh-quotes/route.ts # Cron: daily price refresh
│           └── scan/route.ts           # Cron: nightly swing scan
├── components/
│   ├── landing/                        # Hero canvas, kinetic headline, pivot switch, scroll features
│   ├── terminal/
│   │   ├── TerminalHeader.tsx          # Sticky nav with Screener / Settings links
│   │   ├── TerminalSwitch.tsx          # US ↔ India navigation tabs
│   │   └── ApplyMarketTheme.tsx        # Client component — injects CSS theme vars on mount
│   ├── dashboard/
│   │   ├── AssetPicker.tsx             # Typeahead combobox scoped by country
│   │   └── EngineSection.tsx           # Swing signals + fund overlap + macro panels
│   └── screener/
│       └── ScreenerTable.tsx           # Sortable / filterable screener table
├── lib/
│   ├── types.ts                        # Domain types
│   ├── markets.ts                      # MARKETS config, formatMoney(), normalizeMarket()
│   ├── settings.ts                     # getUserSwingSettings() — per-user risk resolver
│   ├── quotes.ts                       # getQuotesByAssetIds() — chunked batch fetch
│   ├── screener.ts                     # runScreener() — reads precomputed signals + derives levels
│   ├── engines-runtime.ts              # getTopSwingSetups(), getFundOverlap(), getMacroMatrix()
│   ├── analytics/
│   │   ├── swingClassifier.ts          # Core classifier + deriveLevels()
│   │   ├── fundOverlap.ts              # Look-through pairwise overlap
│   │   └── macroCorrelator.ts          # Pearson correlation, lead/lag signal
│   └── ingest/
│       ├── quotes.ts                   # refreshQuotes() — full universe price refresh
│       └── signals.ts                  # computeSignals() — OHLCV → swing_signals upsert
├── scripts/                            # One-shot ingestion scripts (run with node --env-file)
├── supabase/migrations/                # SQL migrations 0001–0007
├── proxy.ts                            # Next.js 16 session refresh (replaces middleware.ts)
├── utils/supabase/                     # Supabase client helpers (server, client, middleware)
└── vercel.json                         # Cron schedule config
```

---

## Database Schema

### Reference / market data (public read, service-write)

| Table | Purpose |
|-------|---------|
| `assets` | 17,660 instruments: STOCK / BOND / MUTUAL_FUND / CURRENCY / DERIVATIVE; columns: ticker, name, asset_class, currency, country, exchange, isin |
| `daily_ohlcv` | EOD bars — asset_id, date, open, high, low, close, volume |
| `latest_quotes` | One row per asset: price, change_pct, as_of, source, currency |
| `swing_signals` | Precomputed nightly — verdict, score, bias, trigger prices, ATR, velocity, trade levels |
| `macro_indicators` | Date-series macros (DXY, VIX, crude, yield curve, etc.) |
| `mutual_fund_meta` | Fund name, AMC, plan type, ISIN |
| `mutual_fund_holdings` | Fund → stock weight, quarter |
| `derivative_meta` | Expiry, lot size, settlement kind |
| `cron_logs` | Per-run cron audit trail — job, status, detail jsonb, error, duration (RLS-on, no policy → service-only) |
| `asset_financial_reports` | 15-yr corporate fundamentals — revenue, net_profit, ebit, capital_employed, eps, P/E, market_cap, ROCE, YoY profit/sales variance. PK `(asset_id, period_end_date, report_type)`, index `(asset_id, period_end_date desc)` |
| `latest_financials` *(view)* | `distinct on (asset_id)` latest quarterly snapshot; `security_invoker` so base-table RLS applies. Joined by the screener |

### User data (RLS: `user_id = auth.uid()`)

| Table | Purpose |
|-------|---------|
| `portfolios` | Named portfolio buckets |
| `holdings` | asset_id, quantity, avg_cost |
| `transactions` | BUY / SELL log |
| `watchlists` | Named watchlists |
| `watchlist_items` | asset_id → watchlist |
| `user_swing_settings` | Per-user risk params (stop×ATR, R:R, trail×ATR, include_short) |

---

## Market Terminals

Two separate terminals routed by `[market]` param — `us` and `in`.

Each terminal shows:
- **Portfolio** — holdings scoped to that market's country code, live P&L
- **Benchmarks** — US: SPY / QQQ / IWM; India: NIFTY / SENSEX / BANKNIFTY
- **Holdings table** — qty, avg cost, last price, market value, P&L
- **Trade ticket** — AssetPicker + buy/sell form → `recordTrade()` server action
- **Watchlist** — add / remove, live quotes
- **Analytical Engines** — swing signals, fund overlap (India only), macro correlator

The header (`TerminalHeader`) has pill links to **Screener** and **Settings**, plus a market switch (`TerminalSwitch`).

---

## Swing Classifier

**File:** `lib/analytics/swingClassifier.ts`

### Verdicts

| Verdict | Meaning |
|---------|---------|
| `LONG_BREAKOUT` | OI-validated long — breakout + OI build-up |
| `COILED_SPRING` | Volatility squeeze, long bias |
| `BREAKOUT_UNCONFIRMED` | Breakout without OI confirmation |
| `SHORT_BREAKDOWN` | OI-validated short — breakdown + OI build-up |
| `SHORT_COILED_SPRING` | Volatility squeeze, short bias |
| `BREAKDOWN_UNCONFIRMED` | Breakdown without OI confirmation |
| `NO_SETUP` | No actionable signal |

### Trade Level Derivation

```
deriveLevels(setup: SwingSetup, direction: TradeDirection, risk: RiskConfig) → TradeLevels
```

**LONG:**
- entry = longTrigger (Donchian high breakout)
- stopLoss = entry − stopAtrMult × ATR
- target = entry + targetRR × (entry − stopLoss)
- trailingStop = hh22 − trailAtrMult × ATR  (chandelier exit)

**SHORT:**
- entry = shortTrigger (Donchian low breakdown)
- stopLoss = entry + stopAtrMult × ATR
- target = entry − targetRR × (stopLoss − entry)
- trailingStop = ll22 + trailAtrMult × ATR  (inverted chandelier)

**Expected days:** `round(|target − entry| / dailyVelocity)`, clamped 1–60.

### Precompute vs. Read-time

`computeSignals()` (nightly cron) stores raw setup fields — bias, triggers, ATR, hh22, ll22, velocity — but also stores *default-risk* levels for reference.

`deriveLevels()` is called at **read time** so per-user risk settings apply without rescanning.

---

## Per-User Risk Settings

**Route:** `/settings`
**Table:** `user_swing_settings`

| Setting | Default | Description |
|---------|---------|-------------|
| `stop_atr_mult` | 1.5 | Stop distance as a multiple of ATR |
| `target_rr` | 2.0 | Reward:risk ratio for target |
| `trail_atr_mult` | 3.0 | Trailing stop ATR multiplier (chandelier) |
| `include_short` | true | Whether to surface SHORT verdicts |

If no row exists for the user, `DEFAULT_SETTINGS` is used — no row required.

---

## Screener

**Route:** `/terminal/[market]/screener`

Reads precomputed signals for the market's country, applies per-user `deriveLevels()`, attaches live quotes, and renders `ScreenerTable`.

### Columns

Dir · Current (+ day %) · Entry · Target · Stop · Trail · R:R · ~Days · Verdict

### Filters (client-side)

- Ticker search
- Market filter (hidden when `scoped=true` — i.e., within a market terminal)
- "Setups only" toggle (hides `NO_SETUP` rows)

---

## Analytical Engines

### 1. Swing Signals (`EngineSection` → `getTopSwingSetups`)

Top 6 setups for the current market, with direction badge, score bar, reason text, and all trade levels.

### 2. Fund Overlap X-Ray (India only)

Pairwise overlap = Σ min(weightA, weightB) across shared holdings. Flags pairs above threshold. Shows switch-to-direct recommendations.

### 3. Cross-Asset Macro Correlator

Pearson correlation between macro series and sector indices at 30d and 90d windows, with lead/lag scan (±maxLag bars). Signals: `ACCUMULATION_ZONE` / `DISTRIBUTION_ZONE` / `COINCIDENT` / `WEAK`.

---

## Legendary Trader Strategy Module

**File:** `lib/analytics/legendaryStrategies.ts` (pure, isomorphic — imports only types)

Five published trading systems evaluated against the latest bar of each instrument's OHLCV series. Every detector degrades gracefully — short or gappy history returns `matched: false` (never throws), so the default swing classifier still runs.

| Key | Trader | Rule | Min bars |
|-----|--------|------|----------|
| `QULLAMAGGIE` | Kristjan Qullamaggie | High Tight Flag — close > 10/20/50 EMA, ≥3× volume thrust, 3–15 day tight flag, ATR at 30-day low. Entry = flag-high breakout | ~55 |
| `MINERVINI` | Mark Minervini | 8-point Trend Template + successively narrowing VCP contractions. Entry = pivot (recent swing high) | ~200 |
| `DARVAS` | Nicolas Darvas | Confirmed box (top + bottom each held ≥3 sessions). Entry = box top + 0.01 (one tick) | ~25 |
| `PTJ` | Paul Tudor Jones | 200-day MA trend rule — trade only with a rising/falling 200-day, near the mean (not over-extended) | ~205 |
| `SIMONS` | Jim Simons | Rolling 20-day z-score mean reversion at ≥ 2.5σ. Long if z ≤ −2.5, short if z ≥ +2.5. Entry = current close | ~21 |

`evaluateLegendary(bars)` → `{ tags: StrategyKey[], scores: Record<key,{score,dir,entry}>, results }`.

### Storage (`swing_signals`, migration `0008_strategy_tags.sql`)
- `strategy_tags text[]` — matched strategy keys (GIN-indexed for `@> ARRAY[...]` filters)
- `strategy_scores jsonb` — `{ "<KEY>": { score, dir, entry } }` per matched strategy

Populated nightly by `computeSignals()` alongside the swing scan.

### Read path & UI
- `runScreener()` maps each matched strategy's custom `entry` through `deriveLevels()` with the **user's** read-time risk params → `ScreenRow.strategyLevels[key]` (entry/target/stop/trail/RR/days).
- `ScreenerTable` renders a horizontal **strategy ribbon** ("All systems" + one chip per system with a live match count). Selecting a strategy filters rows to that tag and swaps the displayed levels to that system's entry line.

### Data-coverage note
On the 60-session NSE history, `DARVAS`, `SIMONS`, and `QULLAMAGGIE` fire. The real US backfill (`scripts/backfill-us-history.mjs`, `FINANCIAL_API_KEY`) has seeded ~280–340 sessions for ~45 liquid mega-caps, which activates **`PTJ` (28 names), `DARVAS` (28), `SIMONS` (7)** on the US set. **`MINERVINI` currently returns 0** — by design it requires the full 8-point Trend Template *and* a tightening VCP; the current mega-cap set tops out at 6–7/8 (verified via diagnostic). It will fire as names set up and as US coverage widens beyond 45 tickers (Tiingo free tier caps ~50 unique symbols/hour).

---

## Corporate Fundamentals (15-year)

**Migration:** `0010_financial_reports.sql` · **Ingestion:** `lib/ingest/fundamentals.ts` (+ `scripts/ingest-fundamentals.mjs`) · **Read:** `lib/fundamentals.ts`

Tracks CMP (live, from `latest_quotes`), P/E, market cap, ROCE, and YoY quarterly profit/sales variance across the Indian universe, with up to 15 years of quarterly history per company.

### Ingestion pipeline
- Accepts a multi-year structural JSON array (FMP-style): `[{ ticker, currencyScale?, currency?, source?, reports: [...] }]`.
- **Currency normalisation** to Rs. Crore via `currencyScale` (`ABSOLUTE` | `LAKH` | `MILLION` | `BILLION` | `CRORE`).
- **Derived metrics, computed gracefully** (null on missing inputs): ROCE = EBIT / Capital Employed; P/E = price / EPS; YoY variance vs the prior-year same-quarter report (±45-day match tolerance).
- **15-year window** filter on `period_end_date`.
- **Upsert** `ON CONFLICT (asset_id, period_end_date, report_type) DO UPDATE` — revisions overwrite in place; historic quarters stay pristine. Verified idempotent (re-ingest keeps row count steady).
- A company's fundamentals attach to **all** listings of its ticker (NSE + BSE).

### Screener integration
- `runScreener` joins `latest_financials` (`getFundamentalsByAssetIds`, chunked) onto each row → `ScreenRow.{peRatio, marketCap, roce, profitVarYoY, salesVarYoY}`.
- `ScreenerTable` adds P/E · Mkt Cap · ROCE · Profit Δ · Sales Δ columns (desktop) and a fundamentals block (mobile cards), with graceful `—` for rows lacking a report.
- A **Fundamentals filter bar** (ROCE ≥, P/E ≤) composes with the technical/strategy filters — e.g. *ROCE ≥ 20% AND an active breakout* = set ROCE ≥ 20 with "Setups only".

---

## Data Ingestion

### Daily cron schedule (`vercel.json`)

| Job | UTC time | What it does |
|-----|----------|-------------|
| `backfill-us` | 22:00 weekdays | Tops up US `daily_ohlcv` (trailing ~15 sessions) from the real provider |
| `refresh-quotes` | 22:30 weekdays | Fetches latest prices for all 17,660 assets |
| `scan` | 23:00 weekdays | Runs swing classifier + legendary strategies across all OHLCV, upserts swing_signals |

Every cron run (success or failure) is recorded to `public.cron_logs` via a best-effort logger (`lib/ingest/cronLog.ts`), and all three routes are strictly gated by `CRON_SECRET` (`checkCronAuth` — an *unset* secret is treated as misconfiguration → 500, never "open").

### Quote sources

- **US equities** — NASDAQ screener bulk API (no key, returns lastsale + pctchange for all NASDAQ/NYSE/AMEX)
- **India equities** — NSE `sec_bhavdata_full` + BSE `BhavCopy_BSE_CM` daily bhavcopy CSVs
- **Futures / bonds / currencies** — derived from equity proxy or seeded statics

### OHLCV sources

- **India** — NSE bhavcopy (60-day rolling backfill, ~108k bars for 1,914 instruments)
- **US** — **real, split-adjusted EOD via Tiingo** (`lib/ingest/usHistory.ts`; manual seed `scripts/backfill-us-history.mjs`). Requires `FINANCIAL_API_KEY`. Pulls ≥250 sessions so the Minervini / PTJ 200-day indicators activate. Resilient: per-ticker isolation, timeout + exponential-backoff retry on 429/5xx, bounded concurrency. **No synthetic fallback** — a missing key errors loudly. (Provider is pluggable — Alpha Vantage / Polygon slot into the `PROVIDERS` map.)

---

## Theme System

Two market themes applied via CSS custom properties on `<html>`:

| Variable | US | India |
|----------|----|-------|
| `--ig-primary` | `#3b82f6` (blue) | `#f97316` (saffron) |
| `--ig-accent` | `#06b6d4` (cyan) | `#eab308` (gold) |
| `--ig-glow` | blue glow | amber glow |

`ApplyMarketTheme` (client component, `use client`) injects these on mount so the correct palette renders server-side with inline `<style>` fallback, then hydrates.

---

## Auth Flow

1. Supabase email/password auth (`/login`)
2. `proxy.ts` (Next.js 16 session-refresh proxy, formerly `middleware.ts`) refreshes the session cookie on every request
3. Protected routes (`/terminal/*`, `/settings`) call `supabase.auth.getUser()` and redirect to `/login` if no session
4. `ensureScaffold()` creates default portfolio + watchlist rows on first login

---

## Known Gaps / Pending Work

| # | Item | Priority |
|---|------|---------|
| 1 | **Rotate DB password** — `Shamshad~0148` was pasted in chat; must be changed in Supabase → Project Settings → Database → Reset, then update `.env.local` + Vercel env var | Critical |
| 2 | ✅ **Real US OHLCV** — Tiingo integration shipped (`lib/ingest/usHistory.ts`, `scripts/backfill-us-history.mjs`). **Action:** set `FINANCIAL_API_KEY` and run the one-off seed to activate Minervini/PTJ | Done (needs key) |
| 3 | **Vercel env vars** — set `DATABASE_URL` (pooler), `CRON_SECRET`, `FINANCIAL_API_KEY`, Supabase URL/key in Vercel so crons run in production. Cron hardening + `cron_logs` shipped | In progress |
| 4 | ✅ **Mobile screener layout** — card-list view below `md:` shipped; table is `hidden md:block`, cards `md:hidden` | Done |
| 5 | **Watchlist price alerts** — email / push notification when a watched ticker crosses entry level | Medium |
| 6 | **Portfolio performance chart** — historical portfolio value vs. benchmark curve | Medium |
| 7 | **Options chain view** — surface derivative_meta expiry + OI for hedging context | Low |
| 8 | **MCP Supabase auth** — authenticate the Supabase MCP server for direct DB introspection from Claude | Low |

---

## Environment Variables

```env
# .env.local (gitignored)
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=eyJ...
DATABASE_URL=postgresql://postgres:<password>@<host>:5432/postgres
CRON_SECRET=<random-secret>
FINANCIAL_API_KEY=<tiingo-token>   # real US EOD history (Minervini/PTJ)
```

These vars must be set in Vercel → Project → Settings → Environment Variables for production crons to work.
