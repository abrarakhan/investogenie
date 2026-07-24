import Link from "next/link";
import type { Metadata } from "next";
import {
  HELP_ARTICLES, SWING_ARTICLES, ENGINE_ARTICLES, PROBABILITY_ARTICLES,
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
    href: "/terminal/in/screener",
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
    title: "Weigh the odds — Probability",
    href: "/terminal/in/probability",
    body: "A 21-trading-day forecast per stock: expected return, probability of an up move, drawdown risk and a projected price range. Research context, not a buy/sell call.",
  },
  {
    step: "6",
    title: "Bring in your holdings — Import",
    href: "/terminal/in/cas",
    body: "For India, upload CAS statements and AMC disclosures to power local holdings and the Fund Overlap X-Ray.",
  },
  {
    step: "7",
    title: "Trust the data — Data Health",
    href: "/data/health",
    body: "Inspect quote and OHLCV coverage, fundamentals freshness, provider state and sync-job history so you know how current the numbers are.",
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
              <Link
                href={j.href}
                className="group flex gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-cyan-300/40 hover:bg-white/[0.06]"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-300/15 text-sm font-bold text-cyan-300">
                  {j.step}
                </span>
                <div>
                  <div className="font-semibold text-white group-hover:text-cyan-100">{j.title}</div>
                  <div className="mt-1 text-sm leading-relaxed text-white/55">{j.body}</div>
                </div>
              </Link>
            </li>
          ))}
        </ol>

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

        <H2>The Probability model</H2>
        <P>How the 21-day return distributions, up-probabilities and price ranges are computed.</P>
        <div className="mt-6 grid gap-4">
          {PROBABILITY_ARTICLES.map((a) => <ArticleCard key={a.slug} a={a} />)}
        </div>

        <p className="mt-12 text-sm text-white/35">
          {HELP_ARTICLES.length} reference articles. All calculations described match the code that
          generates the signals.
        </p>
      </Article>
    </HelpShell>
  );
}
