import type { ReactNode } from "react";
import {
  H2, H3, P, UL, LI, Formula, Callout, SpecTable, References,
} from "@/components/help/HelpLayout";

export type HelpCategory = "swing" | "probability" | "engine";

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

export const HELP_ARTICLES: HelpArticle[] = [
  swingEngine,
  qullamaggie,
  minervini,
  darvas,
  ptj,
  simons,
  probability,
];

export const HELP_BY_SLUG: Record<string, HelpArticle> = Object.fromEntries(
  HELP_ARTICLES.map((a) => [a.slug, a]),
);

export const SWING_ARTICLES = HELP_ARTICLES.filter((a) => a.category === "swing");
export const ENGINE_ARTICLES = HELP_ARTICLES.filter((a) => a.category === "engine");
export const PROBABILITY_ARTICLES = HELP_ARTICLES.filter((a) => a.category === "probability");
