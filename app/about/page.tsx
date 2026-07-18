import Link from "next/link";

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-[#05070d] text-white">
      <header className="border-b border-white/10 bg-black/20 px-6 py-5">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link href="/" className="text-xl font-black tracking-tight">
            Investo<span className="text-cyan-300">Genie</span>
          </Link>
          <Link href="/help" className="text-sm text-white/60 hover:text-white">Help</Link>
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
      </section>
    </main>
  );
}
