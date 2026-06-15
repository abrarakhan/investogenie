# InvestoGenie — What the App Can Do

> Review-oriented capabilities overview. State as of **2026-06-15**, commit `f1f080b`.
> Companion to the technical [ARCHITECTURE.md](ARCHITECTURE.md). Every capability below was exercised against the running app.

---

## In one line

A cinematic, mobile-friendly **multi-asset trading terminal for the US and Indian markets** — portfolio tracking, a derivatives-aware swing screener, five "legendary trader" strategy systems, 15-year corporate fundamentals, and cross-asset analytics — over real end-of-day data with nightly automated ingestion.

---

## Capabilities at a glance

| Area | What it does | Status |
|------|--------------|--------|
| Dual-market terminals | Separate **US** (`/terminal/us`) and **India** (`/terminal/in`) workspaces, each themed and currency-correct | ✅ Working |
| Landing experience | WebGL hero (Three.js), GSAP kinetic typography, US/India pivot switch, live ticker tape | ✅ Working |
| Auth | Supabase email/password; protected terminals & settings redirect to `/login` | ✅ Working |
| Portfolio | Per-market holdings, live P&L, trade ticket (buy/sell), watchlist with live quotes | ✅ Working |
| Swing screener | Per-market screener over the full universe with classifier verdicts + trade levels | ✅ Working |
| Legendary strategies | 5 systems (Qullamaggie, Minervini, Darvas, PTJ, Simons) with filter ribbon | ✅ Working |
| Per-user risk | Configurable stop/target/trail; long **and** short setups; expected duration | ✅ Working |
| Fundamentals | 15-year quarterly metrics (P/E, Market Cap, ROCE, YoY profit/sales Δ) + screener filters | ✅ Pipeline live (sample data) |
| Analytical engines | Swing signals, mutual-fund overlap (India), cross-asset macro correlator | ✅ Working |
| Data ingestion | Nightly crons: US (Tiingo), India (NSE/BSE bhavcopy), swing scan, incremental US coverage walk | ✅ Working |
| Mobile | Responsive throughout; screener collapses to a card list below `md:` | ✅ Working |

---

## 1. Two markets, one terminal

US and India are **fully separate terminals**, not a blended view — each with its own theme (US sovereign-blue, India saffron-gold), benchmarks, currency, and locale formatting. Holdings, watchlists, and analytics are all scoped to the active market. A one-tap switch (and the landing-page pivot) moves between them.

## 2. Portfolio & trading workspace

- **Holdings table** — quantity, average cost, live last price + day change, market value, unrealized P&L (per-currency, no incorrect cross-currency summing).
- **Trade ticket** — typeahead asset picker (scoped to the market, with live prices) + buy/sell entry that records transactions.
- **Watchlist** — add/remove instruments with live quotes.
- **Benchmarks** — index summary cards per market.

## 3. Derivatives-aware swing screener

A nightly classifier scans the whole universe and precomputes setups; the screener reads them and derives trade levels **at read time** using the signed-in user's risk settings. Columns: direction, current price, entry, target, stop, trailing stop, R:R, expected days, and verdict.

**Verdicts:** `LONG_BREAKOUT`, `COILED_SPRING`, `BREAKOUT_UNCONFIRMED`, and the short-side `SHORT_BREAKDOWN`, `SHORT_COILED_SPRING`, `BREAKDOWN_UNCONFIRMED`. A breakout is upgraded to a *validated* long only when a concurrent open-interest build-up confirms it.

**Live numbers when tested:** India 1,840 scanned / 224 active setups; US 72 scanned / 14 setups.

## 4. Legendary trader strategy systems

Five published systems are evaluated on every instrument and surfaced as a **filter ribbon** with live match counts. Selecting one filters the screener to that signature and swaps the displayed entry/target/stop to that system's own entry line (run through your personal risk parameters):

| System | Rule |
|--------|------|
| **Qullamaggie** | High Tight Flag — volume thrust then a tight 3–15 day compression above the 10/20/50 EMAs |
| **Minervini** | 8-point Trend Template + a tightening VCP (volatility contraction) |
| **Darvas** | Box breakout — entry one tick above a confirmed box top |
| **PTJ** | The 200-day moving-average trend rule |
| **Simons** | Statistical mean reversion at a ±2.5σ 20-day z-score extreme |

## 5. Personal risk profile

Each user can configure (with sensible defaults): stop distance (×ATR), reward:risk target, and trailing-stop multiplier, plus a toggle to include short setups. Every level in the screener and dashboard recomputes to that profile instantly — no rescan needed. Each setup also estimates an **expected holding duration** in days.

## 6. 15-year corporate fundamentals

A fundamentals pipeline ingests multi-year quarterly financials (normalized to Rs. Crore), computes **P/E, Market Cap, ROCE, and YoY profit/sales variance**, and joins the latest quarter onto the screener. Users can filter by **ROCE ≥** and **P/E ≤** *combined with* the technical signal — e.g. "ROCE ≥ 20% **and** an active breakout." Rows without a report on file degrade cleanly to "—".

**Verified live (India):** ACC P/E 21.6 / ROCE 12.9%, DABUR ROCE 20.3%, ICICIBANK ₹1.85L Cr market cap.

## 7. Cross-asset analytical engines

- **Swing signals** — top setups for the market with direction, score, and levels.
- **Fund Overlap X-Ray** (India) — look-through pairwise overlap across mutual-fund holdings, flags congestion and suggests direct-plan switches.
- **Macro correlator** — rolling 30/90-day correlation and lead/lag between macro series and sector proxies, surfacing accumulation/distribution zones.

## 8. Automated data ingestion

Real end-of-day data, refreshed on a schedule (Vercel cron), with every run audited to a `cron_logs` table and all routes secret-gated:

| Job | Cadence | Purpose |
|-----|---------|---------|
| `backfill-us-expand` | hourly | Incremental walk of the full US universe (resumable, rate-limit-aware) |
| `backfill-us` | weekday | Top-up US daily bars (Tiingo) |
| `refresh-quotes` | weekday | Latest prices across the whole universe |
| `scan` | weekday | Swing classifier + strategies → precomputed signals |

**Sources:** US — Tiingo (real, split-adjusted EOD) + NASDAQ screener (latest quotes); India — NSE `sec_bhavdata_full` + BSE bhavcopy.

## 9. Design & platform

- **Stack:** Next.js 16 (App Router, React 19), Supabase (auth/RLS/Postgres), Tailwind, Three.js + GSAP, `pg` for ingestion.
- **Mobile:** responsive layouts throughout; the dense screener table becomes a stacked, touch-friendly card list on phones.
- **Security:** row-level security on all user data; service-only reference tables; cron routes gated by a strict secret.

---

## Honest status & limitations (for reviewers)

- **US history coverage is growing, not complete.** Real Tiingo EOD is loaded for ~80 liquid names so far; the hourly `backfill-us-expand` walk widens this within Tiingo's free-tier limits (~480 unique symbols/month, so full coverage of ~10k names is a long tail — a paid tier or curated subset closes it fast).
- **Fundamentals are sample data today.** The ingestion pipeline, schema, and screener wiring are real and FMP-shaped, but the currently-loaded India figures are a generated sample (tagged `source: "sample-fmp"`). Point it at a real FMP/screener export to go live.
- **Minervini/PTJ need long history.** PTJ is active on the US set; Minervini is strict (full 8/8 template + VCP) and currently flags 0 until more names set up and coverage deepens.
- **Index benchmark cards** (Nifty/Sensex/Nasdaq/USD-INR summary tiles) still show static placeholder values; wiring them to a live source (e.g. Frankfurter for FX, an India broker feed for indices) is the next step.
- **Production env vars** must be set in Vercel for the scheduled crons to run there (`DATABASE_URL` with the rotated password, `CRON_SECRET`, `FINANCIAL_API_KEY`, Supabase keys).
- Some screener rows can show an entry level far from the current price when the live quote and the last precomputed scan are on different freshness cycles — re-running the nightly `scan` realigns them.

---

## Try it

```bash
npm install
npm run dev        # http://localhost:3000
```

Public to browse: `/` (landing), `/terminal/us/screener`, `/terminal/in/screener`.
Sign in (`/login`) to reach the terminals, portfolio, and `/settings`.
