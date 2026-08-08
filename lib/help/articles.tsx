import type { ReactNode } from "react";
import {
  H2, H3, P, UL, LI, Formula, Callout, SpecTable, References,
} from "@/components/help/HelpLayout";

export type HelpCategory = "swing" | "probability" | "engine" | "long-term";

export interface HelpArticle {
  slug: string;
  category: HelpCategory;
  title: string;
  subtitle: string;
  /** Named trader / origin, shown on strategy cards. */
  trader?: string;
  readMins: number;
  summary: string;
  Body: () => ReactNode;
}

// ---------------------------------------------------------------------------
// Swing engine — how the buy-side shortlist is built (base classifier + levels)
// ---------------------------------------------------------------------------

const swingEngine: HelpArticle = {
  slug: "swing-engine",
  category: "engine",
  title: "How Swing Candidates are built",
  subtitle: "The base classifier, the trade levels, and how the five legendary systems layer on top.",
  readMins: 7,
  summary:
    "Every candidate starts from one structural classifier (Bollinger squeeze / Donchian breakout) and gets concrete entry, target, stop and trailing-stop levels from ATR. The legendary strategies are additional lenses over the same rows.",
  Body: () => (
    <>
      <P>
        The Swing Candidates screen is not a single indicator. It has two layers: a{" "}
        <strong>structural classifier</strong> that decides whether the latest bar is a setup at
        all, and a <strong>level engine</strong> that turns that setup into an actionable
        entry / target / stop / trailing-stop plan using the stock&apos;s own volatility. The
        five named systems (Qullamaggie, Minervini, Darvas, PTJ, Simons) are separate lenses
        scored over the same universe and surfaced as tags.
      </P>

      <H2>Layer 1 — the structural classifier</H2>
      <P>
        For each stock the classifier reads its daily bars and evaluates the most recent one.
        It looks for a <em>structural trigger</em> and, where derivatives data exists, a
        confirming Open-Interest build-up.
      </P>
      <SpecTable
        rows={[
          { k: "Bollinger Bands", v: "20-bar SMA ± 2σ (sample standard deviation). Bandwidth = (upper − lower) / middle." },
          { k: "Squeeze", v: "current bandwidth sits in the lowest 25% of its own recent history — a volatility compression." },
          { k: "Donchian channel", v: "highest high / lowest low of the prior 20 bars (the current bar is excluded)." },
          { k: "Breakout", v: "close > prior-20-bar Donchian high, or close > upper Bollinger band." },
          { k: "Long build-up", v: "price up AND Open Interest up ≥ 5% over the short window (derivatives only)." },
          { k: "Volume", v: "latest volume ÷ 20-bar average; ≥ 1.5× corroborates a trigger." },
        ]}
      />
      <P>
        The conviction <strong>score (0–1)</strong> adds up the evidence: breakout 0.35, squeeze
        0.25, OI build-up 0.30, volume confirmation 0.10. Cash equities have no Open Interest, so
        they top out at <strong>0.70</strong> and carry a &ldquo;breakout unconfirmed&rdquo;
        verdict — the OI leg that would confirm a breakout simply isn&apos;t available.
      </P>
      <Callout tone="warn">
        Because most Indian and US equities have no live OI feed here, a 0.70 score is the normal
        ceiling for a clean cash breakout — not a weakness in the individual name.
      </Callout>

      <H2>Layer 2 — the trade levels</H2>
      <P>
        Once a stock is a setup, the level engine derives a concrete plan from the current price,
        the 14-bar ATR, and your risk settings (defaults shown). These are recomputed at read
        time against the live quote, so the levels track the latest price.
      </P>
      <Formula>{`ATR        = 14-bar Average True Range
entry      = max(breakout trigger, current price)
stop       = entry − 1.5 × ATR        (stopAtrMult, default 1.5)
risk  (R)  = entry − stop
target     = entry + 2 × R            (targetRR, default 2.0)
trailing   = max(22-bar high, price) − 3 × ATR   (chandelier, trailAtrMult 3)
R:R        = (target − entry) / R  ≈  2.0
exp. days  = round(|target − entry| / avg daily move), capped 1..60`}</Formula>
      <P>
        Because the target is defined as two times the risk distance, the reward-to-risk ratio is
        <strong> 2.0 by construction</strong>. Change the stop multiple or target multiple in
        Settings and every row re-derives instantly — no rescan needed. Short setups mirror the
        same math on the other side.
      </P>

      <H2>Layer 3 — the legendary lenses</H2>
      <P>
        Independently, five classic systems are scored on every stock and attached as tags. A row
        can carry several (e.g. &ldquo;Darvas Box&rdquo; + &ldquo;PTJ 200-Day Trend&rdquo;). The
        strategy ribbon at the top of the screen filters to one system at a time. Each has its own
        detailed write-up — start with whichever style matches how you trade.
      </P>
      <Callout>
        The classifier and the level engine are deterministic and dependency-free — the same code
        runs in the browser, the API, and the nightly scan job, so what you see on screen matches
        what the scan stored.
      </Callout>

      <References
        items={[
          { text: "J. Bollinger, Bollinger on Bollinger Bands (McGraw-Hill, 2001) — bands and bandwidth squeeze." },
          { text: "R. Donchian — Donchian channel breakout (trend-following channel of prior N-bar highs/lows)." },
          { text: "J. W. Wilder Jr., New Concepts in Technical Trading Systems (1978) — Average True Range and the chandelier/ATR trailing stop." },
        ]}
      />
    </>
  ),
};

// ---------------------------------------------------------------------------
// Qullamaggie — High Tight Flag
// ---------------------------------------------------------------------------

const qullamaggie: HelpArticle = {
  slug: "qullamaggie-momentum",
  category: "swing",
  title: "Qullamaggie Momentum — the High Tight Flag",
  subtitle: "A volume thrust followed by a shallow, quiet consolidation above a stacked EMA trend.",
  trader: "Kristjan Kullamägi",
  readMins: 6,
  summary:
    "Detects a ≥3× volume 'flagpole' then a 3–15 day tight flag above the 10/20/50 EMAs with ATR pinned to a 30-day low. Entry on the break of the flag high.",
  Body: () => (
    <>
      <P>
        Kristjan Kullamägi (&ldquo;Qullamaggie&rdquo;) is a Swedish swing trader known for riding
        momentum breakouts out of tight bases. The High Tight Flag is one of his signature setups:
        an explosive move (the flagpole) followed by a shallow, low-volatility pause (the flag),
        entered as price breaks out of that pause.
      </P>

      <H2>Where it comes from</H2>
      <P>
        The High Tight Flag is a classic momentum pattern also described in the CAN SLIM / IBD
        tradition. Kullamägi popularised a disciplined, mechanical version through his public
        education (qullamaggie.com and his interviews). This app implements a measurable adaptation
        of that idea.
      </P>

      <H2>What the app calculates</H2>
      <P>All five conditions below must hold on the latest bar for a match (needs ~55 bars):</P>
      <SpecTable
        rows={[
          { k: "EMA stack", v: "close is above the 10-, 20- and 50-period EMAs simultaneously (established uptrend)." },
          { k: "Volume thrust", v: "some bar 3–15 sessions ago traded ≥ 3× its trailing-50 average volume (the flagpole)." },
          { k: "Flag length", v: "the consolidation since that thrust is 3–15 sessions long." },
          { k: "Tightness", v: "flag high-to-low depth ≤ 12% of the flag high." },
          { k: "ATR compression", v: "current 14-bar ATR is at or within 5% of its 30-bar low." },
          { k: "Entry", v: "a break above the flag high." },
          { k: "Score", v: "fraction of the five conditions met (a full match = 1.0)." },
        ]}
      />
      <Formula>{`match  = aboveStack AND volumeThrust AND flagLength(3..15)
         AND depth ≤ 12% AND atrNow ≤ 1.05 × atr30Low
entry  = flag high
`}</Formula>

      <H2>How to read it in the app</H2>
      <P>
        Filter the strategy ribbon to <strong>Qullamaggie Momentum</strong>. A tagged row is a
        stock currently sitting in a valid high-tight flag; the entry level is the flag high it
        needs to clear. Higher scores mean more of the five conditions are simultaneously true.
      </P>
      <Callout tone="warn">
        Momentum setups are trend-continuation bets — they assume the prior thrust resumes. They
        fail hardest in choppy, mean-reverting regimes. Treat the entry as a trigger, not a
        guarantee, and pair it with the Probability screen for context.
      </Callout>

      <References
        items={[
          { text: "Kristjan Kullamägi — public trading education (qullamaggie.com), breakout / episodic-pivot / high-tight-flag methodology." },
          { text: "W. J. O'Neil, How to Make Money in Stocks (McGraw-Hill) — CAN SLIM and the high-tight-flag base as a momentum continuation pattern." },
        ]}
      />
    </>
  ),
};

// ---------------------------------------------------------------------------
// Minervini — VCP
// ---------------------------------------------------------------------------

const minervini: HelpArticle = {
  slug: "minervini-vcp",
  category: "swing",
  title: "Minervini VCP — Trend Template + Volatility Contraction",
  subtitle: "An 8-point trend filter, then successively tightening pullbacks into a pivot.",
  trader: "Mark Minervini",
  readMins: 7,
  summary:
    "Requires all 8 Trend-Template criteria plus a Volatility Contraction Pattern — recent pullbacks that step down in depth and end shallow. Pivot entry at the recent high.",
  Body: () => (
    <>
      <P>
        Mark Minervini is a U.S. Investing Champion whose SEPA methodology combines a strict trend
        filter with the Volatility Contraction Pattern (VCP). The idea: only buy leaders in
        confirmed uptrends, and only when supply has dried up — visible as pullbacks that get
        progressively shallower before a breakout.
      </P>

      <H2>Where it comes from</H2>
      <P>
        Documented in Minervini&apos;s books, notably <em>Trade Like a Stock Market Wizard</em>{" "}
        (2013) and <em>Think &amp; Trade Like a Champion</em>{" "}(2016). The 8-point Trend Template and
        the VCP &ldquo;footprint&rdquo; are his; this app encodes a mechanical version.
      </P>

      <H2>What the app calculates</H2>
      <H3>The 8-point Trend Template</H3>
      <SpecTable
        rows={[
          { k: "1", v: "close is above both the 150- and 200-day SMAs." },
          { k: "2", v: "the 150-day SMA is above the 200-day SMA." },
          { k: "3", v: "the 200-day SMA is trending up (higher than ~1 month / 22 bars ago)." },
          { k: "4", v: "50-day SMA > 150-day SMA > 200-day SMA (proper stack)." },
          { k: "5", v: "close is above the 50-day SMA." },
          { k: "6", v: "close is ≥ 30% above its 52-week low." },
          { k: "7", v: "close is within 25% of its 52-week high." },
          { k: "8", v: "relative strength — approximated here by a strong 6-month absolute return (≥ 10%)." },
        ]}
      />
      <Callout tone="warn">
        Criterion 8 in Minervini&apos;s work is an IBD-style Relative Strength rank above 70 across
        the whole market. Without a cross-sectional RS feed, the app substitutes a 6-month absolute
        return proxy — a deliberate, documented approximation.
      </Callout>
      <H3>The VCP confirmation</H3>
      <P>
        The app finds swing pivots over the last ~120 bars and measures each peak-to-trough
        contraction depth. It then checks the most recent contractions:
      </P>
      <Formula>{`recent = last up-to-4 contraction depths
narrowing = each contraction is shallower than the previous one
         AND the final contraction ≤ 15% deep
match = (Trend Template 8/8) AND narrowing
score = (passed / 8) × 0.7 + (narrowing ? 0.3 : 0)
pivot entry = highest high of the last 10 bars`}</Formula>

      <H2>How to read it in the app</H2>
      <P>
        Filter to <strong>Minervini VCP</strong>. A match means a full 8/8 trend leader whose
        volatility is contracting into a pivot; the entry is that pivot high. The score also
        rewards near-misses (e.g. 7/8 trend, or trend without a clean VCP) so you can see how close
        a name is.
      </P>

      <References
        items={[
          { text: "M. Minervini, Trade Like a Stock Market Wizard (McGraw-Hill, 2013) — SEPA, the 8-point Trend Template, and the VCP." },
          { text: "M. Minervini, Think & Trade Like a Champion (Access Publishing, 2016) — entry pivots and risk management." },
        ]}
      />
    </>
  ),
};

// ---------------------------------------------------------------------------
// Darvas Box
// ---------------------------------------------------------------------------

const darvas: HelpArticle = {
  slug: "darvas-box",
  category: "swing",
  title: "Darvas Box — trading the box breakout",
  subtitle: "A confirmed high/low range, entered one tick above the box top.",
  trader: "Nicolas Darvas",
  readMins: 5,
  summary:
    "Builds a box from a confirmed high and a confirmed low, and flags stocks coiled inside it. Buy-stop sits one tick above the box top.",
  Body: () => (
    <>
      <P>
        Nicolas Darvas was a professional dancer who famously grew a modest stake into over
        $2,000,000 in the late 1950s, trading by telegram while touring. His &ldquo;box
        theory&rdquo; frames a stock&apos;s price as a series of stacked boxes; you buy as it breaks
        out of the top of the current box.
      </P>

      <H2>Where it comes from</H2>
      <P>
        Described in his 1960 classic <em>How I Made $2,000,000 in the Stock Market</em>. The app
        implements a mechanical version of box construction and confirmation.
      </P>

      <H2>What the app calculates</H2>
      <SpecTable
        rows={[
          { k: "Window", v: "the most recent ~60 bars (or all available if fewer, min 25)." },
          { k: "Box top", v: "the highest high in the window, confirmed by ≥ 3 later sessions that all fail to exceed it." },
          { k: "Box bottom", v: "the lowest low after the top, confirmed by ≥ 3 later sessions that all hold above it." },
          { k: "Actionable", v: "price is currently inside the box (between confirmed bottom and top)." },
          { k: "Entry", v: "box top + 0.01 — a buy-stop one tick above the top." },
          { k: "Score", v: "fraction of {top confirmed, bottom confirmed, inside box} that hold." },
        ]}
      />
      <Formula>{`boxFormed = topConfirmed AND bottomConfirmed AND boxTop > boxBottom
match     = boxFormed AND (boxBottom ≤ close ≤ boxTop)
entry     = boxTop + 0.01`}</Formula>

      <H2>How to read it in the app</H2>
      <P>
        Filter to <strong>Darvas Box</strong>. A tagged row is coiled inside a confirmed box; the
        entry is the buy-stop just above the box top. The requirement for ≥3 confirming sessions on
        both edges filters out unformed, still-moving ranges.
      </P>
      <Callout tone="warn">
        Box breakouts can be faked out — price pokes above the top and reverses. Darvas managed this
        with tight stops just under the breakout; the app&apos;s standard stop (1.5 × ATR below
        entry) plays the same role.
      </Callout>

      <References
        items={[
          { text: "N. Darvas, How I Made $2,000,000 in the Stock Market (1960) — box theory and breakout entries." },
        ]}
      />
    </>
  ),
};

// ---------------------------------------------------------------------------
// PTJ — 200-day trend
// ---------------------------------------------------------------------------

const ptj: HelpArticle = {
  slug: "ptj-200-day-trend",
  category: "swing",
  title: "PTJ 200-Day Trend — trade with the 200-day",
  subtitle: "Only long above a rising 200-day average, only short below a falling one — near the mean.",
  trader: "Paul Tudor Jones",
  readMins: 5,
  summary:
    "Uses the 200-day moving average as a regime filter: trade only in the direction of its slope, and prefer entries near the mean rather than over-extended.",
  Body: () => (
    <>
      <P>
        Paul Tudor Jones is one of the most successful macro traders of his generation. He is widely
        quoted on using the 200-day moving average as a master risk filter — famously,
        &ldquo;my metric for everything I look at is the 200-day moving average of closing
        prices.&rdquo; The rule keeps you on the right side of the primary trend.
      </P>

      <H2>Where it comes from</H2>
      <P>
        The 200-day rule appears throughout PTJ&apos;s interviews and profiles (e.g. Jack
        Schwager&apos;s <em>Market Wizards</em>, 1989). This app turns the regime filter into a
        long/short trigger.
      </P>

      <H2>What the app calculates</H2>
      <P>Needs ~222 bars (200-day SMA plus a month of slope). It computes the 200-day SMA now and ~22 bars ago:</P>
      <SpecTable
        rows={[
          { k: "Rising / falling", v: "SMA200 now vs SMA200 ~22 bars ago sets the trend direction." },
          { k: "Long regime", v: "price above a rising 200-day AND proximity to it ≤ 15% (not over-extended)." },
          { k: "Short regime", v: "price below a falling 200-day AND within 15% of it." },
          { k: "Mixed regime", v: "anything else — PTJ stands aside (no signal)." },
          { k: "Entry (long)", v: "break of the highest high of the last 10 bars." },
          { k: "Entry (short)", v: "break of the lowest low of the last 10 bars." },
        ]}
      />
      <Formula>{`slopePct = |SMA200_now − SMA200_prior| / SMA200_prior
score(long)  = (1 + rising + nearMean + min(1, slopePct × 50)) / 4
proximity    = (close − SMA200) / SMA200      // long: ≤ 0.15 = near mean`}</Formula>

      <H2>How to read it in the app</H2>
      <P>
        Filter to <strong>PTJ 200-Day Trend</strong>. A tagged long is a stock above a rising
        200-day that has pulled back near the average — a &ldquo;buy the dip in an uptrend&rdquo;
        entry. The score rises with a steeper, cleaner trend and closer proximity to the mean.
      </P>

      <References
        items={[
          { text: "J. D. Schwager, Market Wizards (NYIF, 1989) — Paul Tudor Jones interview and risk philosophy." },
          { text: "Paul Tudor Jones — widely cited remarks on the 200-day moving average as a primary trend/risk filter." },
        ]}
      />
    </>
  ),
};

// ---------------------------------------------------------------------------
// Simons — statistical mean reversion
// ---------------------------------------------------------------------------

const simons: HelpArticle = {
  slug: "simons-quant-reversion",
  category: "swing",
  title: "Simons Quant Reversion — rolling z-score extremes",
  subtitle: "A statistical mean-reversion tag when price stretches ≥ 2.5σ from its 20-day mean.",
  trader: "Jim Simons",
  readMins: 5,
  summary:
    "Computes a 20-day z-score of price; ≤ −2.5σ flags a long (oversold), ≥ +2.5σ flags a short (overbought). Conviction scales with the distance past the threshold.",
  Body: () => (
    <>
      <P>
        Jim Simons founded Renaissance Technologies, whose Medallion fund posted some of the best
        risk-adjusted returns in history using quantitative, statistical models. A recurring theme
        in statistical trading is <strong>mean reversion</strong>: extreme short-term moves tend to
        partially retrace. This tag is a simple, transparent expression of that idea.
      </P>

      <H2>Where it comes from</H2>
      <P>
        Renaissance&apos;s actual models are proprietary and far more complex. The characterization
        of short-horizon statistical mean reversion is general (see Gregory Zuckerman&apos;s{" "}
        <em>The Man Who Solved the Market</em>, 2019). This is an <em>inspired-by</em> single-factor
        version, not a replica.
      </P>

      <H2>What the app calculates</H2>
      <P>Over the last 20 closes (needs ~21 bars):</P>
      <Formula>{`mean = 20-day average close
sd   = 20-day sample standard deviation
z    = (close − mean) / sd

z ≤ −2.5σ  →  LONG   (statistically oversold, revert up)
z ≥ +2.5σ  →  SHORT  (statistically overbought, revert down)
score = min(1, |z| / 3.5)
entry = current close`}</Formula>
      <SpecTable
        rows={[
          { k: "Trigger", v: "the 20-day z-score reaches ±2.5σ — a ~2-in-100 event under a normal assumption." },
          { k: "Direction", v: "oversold reverts long; overbought reverts short." },
          { k: "Score", v: "scales with how far past 2.5σ the close sits, capped at 1.0 (≈3.5σ)." },
          { k: "Entry", v: "the current close (immediate statistical entry)." },
        ]}
      />

      <H2>How to read it in the app</H2>
      <P>
        Filter to <strong>Simons Quant Reversion</strong>. A tagged long is a stock stretched far
        below its own 20-day mean; the thesis is a bounce back toward that mean — the opposite bet
        from the momentum strategies.
      </P>
      <Callout tone="warn">
        Mean reversion is dangerous in a strong trend: a stock can stay &ldquo;oversold&rdquo; and
        keep falling. This single-factor z-score has no regime filter, so it is best read alongside
        the trend strategies rather than in isolation.
      </Callout>

      <References
        items={[
          { text: "G. Zuckerman, The Man Who Solved the Market (Portfolio, 2019) — Renaissance Technologies and statistical trading." },
          { text: "Statistical mean reversion / z-score extremes — a standard quantitative signal; the app uses a transparent single-factor form." },
        ]}
      />
    </>
  ),
};

// ---------------------------------------------------------------------------
// Probability method
// ---------------------------------------------------------------------------

const probability: HelpArticle = {
  slug: "probability-method",
  category: "probability",
  title: "The Probability method — 21-day return forecasts",
  subtitle: "A cross-sectional factor model turning momentum, mean-reversion and volatility into a distribution.",
  readMins: 8,
  summary:
    "For each stock, blends 12-1 and 6-1 momentum, short-term snapback, and EWMA volatility into an expected 21-day return, a probability of an up move, drawdown risk, and a Student-t price range.",
  Body: () => (
    <>
      <P>
        The Probability screen answers a different question from Swing Candidates. Instead of
        &ldquo;is this a setup?&rdquo; it estimates, over the next <strong>21 trading days</strong>,
        a full distribution of outcomes: expected return, the odds of finishing up, downside risk,
        and a projected price range. It is research context — explicitly not a buy/sell instruction.
      </P>

      <H2>The factors</H2>
      <P>
        Each stock&apos;s features are turned into cross-sectional z-scores (standardised against
        the whole eligible universe), so a stock is judged relative to its peers:
      </P>
      <SpecTable
        rows={[
          { k: "12-1 momentum", v: "return from ~12 months ago to ~1 month ago (classic momentum, skipping the last month)." },
          { k: "6-1 momentum", v: "return from ~6 months ago to ~1 month ago (faster momentum)." },
          { k: "20DMA snapback", v: "how far price sits above/below its 20-day mean (mean-reversion pull)." },
          { k: "5-day snapback", v: "recent 5-day return vs its own 120-day distribution." },
          { k: "EWMA volatility", v: "RiskMetrics exponentially-weighted daily volatility (λ = 0.94)." },
        ]}
      />

      <H2>From factors to a forecast</H2>
      <Formula>{`momentum   = 1.15·z(12-1) + 0.55·z(6-1)
snapback   = −0.22·z(20DMA) − 0.14·z(5-day)
volPenalty = −0.18 · max(0, annualVol − 0.35)
expReturn  = clamp(1.55·momentum + snapback + volPenalty, −18%, +18%)

σ(21d)     = clamp(dailyσ × √21 × 100, 2%, 45%)
SNR        = expReturn / max(1, σ21)
P(up)      = clamp(sigmoid(SNR × 1.75) × 100, 5%, 95%)
drawdownRisk = sigmoid((σ21 − 10 + max(0, −expReturn)) / 6) × 100`}</Formula>
      <P>
        Momentum is weighted positively (winners tend to keep winning over these horizons), while
        stretched price and hot 5-day runs pull the estimate back down. High volatility is
        penalised. The result is squashed into an expected return, then converted to a probability
        via a signal-to-noise ratio.
      </P>

      <H2>The price range</H2>
      <P>
        The projected range uses <strong>Student-t</strong> quantiles with 5 degrees of freedom —
        fatter tails than a normal distribution, which better matches real return behaviour. The
        raw t-quantiles are unit-scaled before applying the volatility, so the band width matches
        the modelled σ rather than being ~29% too wide:
      </P>
      <Formula>{`tScale        = √(df / (df − 2)) = √(5/3) ≈ 1.29
returnAt(p)   = expReturn + (t5[p] / tScale) × σ21
priceAt(p)    = lastPrice × (1 + returnAt(p) / 100)   for p in {5,25,50,75,95}`}</Formula>
      <P>
        This yields five percentile prices (p5…p95) — a fan of where the stock could reasonably sit
        in 21 days, with the median (p50) as the central projection.
      </P>

      <H2>Coverage &amp; ranking</H2>
      <UL>
        <LI>Only stocks with at least <strong>280 bars</strong> of history are eligible (enough to compute 12-month momentum and stable volatility).</LI>
        <LI>Candidates are pre-ranked by market cap, then forecasts are sorted by probability of an up move.</LI>
        <LI>The screen reports coverage: how many names were eligible, forecasted, and skipped for insufficient history.</LI>
      </UL>

      <Callout tone="warn">
        <strong>Calibration pending.</strong> The factor weights are hand-tuned, not yet fit to
        realised outcomes, so every row is flagged as an exploratory estimate. Read the
        probabilities as directional and relative — not as validated, backtested hit-rates.
      </Callout>

      <References
        items={[
          { text: "N. Jegadeesh & S. Titman (1993), “Returns to Buying Winners and Selling Losers” — the momentum effect." },
          { text: "J. P. Morgan/Reuters, RiskMetrics Technical Document (1996) — EWMA volatility with λ = 0.94." },
          { text: "Student's t-distribution — fat-tailed return modelling; df = 5 with unit-variance scaling." },
        ]}
      />
    </>
  ),
};

// ---------------------------------------------------------------------------
// Long-Term Investment (LTI) Candidates — how the engine is built, and the six
// strategies it scores. See lib/analytics/longTermStrategies.ts for the code
// these articles describe.
// ---------------------------------------------------------------------------

const longTermEngine: HelpArticle = {
  slug: "long-term-engine",
  category: "long-term",
  title: "How Long-Term Candidates are built",
  subtitle: "Multi-year evidence, six investor-inspired rankings, and an honest account of what remains approximate.",
  readMins: 6,
  summary:
    "Every fundamentals-covered stock is scored against one selected long-horizon strategy using annual history, the latest quarterly report, current price and explicit evidence confidence.",
  Body: () => (
    <>
      <P>
        Long-Term Candidates scores every stock against six well-known investors&apos; published
        fundamentals criteria and ranks the best matches. This is a separate research path from
        the Stock Screener: it reads the full fundamentals-covered universe directly, derives
        three- and five-year growth and median ROCE from annual reports, and combines those with
        the latest quarterly ratios and current quote.
      </P>

      <H2>What the data can and cannot do</H2>
      <P>
        These six investors wrote their tests decades apart, for different markets, often assuming
        data depth this app cannot always obtain from a free provider: decade-spanning statements,
        uninterrupted dividend records, R&amp;D detail and qualitative moat or management evidence.
        The app now stores normalized income statements, balance sheets and cash flows and uses
        only matching annual periods. Missing rows reduce evidence confidence instead of being
        fabricated from unrelated fields.
      </P>
      <SpecTable
        rows={[
          { k: "Available when synced", v: "Annual revenue/profit history, balance-sheet liquidity and debt, operating/free cash flow, cash conversion, interest coverage, price-to-book and EBIT/enterprise-value yield." },
          { k: "Still unavailable", v: "Reliable 10–20 year history, uninterrupted dividend records, R&D detail and qualitative moat/management evidence. Yahoo currently exposes about five annual periods for tested names." },
        ]}
      />

      <H2>NCAV remains separate</H2>
      <P>
        Benjamin Graham&apos;s <strong>Net Current Asset Value</strong> (&ldquo;net-net&rdquo;)
        screen is not offered as one of these six rankings. The normalized schema now has the core
        balance-sheet fields, but a strict net-net workflow needs broader statement coverage,
        security adjustments and a dedicated implementation. Graham Defensive instead uses real
        current ratio, price-to-book, leverage and interest coverage when those statements exist.
      </P>

      <H2>How scoring works</H2>
      <P>
        Each criterion receives a smooth 0–100 score around its target, so a barely adequate
        number is not treated the same as an exceptional one. The weighted raw score is moderated
        by evidence confidence, which reflects available criteria, report age and annual-history
        depth. Missing values reduce confidence rather than quietly passing. Financial companies,
        insurers and REITs are excluded until sector-correct ratios are available; tiny companies
        below the market-specific investability floor are excluded too.
      </P>
      <Formula>{`raw score = Σ(criterion score × weight) ÷ Σ(available weights)
match score = raw score × (0.70 + 0.30 × evidence confidence)`}</Formula>

      <H2>How to read it in the app</H2>
      <P>
        Choose one strategy at a time, then set minimum score and minimum evidence. Expand a
        candidate to see the source value, criterion score, pass/fail state and missing evidence.
        Report period, quote date, source and annual-history depth remain visible on every row.
      </P>

      <Callout tone="warn">
        A high match score means a stock satisfies the <em>adapted</em> version of that
        investor&apos;s test implemented here — not necessarily the investor&apos;s original,
        literal criteria. Read the strategy&apos;s own page (linked from every candidate) before
        treating a match as equivalent to what Lynch, Buffett, Graham, Fisher, Templeton or
        Greenblatt would themselves have bought.
      </Callout>

      <References
        items={[
          { text: "Graham, Benjamin & Dodd, David. Security Analysis. McGraw-Hill, 1934 — the Net Current Asset Value method this app does not implement." },
        ]}
      />
    </>
  ),
};

const lynchGarp: HelpArticle = {
  slug: "lynch-garp",
  category: "long-term",
  title: "Peter Lynch — Growth At a Reasonable Price",
  subtitle: "A PEG ratio under 1, modest debt, and real earnings growth — Lynch's simplest rule, applied literally.",
  trader: "Peter Lynch",
  readMins: 5,
  summary:
    "Lynch ran Fidelity Magellan at 29% annually from 1977–1990 hunting for 'fast growers' at a PEG below 1. Every criterion here maps directly onto available data — this is the one strategy needing no material adaptation.",
  Body: () => (
    <>
      <P>
        Peter Lynch ran the Fidelity Magellan Fund from 1977 to 1990, averaging a 29.2% annual
        return. His method: buy growing companies at a reasonable price, understand what they do,
        and hold until the story changes. Of the six strategies here, this one needs the least
        adaptation — every input Lynch&apos;s core test needs is in this dataset.
      </P>

      <H2>The PEG ratio</H2>
      <P>Lynch&apos;s signature metric divides the P/E by the earnings growth rate:</P>
      <Formula>{`PEG = current P/E ÷ capped 3-year profit CAGR`}</Formula>
      <P>
        A PEG of <strong>1.0</strong> means you are paying a fair price for the growth. Lynch
        hunted for PEGs <strong>below 1.0</strong>. The app uses three-year profit CAGR where
        available and falls back to capped YoY growth only when history is incomplete. Growth is
        capped at 50% inside PEG to prevent a one-off base effect from manufacturing a tiny ratio.
      </P>

      <H2>What the app checks</H2>
      <SpecTable
        rows={[
          { k: "PEG ratio", v: "≤ 1.0× — the core valuation anchor." },
          { k: "Debt-to-Equity", v: "≤ 0.5× — Lynch avoided heavily leveraged growers." },
          { k: "Profit CAGR", v: "3-year CAGR ≥ 15%; capped YoY is only a fallback." },
          { k: "P/E ratio", v: "≤ 25× — Lynch rarely paid a higher multiple for growth." },
          { k: "Revenue CAGR", v: "3-year CAGR ≥ 10% — top-line durability should confirm earnings growth." },
        ]}
      />

      <H2>What&apos;s missing from Lynch&apos;s full method</H2>
      <P>
        Lynch&apos;s &ldquo;buy what you know&rdquo; scuttlebutt — visiting stores, using products,
        reading reviews — and his six-category classification (slow growers, stalwarts, fast
        growers, cyclicals, turnarounds, asset plays) are both qualitative and cannot be
        screened. The quantitative test above finds candidates; that judgment remains the
        investor&apos;s own.
      </P>

      <Callout tone="info">
        This strategy needs no proxy substitutions — every criterion above is Lynch&apos;s own
        threshold, applied to the closest available figure (YoY growth standing in for his 5-year
        rate).
      </Callout>

      <References
        items={[
          { text: "Lynch, Peter. One Up On Wall Street. Simon & Schuster, 1989." },
          { text: "Lynch, Peter. Beating the Street. Simon & Schuster, 1993." },
        ]}
      />
    </>
  ),
};

const buffettMoat: HelpArticle = {
  slug: "buffett-moat",
  category: "long-term",
  title: "Warren Buffett — Economic Moat",
  subtitle: "High returns on capital, low debt, and real free cash flow — adapted from Buffett's own decade-long test.",
  trader: "Warren Buffett",
  readMins: 6,
  summary:
    "Buffett buys durable competitive advantage: businesses that sustain high returns without much capital or debt. This app substitutes a single year of data for his usual decade of evidence — clearly marked below.",
  Body: () => (
    <>
      <P>
        Warren Buffett&apos;s approach is not strictly value or growth — it is quality at a fair
        price. He buys businesses with a durable <strong>moat</strong> (brand power, network
        effects, cost advantages, or switching costs) and holds them, provided the advantage stays
        intact.
      </P>

      <H2>What the app checks</H2>
      <SpecTable
        rows={[
          { k: "ROE", v: "≥ 15% — Buffett wants a moat to show up as a superior return on equity." },
          { k: "Median ROCE", v: "5-year observed median ≥ 15% — reduces single-period distortion." },
          { k: "Debt-to-Equity", v: "≤ 0.5× — Buffett dislikes leverage; his best holdings often carry little debt." },
          { k: "Free-cash-flow yield", v: "≥ 3% of current market value — a stand-in for owner earnings." },
          { k: "Positive-profit history", v: "At least 80% of observed annual periods are profitable." },
        ]}
      />

      <H2>What had to be adapted</H2>
      <P>
        Buffett&apos;s own test looks for these figures sustained over <strong>5–10 years</strong>,
        plus gross margin (pricing-power evidence) and a current-ratio liquidity check. This
        dataset still lacks gross-margin and current-ratio history, so those are dropped rather
        than approximated. Annual profit and ROCE history now replace the earlier single-period
        proxy, but the observed window is generally three to five years rather than a decade.
      </P>

      <Callout tone="warn">
        A high score now requires multi-year profitability and capital efficiency, but cannot
        prove brand strength, pricing power or management quality. Cross-check filings and the
        competitive position before assuming the moat is durable.
      </Callout>

      <H2>The circle of competence</H2>
      <P>
        Buffett only invests in businesses he can understand, and asks whether the moat will still
        exist in ten years. Nothing in a fundamentals screen can answer that — it narrows the list;
        the judgment about durability is the investor&apos;s own.
      </P>

      <References
        items={[
          { text: "Buffett, Warren. Berkshire Hathaway Letters to Shareholders, 1965–present." },
          { text: "Graham, Benjamin. The Intelligent Investor (preface by Buffett). Harper, 1973." },
        ]}
      />
    </>
  ),
};

const grahamDefensive: HelpArticle = {
  slug: "graham-defensive",
  category: "long-term",
  title: "Benjamin Graham — Defensive Investor",
  subtitle: "A modernized defensive screen using real liquidity, book-value, leverage and coverage evidence.",
  trader: "Benjamin Graham",
  readMins: 6,
  summary:
    "Graham's Chapter 14 defensive-investor test wants adequate size, a strong balance sheet, decades of earnings and dividend history, and a moderate price. The app now checks the balance-sheet portion directly, while clearly shortening the historical tests.",
  Body: () => (
    <>
      <P>
        Benjamin Graham&apos;s <em>Intelligent Investor</em> Chapter 14 lists seven criteria for
        the &ldquo;defensive investor&rdquo; — someone who wants safety and simplicity, not
        excitement. The app now has normalized annual balance sheets and cash flows, but the free
        provider generally exposes about five annual periods rather than Graham&apos;s 10–20 year
        window. The balance-sheet tests are direct; the historical tests remain shortened.
      </P>

      <H2>Graham&apos;s original seven, and what happened to each</H2>
      <SpecTable
        rows={[
          { k: "1. Adequate size", v: "Kept — market cap ≥ ₹2,000 Cr / $200M, scaled to a modern small-cap floor." },
          { k: "2. Strong financial condition (current ratio ≥ 2×)", v: "Implemented from current assets and current liabilities; the continuous scoring target is 1.5×." },
          { k: "3. Earnings stability (no loss in 10 years)", v: "Approximated — all observed annual periods should be profitable; the stored window is shorter than 10 years." },
          { k: "4. Dividend record (20 uninterrupted years)", v: "Replaced — only the current dividend yield is available; “pays a dividend now” stands in for a two-decade record." },
          { k: "5. Earnings growth (33% over 10 years)", v: "Dropped — same reason as #3." },
          { k: "6. Moderate P/E (≤ 15× 3-yr avg earnings)", v: "Kept, using the current P/E instead of a 3-year average." },
          { k: "7. Moderate price-to-book (≤ 1.5×, or P/E × P/B ≤ 22.5)", v: "Price-to-book is implemented; the combined Graham number is not yet a separate criterion." },
        ]}
      />

      <H2>What the app actually checks</H2>
      <SpecTable
        rows={[
          { k: "Market cap", v: "≥ ₹2,000 Cr (India) or $200M (US)." },
          { k: "P/E ratio", v: "Target ≤ 15×, scored continuously." },
          { k: "Positive-profit history", v: "All observed annual periods profitable." },
          { k: "Debt-to-Equity", v: "≤ 0.5×." },
          { k: "Current ratio", v: "Target 1.5×, using matching-period current assets and liabilities." },
          { k: "Price-to-book", v: "Target ≤ 1.5×; suppressed when report and quote currencies differ." },
          { k: "Interest coverage", v: "Target ≥ 3× EBIT/interest expense." },
          { k: "Dividend yield", v: "> 0% (proxy for the 20-year record)." },
        ]}
      />

      <Callout tone="warn">
        Three of Graham&apos;s seven original criteria — earnings stability, the 10-year growth
        test, and price-to-book — are simply not checked, because the data does not exist. Treat a
        match here as &ldquo;passes a reduced, single-period version of Graham&apos;s size, price
        and leverage tests,&rdquo; not as satisfying his full defensive-investor bar.
      </Callout>

      <References
        items={[
          { text: "Graham, Benjamin. The Intelligent Investor, Chapter 14. Harper, 1973." },
        ]}
      />
    </>
  ),
};

const fisherGrowth: HelpArticle = {
  slug: "fisher-growth",
  category: "long-term",
  title: "Philip Fisher — Growth & Scuttlebutt",
  subtitle: "Sustained growth financed without leverage — the quantifiable slice of Fisher's fifteen points.",
  trader: "Philip Fisher",
  readMins: 5,
  summary:
    "Fisher's 1958 classic holds mostly qualitative criteria (management quality, labour relations) that cannot be screened at all. The few points with numerical signatures — growth, margins, leverage — are adapted here to one year of data.",
  Body: () => (
    <>
      <P>
        Philip Fisher&apos;s <em>Common Stocks and Uncommon Profits</em> (1958) introduced buying
        great growth companies and holding for years, even decades. Most of his fifteen points —
        management integrity, labour relations, R&D culture — are judgment calls that no
        fundamentals screen can make. Only a handful have a clean numerical signature.
      </P>

      <H2>What the app checks</H2>
      <SpecTable
        rows={[
          { k: "Revenue CAGR", v: "3-year CAGR ≥ 15% — sustained top-line expansion." },
          { k: "Profit CAGR", v: "3-year CAGR ≥ 15% — sustained earnings expansion." },
          { k: "Debt-to-Equity", v: "≤ 0.4× — Fisher preferred growth financed internally, not through leverage." },
          { k: "ROE", v: "≥ 15% — high returns without excessive leverage." },
          { k: "Median ROCE", v: "Observed 5-year median ≥ 15% — capital-allocation efficiency." },
        ]}
      />

      <H2>What&apos;s dropped entirely</H2>
      <P>
        Net margin expansion (Fisher wanted margins stable or improving over 5 years) and R&D
        spend as a share of revenue — a proxy for his &ldquo;determined product-development
        commitment&rdquo; point — are both absent from this schema and are not checked at all,
        rather than faked from unrelated figures.
      </P>

      <H2>Scuttlebutt</H2>
      <P>
        Fisher&apos;s most famous idea is gathering information from customers, competitors,
        suppliers and former employees to verify the growth is real and sustainable. No screen can
        do this; it finds candidates, scuttlebutt separates the genuinely great from the merely
        good.
      </P>

      <Callout tone="warn">
        This is the most heavily reduced of the six strategies — four surviving criteria out of
        Fisher&apos;s original fifteen points, two of them (revenue growth, and implicitly the
        margin/R&D points that are dropped) meaningfully weaker than his own multi-year tests.
      </Callout>

      <References
        items={[
          { text: "Fisher, Philip. Common Stocks and Uncommon Profits. Harper, 1958." },
        ]}
      />
    </>
  ),
};

const templetonContrarian: HelpArticle = {
  slug: "templeton-contrarian",
  category: "long-term",
  title: "John Templeton — Global Contrarian",
  subtitle: "Cheap, paying a dividend, and well off its 52-week high — one of the two strategies needing almost no adaptation.",
  trader: "John Templeton",
  readMins: 5,
  summary:
    "Templeton bought at the point of maximum pessimism using low P/E, low price-to-book, and high dividend yield. This app swaps price-to-book (unavailable) for the exact 52-week-high distance this dataset already has — arguably a better direct read of pessimism than the original.",
  Body: () => (
    <>
      <P>
        Sir John Templeton pioneered global investing by buying when pessimism was highest. In
        1939 he borrowed money to buy 100 shares of every NYSE stock trading below $1 — 34 were
        bankrupt. Four years later he sold for a 400% gain. His toolkit was classic value, applied
        with a global, forward-looking lens.
      </P>

      <H2>What the app checks</H2>
      <SpecTable
        rows={[
          { k: "P/E ratio", v: "≤ 12× — low expectations already baked into the price." },
          { k: "Dividend yield", v: "≥ 3% — income while waiting for the market to change its mind." },
          { k: "Debt-to-Equity", v: "≤ 0.5× — survivability matters when buying into a downturn." },
          { k: "% from 52-week high", v: "≤ -30% — at least 30% below the high, a direct read of pessimism." },
          { k: "Positive-profit history", v: "At least 80% of observed annual periods profitable, avoiding structural loss-makers." },
        ]}
      />

      <H2>The one substitution — and why it&apos;s arguably an improvement</H2>
      <P>
        Templeton&apos;s original test used price-to-book (≤ 1.2×) as an asset floor under the
        price. This schema has no price-to-book anywhere, so the screen uses{" "}
        <code>pct_from_52w_high</code> instead — the stock&apos;s exact distance below its own
        52-week high. This is a direct, literal measurement of the pessimism Templeton was
        actually trying to detect, rather than book value acting as an indirect proxy for it — one
        of the few places in this feature where the substitute is arguably closer to the
        investor&apos;s real intent than a missing original field would have been.
      </P>

      <H2>The forward look</H2>
      <P>
        Templeton did not just buy cheap stocks — he bought stocks cheap relative to their
        earnings five years out. The screen only has trailing data; the investor must supply the
        forward judgment: will earnings be higher in five years? If yes, the pessimism the screen
        detected is likely overdone.
      </P>

      <References
        items={[
          { text: "Templeton, John. The Templeton Touch. Doubleday, 1983." },
          { text: "Templeton, Lauren. Investing the Templeton Way. McGraw-Hill, 2007." },
        ]}
      />
    </>
  ),
};

const greenblattMagic: HelpArticle = {
  slug: "greenblatt-magic",
  category: "long-term",
  title: "Joel Greenblatt — Magic Formula (approximated)",
  subtitle: "Rank by quality and cheapness together — using ROCE and a P/E-based proxy in place of EBIT and enterprise value.",
  trader: "Joel Greenblatt",
  readMins: 6,
  summary:
    "Greenblatt's formula ranks stocks by Return on Capital (EBIT ÷ operating assets) and Earnings Yield (EBIT ÷ Enterprise Value). Neither EBIT nor enterprise value exists in this dataset, so both are approximated — the most heavily adapted strategy of the six, and labelled as such everywhere it appears.",
  Body: () => (
    <>
      <P>
        Joel Greenblatt&apos;s <em>The Little Book That Beats the Market</em> (2006) distilled
        value investing into two numbers: <strong>Return on Capital</strong> (how good is the
        business?) and <strong>Earnings Yield</strong> (how cheap is it?). Rank by both, buy the
        intersection, hold a year, rebalance.
      </P>

      <H2>Greenblatt&apos;s actual formula</H2>
      <Formula>{`Return on Capital (ROC) = EBIT ÷ (Net Working Capital + Net Fixed Assets)
Earnings Yield         = EBIT ÷ Enterprise Value`}</Formula>
      <P>
        Neither <strong>EBIT</strong> (earnings before interest and tax) nor{" "}
        <strong>Enterprise Value</strong> (market cap plus debt, minus cash) exists anywhere in
        this schema — there is no working-capital/fixed-asset breakdown and no debt/cash figure to
        build an enterprise value from.
      </P>

      <H2>What the app approximates instead</H2>
      <SpecTable
        rows={[
          { k: "ROCE, in place of Return on Capital", v: "ROCE is a related but different ratio to Greenblatt's own EBIT ÷ (NWC + Fixed Assets) — it uses total capital employed, not just operating assets, and isn't restricted to EBIT." },
          { k: "100 ÷ P/E, in place of Earnings Yield", v: "This ignores debt and cash entirely, which the real EBIT ÷ Enterprise Value formula exists specifically to account for. A P/E-based proxy, not his formula." },
        ]}
      />
      <Formula>{`earnings yield proxy (%) = 100 / P-E ratio`}</Formula>

      <H2>What the app checks</H2>
      <SpecTable
        rows={[
          { k: "Median ROCE (Return-on-Capital proxy)", v: "Observed 5-year median ≥ 25%" },
          { k: "Earnings yield (100/P-E proxy)", v: "≥ 10%" },
          { k: "Market cap", v: "≥ ₹500 Cr (India) or $50M (US) — Greenblatt's own liquidity floor, excluding tiny illiquid names." },
          { k: "Positive-profit history", v: "At least 80% of observed annual periods profitable." },
        ]}
      />

      <Callout tone="warn">
        This is the most heavily adapted of the six strategies. A high score means a stock has high
        ROCE and a low P/E — a reasonable quality-and-cheapness signal on its own terms, but it is{" "}
        <strong>not</strong> Greenblatt&apos;s literal EBIT/Enterprise-Value ranking, and stocks
        with meaningful debt or large cash balances are exactly where the two measures diverge
        most.
      </Callout>

      <H2>Mechanical discipline</H2>
      <P>
        Greenblatt&apos;s formula is deliberately mechanical because judgment often erodes the
        edge: rank, buy the top names, rebalance annually, and otherwise leave it alone. That
        discipline still applies here — but it is being applied to an approximation of his ranking,
        not the ranking itself.
      </P>

      <References
        items={[
          { text: "Greenblatt, Joel. The Little Book That Beats the Market. Wiley, 2006." },
        ]}
      />
    </>
  ),
};

// ---------------------------------------------------------------------------

export const HELP_ARTICLES: HelpArticle[] = [
  swingEngine,
  qullamaggie,
  minervini,
  darvas,
  ptj,
  simons,
  probability,
  longTermEngine,
  lynchGarp,
  buffettMoat,
  grahamDefensive,
  fisherGrowth,
  templetonContrarian,
  greenblattMagic,
];

export const HELP_BY_SLUG: Record<string, HelpArticle> = Object.fromEntries(
  HELP_ARTICLES.map((a) => [a.slug, a]),
);

export const SWING_ARTICLES = HELP_ARTICLES.filter((a) => a.category === "swing");
export const ENGINE_ARTICLES = HELP_ARTICLES.filter((a) => a.category === "engine");
export const LONG_TERM_ARTICLES = HELP_ARTICLES.filter((a) => a.category === "long-term");
export const PROBABILITY_ARTICLES = HELP_ARTICLES.filter((a) => a.category === "probability");
