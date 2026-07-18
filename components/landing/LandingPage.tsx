"use client";

import dynamic from "next/dynamic";
import KineticHeadline from "./KineticHeadline";
import MarketPivotSwitch from "./MarketPivotSwitch";
import ScrollFeatures from "./ScrollFeatures";
import TickerTape, { MacroBenchmarks } from "./TickerTape";
import { useMarket } from "@/context/MarketProvider";
import type { LiveMarketQuotes } from "@/lib/types";

// WebGL is client-only; skip prerender. `ssr: false` is valid here because this
// is a Client Component (Next 16 requirement).
const HeroCanvas = dynamic(() => import("./HeroCanvas"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-[#05070d]" />,
});

export default function LandingPage({ quotes }: { quotes: LiveMarketQuotes }) {
  const { market } = useMarket();

  return (
    <main className="relative min-h-screen w-full overflow-x-clip bg-[#05070d] text-white">
      {/* ---------- HERO ---------- */}
      <section className="relative flex min-h-screen flex-col">
        {/* Absolute WebGL layer; collapses cleanly under content on mobile. */}
        <div className="absolute inset-0 z-0">
          <HeroCanvas />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#05070d]" />
        </div>

        {/* Top bar */}
        <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6">
          <span className="text-lg font-black tracking-tight">
            Investo<span className="text-[var(--ig-accent)]">Genie</span>
          </span>
          <nav className="hidden gap-8 text-sm text-white/60 md:flex">
            <a href="#engines" className="hover:text-white">Engines</a>
            <a href={`/markets/${market.id.toLowerCase()}`} className="hover:text-white">Market Overview</a>
            <a href="/screener" className="hover:text-white">Screener</a>
            <a href={`/terminal/${market.id.toLowerCase()}/screener`} className="hover:text-white">Swing Candidates</a>
            <a href={`/terminal/${market.id.toLowerCase()}`} className="hover:text-white">Terminal</a>
          </nav>
        </header>

        {/* Hero content */}
        <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col items-center justify-center gap-8 px-6 text-center">
          <span className="rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs uppercase tracking-[0.3em] text-white/70 backdrop-blur">
            Multi-Asset Financial Terminal
          </span>

          <KineticHeadline
            text="Trade the world's markets"
            className="max-w-4xl text-5xl font-black leading-[1.05] sm:text-7xl"
          />
          <KineticHeadline
            text="with sovereign precision."
            delay={0.35}
            className="max-w-4xl bg-gradient-to-r from-[var(--ig-primary)] to-[var(--ig-accent)] bg-clip-text text-5xl font-black leading-[1.05] text-transparent sm:text-7xl"
          />

          <p className="max-w-2xl text-base text-white/60 sm:text-lg">
            Stocks · Bonds · Mutual Funds · Currencies · Derivatives — unified
            across the US and Indian markets with derivative-aware analytics and
            cinematic, real-time visualization.
          </p>

          <MarketPivotSwitch />
          <p className="text-xs text-white/40">
            Now viewing <span className="font-semibold text-white/70">{market.label}</span>{" "}
            — all feeds re-render live.
          </p>
        </div>

        {/* Ticker pinned to the hero base */}
        <div className="relative z-10 w-full">
          <TickerTape quotes={quotes} />
        </div>
      </section>

      {/* ---------- BENCHMARKS ---------- */}
      <section id="markets" className="mx-auto w-full max-w-6xl px-6 py-20">
        <div className="mb-8 flex items-end justify-between">
          <h2 className="text-2xl font-bold sm:text-3xl">Macro benchmarks</h2>
          <span className="text-sm text-white/50">{market.label}</span>
        </div>
        <MacroBenchmarks quotes={quotes} />
      </section>

      {/* ---------- ENGINES ---------- */}
      <div id="engines">
        <ScrollFeatures />
      </div>

      {/* ---------- CTA ---------- */}
      <section
        id="terminal"
        className="mx-auto w-full max-w-5xl px-6 py-32 text-center"
      >
        <h2 className="text-4xl font-black sm:text-6xl">
          Your terminal is{" "}
          <span className="bg-gradient-to-r from-[var(--ig-primary)] to-[var(--ig-accent)] bg-clip-text text-transparent">
            ready to wire up.
          </span>
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-white/60">
          Authentication, portfolios, and live ingestion plug directly into the
          local Postgres backend provisioned for this build.
        </p>
        <a
          href={`/markets/${market.id.toLowerCase()}`}
          className="mt-10 inline-block rounded-full bg-gradient-to-r from-[var(--ig-primary)] to-[var(--ig-accent)] px-8 py-3 font-semibold text-black transition-transform hover:scale-105"
        >
          Open {market.label} Overview
        </a>
      </section>

      <footer className="border-t border-white/10 px-6 py-10 text-center text-xs text-white/40">
        InvestoGenie — engineered for US & India · Structurally ready for React Native (iOS / Android).
      </footer>
    </main>
  );
}
