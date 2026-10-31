import Link from "next/link";
import type { Metadata } from "next";
import {
  HELP_ARTICLES, SWING_ARTICLES, ENGINE_ARTICLES, EXECUTION_ARTICLES, PROBABILITY_ARTICLES, LONG_TERM_ARTICLES,
  DATA_ARTICLES,
  type HelpArticle,
} from "@/lib/help/articles";
import { HelpShell, Article, Eyebrow, Title, Lede, H2, P } from "@/components/help/HelpLayout";

export const metadata: Metadata = {
  title: "Help & Guides — InvestoGenie",
  description:
    "How to navigate InvestoGenie, plus deep-dive references for every swing strategy and the probability model.",
};

/** A guided walkthrough of the whole app, in the order a new user should move. */
const JOURNEY: { step: string; title: string; href: string; body: string }[] = [
  {
    step: "1",
    title: "Pick a market",
    href: "/terminal/in",
    body: "Choose India or US from the terminal switcher. Each market keeps its own overview, screener, swing candidates, probability workspace, watchlist and portfolio.",
  },
  {
    step: "2",
    title: "Get the lay of the land — Overview",
    href: "/markets/in",
    body: "Indices, breadth, gainers/decliners, fundamentals leaders, chart comparisons and data freshness. The fastest way to read the market before you screen.",
  },
  {
    step: "3",
    title: "Narrow the universe — Stock Screener",
    href: "/terminal/in/stocks",
    body: "Filter thousands of stocks by price action, valuation, profitability and growth. Type a plain-English query (\"profitable smallcaps under 30 P/E\") and it builds the filters for you.",
  },
  {
    step: "4",
    title: "Find setups — Swing Candidates",
    href: "/terminal/in/screener",
    body: "The curated buy-side shortlist: strategy-ranked candidates with entry, target, stop and trailing-stop levels, filterable by five legendary systems.",
  },
  {
    step: "5",
    title: "Find buyable setups — Strong Swing and Armed Swing",
    href: "/terminal/in/strong-swing",
    body: "The execution engines: Strong Swing, Momentum Ignition (legacy and V2) and Trend Continuation on one page, and Armed Swing for pre-breakout buy-stops. Only Execution ready, Momentum ready and Buy zone unlock Buy & Track.",
  },
  {
    step: "6",
    title: "Track what you bought — Trade Ledger",
    href: "/terminal/in/trade-ledger",
    body: "Log purchases against a frozen plan, follow exit alerts, and see P&L, ROI on capital added and XIRR.",
  },
  {
    step: "7",
    title: "Think longer horizon — Long-Term Candidates",
    href: "/terminal/in/long-term",
    body: "Six well-known investors' published fundamentals criteria (Lynch, Buffett, Graham, Fisher, Templeton, Greenblatt), scored against every stock and ranked — adapted honestly where the data doesn't fully match their original tests.",
  },
  {
    step: "8",
    title: "Weigh the odds — Probability",
    href: "/terminal/in/probability",
    body: "A 21-trading-day forecast per stock: expected return, probability of an up move, drawdown risk and a projected price range. Research context, not a buy/sell call.",
  },
  {
    step: "9",
    title: "Bring in your holdings — Import",
    href: "/terminal/in/cas",
    body: "For India, upload CAS statements and AMC disclosures, or connect Gmail read-only in Fund Mapping. Gmail can automatically import NSDL e-CAS PDFs and validated AMC monthly disclosures; encrypted CAS files require the saved PDF password.",
  },
  {
    step: "10",
    title: "Trust the data — Data Health",
    href: "/data/health",
    body: "Inspect quote and OHLCV coverage, fundamentals freshness, provider state and sync-job history so you know how current the numbers are.",
  },
];

/** The tradable-stocks routine in one place: which screen and status to act on, in order. */
const TRADABLE_STEPS: { when: string; title: string; href: string; body: string }[] = [
  {
    when: "Before 09:15",
    title: "Prepare orders — Armed Swing and Trend Continuation",
    href: "/terminal/in/strong-swing",
    body: "Armed Swing · Armed: place the buy-stop limit order before the open. Trend Continuation · Impulse detected: note the names to re-check on day two.",
  },
  {
    when: "From 09:15",
    title: "Buy only what is ready — the Tier 1 statuses",
    href: "/terminal/in/strong-swing",
    body: "Strong Swing · Execution ready, Momentum Ignition · Momentum ready, Momentum Ignition V2 · Momentum ready, Armed Swing · Buy zone. These alone pass every gate, freeze a plan and unlock Buy & Track. They need market hours and a fresh live quote.",
  },
  {
    when: "Watch",
    title: "Next in line — Tier 2",
    href: "/terminal/in/strong-swing",
    body: "Strong Swing · Wait for entry (confirmed but extended), Momentum Ignition V2 · Pre-ignition, First thrust or Retest setup, Armed Swing · Armed. Wait for them to turn ready; don't buy early.",
  },
  {
    when: "From 10:15",
    title: "Day-two confirmations — Trend Continuation",
    href: "/terminal/in/strong-swing",
    body: "Impulse-detected names re-scanned an hour after the open may turn Continuation ready. It is observation only and never unlocks Buy & Track.",
  },
  {
    when: "After buying",
    title: "Log it and follow the exits — Trade Ledger",
    href: "/terminal/in/trade-ledger",
    body: "Log the purchase from the ready card (web or app) so the frozen plan is attached, then act on the ledger's stop, target and trailing-stop alerts.",
  },
  {
    when: "Research",
    title: "Context, not buy signals — Tier 3",
    href: "/terminal/in/screener",
    body: "Swing Candidates and its five strategies, News & AI (re-ranks existing setups, never creates one), Stock Screener, Long-Term and Probability.",
  },
];

function ArticleCard({ a }: { a: HelpArticle }) {
  return (
    <Link
      href={`/help/${a.slug}`}
      className="group block rounded-xl border border-white/10 bg-white/[0.035] p-5 transition hover:border-cyan-300/40 hover:bg-white/[0.06]"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-bold leading-snug text-white group-hover:text-cyan-100">{a.title}</h3>
        <span className="shrink-0 text-xs text-white/35">{a.readMins} min</span>
      </div>
      {a.trader && <p className="mt-1 text-xs font-medium uppercase tracking-wide text-cyan-300/80">{a.trader}</p>}
      <p className="mt-2 text-sm leading-relaxed text-white/55">{a.summary}</p>
      <span className="mt-3 inline-block text-sm text-cyan-300 opacity-0 transition group-hover:opacity-100">Read →</span>
    </Link>
  );
}

export default function HelpPage() {
  return (
    <HelpShell>
      <Article>
        <Eyebrow>Help &amp; Guides</Eyebrow>
        <Title>How to use InvestoGenie</Title>
        <Lede>
          InvestoGenie is a market terminal. This page walks you through the app in the order it is
          meant to be used, then links to deep-dive references for every strategy and the
          probability model — so you always know exactly what each number means and where it came
          from.
        </Lede>

        <H2>Your first pass, step by step</H2>
        <P>Follow this route the first time through; each step links straight into the app.</P>
        <ol className="mt-6 space-y-3">
          {JOURNEY.map((j) => (
            <li key={j.step}>
              <a
                href={j.href}
                className="group flex min-h-11 touch-manipulation gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-cyan-300/40 hover:bg-white/[0.06]"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-300/15 text-sm font-bold text-cyan-300">
                  {j.step}
                </span>
                <div>
                  <div className="font-semibold text-white group-hover:text-cyan-100">{j.title}</div>
                  <div className="mt-1 text-sm leading-relaxed text-white/55">{j.body}</div>
                </div>
              </a>
            </li>
          ))}
        </ol>

        <H2>Which screens give tradable stocks</H2>
        <P>
          Only the execution engines decide whether a setup is buyable right now and freeze a plan
          you can log. Follow this routine each trading day, then read the engine you trade.
        </P>
        <ol className="mt-6 space-y-3">
          {TRADABLE_STEPS.map((t) => (
            <li key={t.title}>
              <a
                href={t.href}
                className="group flex min-h-11 touch-manipulation flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-cyan-300/40 hover:bg-white/[0.06] sm:flex-row sm:gap-4"
              >
                <span className="w-28 shrink-0 text-xs font-bold uppercase tracking-wide text-cyan-300">{t.when}</span>
                <div>
                  <div className="font-semibold text-white group-hover:text-cyan-100">{t.title}</div>
                  <div className="mt-1 text-sm leading-relaxed text-white/55">{t.body}</div>
                </div>
              </a>
            </li>
          ))}
        </ol>
        <P>
          Ready means the setup passed the app&apos;s rules at that moment, not that it will work.
        </P>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {EXECUTION_ARTICLES.map((a) => <ArticleCard key={a.slug} a={a} />)}
        </div>

        <H2>How Swing Candidates work</H2>
        <P>
          Start here to understand the engine behind the shortlist — the classifier, the trade
          levels, and how the five strategies layer on top.
        </P>
        <div className="mt-6 grid gap-4">
          {ENGINE_ARTICLES.map((a) => <ArticleCard key={a.slug} a={a} />)}
        </div>

        <H2>The five swing strategies</H2>
        <P>
          Each legendary system is scored on every stock and shown as a tag. These references
          explain where each one comes from and the exact calculation the app performs.
        </P>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {SWING_ARTICLES.map((a) => <ArticleCard key={a.slug} a={a} />)}
        </div>

        <H2>Long-Term Candidates</H2>
        <P>
          Six long-horizon investors&apos; published fundamentals criteria, scored against every
          stock. Start with the engine overview — it explains what had to be adapted and which
          screen was left out entirely, and why.
        </P>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {LONG_TERM_ARTICLES.map((a) => <ArticleCard key={a.slug} a={a} />)}
        </div>

        <H2>The Probability model</H2>
        <P>How the 21-day return distributions, up-probabilities and price ranges are computed.</P>
        <div className="mt-6 grid gap-4">
          {PROBABILITY_ARTICLES.map((a) => <ArticleCard key={a.slug} a={a} />)}
        </div>

        <H2>Data &amp; integrations</H2>
        <P>Setup guides for optional data connections and portfolio enrichment workflows.</P>
        <div className="mt-6 grid gap-4">
          {DATA_ARTICLES.map((a) => <ArticleCard key={a.slug} a={a} />)}
        </div>

        <p className="mt-12 text-sm text-white/35">
          {HELP_ARTICLES.length} reference articles. All calculations described match the code that
          generates the signals.
        </p>
      </Article>
    </HelpShell>
  );
}
