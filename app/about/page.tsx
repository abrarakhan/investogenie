import Link from "next/link";

const RELEASES = [
  {
    version: "2026.11.05",
    date: "5 November 2026",
    title: "Signal coverage, freshness safety, and interactive charts",
    summary: "A production hardening release focused on finding more legitimate moves without relaxing execution controls, preventing stale or partial data from masquerading as current, and making every candidate easier to inspect.",
    changes: [
      ["Portfolio visibility", "Open Trade Ledger positions now appear on the Terminal alongside recorded holdings."],
      ["Earlier continuation discovery", "Trend Continuation now surfaces developing staircases while rejecting weak day-two follow-through, structural extension, and late chase conditions."],
      ["Stable live classifications", "Strong Swing readiness transitions are recorded and live quote handling is less prone to status oscillation on refresh."],
      ["Full-universe coverage", "Strong Swing assesses every current Swing setup; equal scores use breakout clearance, volume expansion, and relative strength instead of alphabetical order."],
      ["Cash-market participation", "NSE cash stocks use price-confirmed volume participation where open interest does not exist; OI remains authoritative where available."],
      ["Reliable regime benchmark", "Market regime chooses a current NIFTY or NIFTYBEES series with at least 200 bars."],
      ["Safer extended setups", "Extended confirmed breakouts remain visible as non-buyable Pullback Candidates, while parabolic runs stay Risk Off."],
      ["Clearer evidence labels", "Base Swing describes breakout and participation evidence without presenting discovery as a confirmed buy."],
      ["Session-correct freshness", "Old ATR, trigger, and verdict rows cannot be repriced using a newer quote; stale rows are excluded from current strategy screens."],
      ["Protected scan retirement", "Zero or partial scans cannot wipe a market. Retirement requires at least 80% recomputation coverage and is decided independently for India and the US."],
      ["Live dashboard quotes", "During open sessions, dashboard setups require a quote updated within seven minutes."],
      ["Charts on every swing card", "Double-click on desktop or long-press on mobile opens a chart across Swing, Strong Swing, both Momentum Ignition engines, Trend Continuation, and Armed Strong Swing."],
      ["Local OHLCV charting", "Restricted TradingView embeds were replaced by InvestoGenie candles, with an optional link to open the full TradingView site."],
      ["Advanced chart workspace", "Charts now include 1D/5D/1W/1M intervals, 1M/3M/6M/1Y/All ranges, candle and line modes, volume, SMA 20/50, crosshair readouts, zoom, pan, and fit-to-screen."],
    ],
    note: "No auto-buy authority was added. Only confirmed day-two Trend Continuation breakouts can use a protected manual plan; day-one impulses and pullbacks remain non-buyable.",
  },
] as const;

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-[#05070d] text-white">
      <header className="border-b border-white/10 bg-black/20 px-6 py-5">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link href="/" className="text-xl font-black tracking-tight">
            Investo<span className="text-cyan-300">Genie</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm text-white/60">
            <Link href="#version-history" className="hover:text-white">Version history</Link>
            <Link href="/help" className="hover:text-white">Help</Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-16">
        <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">About</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-black tracking-tight sm:text-5xl">InvestoGenie by Abrar Ahmed Khan</h1>
        <p className="mt-5 max-w-3xl text-lg leading-relaxed text-white/58">
          InvestoGenie is a multi-market investing terminal for the US and Indian markets, built to combine market overview, screening, swing candidate discovery, portfolio context, probability research, and local data sync into one disciplined workspace.
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <article className="rounded-xl border border-white/10 bg-white/[0.035] p-5">
            <h2 className="font-bold">Purpose</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/55">Help investors move from raw market data to structured decisions with cleaner context and fewer scattered tools.</p>
          </article>
          <article className="rounded-xl border border-white/10 bg-white/[0.035] p-5">
            <h2 className="font-bold">Markets</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/55">Designed around separate US and India workspaces so data, currency, screeners, and portfolio workflows stay clear.</p>
          </article>
          <article className="rounded-xl border border-white/10 bg-white/[0.035] p-5">
            <h2 className="font-bold">Founder</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/55">Created by Abrar Ahmed Khan as a commercial-grade research terminal with local-first data foundations.</p>
          </article>
        </div>

        <Link href="/terminal/in" className="mt-10 inline-block rounded-full bg-gradient-to-r from-cyan-300 to-emerald-300 px-6 py-3 font-semibold text-black hover:scale-[1.02]">
          Open Terminal
        </Link>

        <section id="version-history" className="mt-20 border-t border-white/10 pt-12">
          <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">Product updates</p>
          <h2 className="mt-3 text-3xl font-black tracking-tight">Version history</h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-white/50">
            A production record of material user-facing, strategy-safety, and data-contract changes. Calculation changes are distinguished from presentation and freshness changes.
          </p>

          <div className="mt-8 space-y-5">
            {RELEASES.map((release) => (
              <article key={release.version} className="rounded-2xl border border-white/10 bg-white/[0.025] p-5 sm:p-7">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-xs font-bold text-cyan-300">v{release.version}</div>
                    <h3 className="mt-1 text-xl font-black">{release.title}</h3>
                  </div>
                  <time className="text-xs text-white/40">{release.date}</time>
                </div>
                <p className="mt-4 max-w-4xl text-sm leading-relaxed text-white/58">{release.summary}</p>
                <div className="mt-6 grid gap-3 md:grid-cols-2">
                  {release.changes.map(([label, detail]) => (
                    <div key={label} className="rounded-lg border border-white/8 bg-black/20 p-4">
                      <h4 className="text-sm font-bold text-white/80">{label}</h4>
                      <p className="mt-1.5 text-xs leading-relaxed text-white/48">{detail}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-6 rounded-lg border border-amber-300/15 bg-amber-300/[0.04] px-4 py-3 text-xs leading-relaxed text-amber-100/65">
                  <strong className="text-amber-200">Safety boundary:</strong> {release.note}
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
