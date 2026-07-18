import Link from "next/link";

const sections = [
  {
    title: "Start With A Market",
    body: "Choose US or India from the terminal switcher. Each market keeps its own overview, screener, swing candidates, probability workspace, watchlist, and portfolio context.",
  },
  {
    title: "Overview",
    body: "Use Overview for indices, breadth, gainers, decliners, fundamentals leaders, chart comparisons, and data freshness. It is the fastest way to understand the market before screening.",
  },
  {
    title: "Terminal",
    body: "Use Terminal for holdings, watchlist, benchmark cards, trade recording, market screener preview, and the engine summary blocks in one place.",
  },
  {
    title: "Stock Screener",
    body: "Use Stock Screener to filter the wider equity universe by price action, valuation, profitability, growth, and saved custom screens.",
  },
  {
    title: "Swing Candidates",
    body: "Use Swing Candidates for the curated buy-side shortlist. This is where strategy-ranked candidates belong, separate from the broader stock screener.",
  },
  {
    title: "Probability",
    body: "Use Probability for 21 trading-day scenario distributions, expected ranges, drawdown risk, and factor contributors. It is research context, not a buy/sell instruction.",
  },
  {
    title: "Import Holdings",
    body: "For India portfolios, upload CAS statements and AMC monthly disclosures to power local holdings and Fund Overlap X-Ray analysis.",
  },
  {
    title: "Data Health",
    body: "Use Data Health to inspect quote coverage, OHLCV coverage, fundamentals freshness, provider state, and sync job history.",
  },
];

export default function HelpPage() {
  return (
    <main className="min-h-screen bg-[#05070d] text-white">
      <header className="border-b border-white/10 bg-black/20 px-6 py-5">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link href="/" className="text-xl font-black tracking-tight">
            Investo<span className="text-cyan-300">Genie</span>
          </Link>
          <Link href="/terminal/in" className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white">
            Open Terminal
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-14">
        <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">Help</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-black tracking-tight sm:text-5xl">How to navigate InvestoGenie</h1>
        <p className="mt-4 max-w-3xl text-white/55">
          InvestoGenie is organized as a market terminal. The landing page introduces the product; the terminal is where analysis, screening, probability, portfolio imports, and data operations live.
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {sections.map((section) => (
            <article key={section.title} className="rounded-xl border border-white/10 bg-white/[0.035] p-5">
              <h2 className="text-lg font-bold">{section.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-white/55">{section.body}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
