"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

interface Feature {
  kicker: string;
  title: string;
  body: string;
  metric: string;
  metricLabel: string;
}

const FEATURES: Feature[] = [
  {
    kicker: "Derivatives Engine",
    title: "OI-Validated Swing Setups",
    body: "Breakouts and Bollinger compressions are only flagged when a concurrent Long Build-up in Open Interest confirms fresh longs — filtering out hollow short-covering pops.",
    metric: "5/20",
    metricLabel: "short / base window (days)",
  },
  {
    kicker: "Fund Intelligence",
    title: "Congruence & Overlap X-Ray",
    body: "Look-through every mutual fund to its underlying stocks, surface duplicate concentration above 30%, and auto-generate DIRECT-plan optimization switches.",
    metric: "30%",
    metricLabel: "overlap alert threshold",
  },
  {
    kicker: "Macro Lab",
    title: "Cross-Asset Lead/Lag Matrix",
    body: "Rolling 30/90-day correlation between yields, USD/INR, crude and sector groups pinpoints macro-driven accumulation zones before price confirms.",
    metric: "90d",
    metricLabel: "rolling correlation window",
  },
];

/**
 * Pinned, scroll-orchestrated feature reel. The section pins while each card
 * advances; metrics split-reveal and cards translate as the user scrolls.
 */
export default function ScrollFeatures() {
  const section = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!section.current) return;
    const el = section.current;
    const ctx = gsap.context(() => {
      const cards = gsap.utils.toArray<HTMLElement>("[data-feature-card]");

      // Entry reveal for each card.
      cards.forEach((card) => {
        gsap.from(card, {
          y: 80,
          opacity: 0,
          duration: 0.9,
          ease: "power3.out",
          scrollTrigger: { trigger: card, start: "top 85%" },
        });
        const metric = card.querySelector<HTMLElement>("[data-metric]");
        if (metric) {
          gsap.from(metric, {
            scale: 0.6,
            opacity: 0,
            ease: "back.out(1.7)",
            duration: 0.8,
            scrollTrigger: { trigger: card, start: "top 80%" },
          });
        }
      });

      // Pin the heading rail and parallax-translate it as the section travels.
      const rail = el.querySelector<HTMLElement>("[data-rail]");
      if (rail) {
        gsap.to(rail, {
          yPercent: 12,
          ease: "none",
          scrollTrigger: {
            trigger: el,
            start: "top top",
            end: "bottom bottom",
            scrub: true,
            pin: rail,
            pinSpacing: false,
          },
        });
      }
    }, el);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={section} className="relative mx-auto max-w-6xl px-6 py-32">
      <div className="grid gap-16 lg:grid-cols-[0.8fr_1.2fr]">
        <div data-rail className="h-fit">
          <p className="text-sm uppercase tracking-[0.3em] text-[var(--ig-accent)]">
            The Terminal Core
          </p>
          <h2 className="mt-4 text-4xl font-bold leading-tight text-white sm:text-5xl">
            Three engines.
            <br />
            One sovereign view.
          </h2>
          <p className="mt-6 max-w-md text-white/60">
            InvestoGenie fuses derivative microstructure, fund look-through, and
            macro correlation into a single cinematic terminal — engineered for
            both the US and Indian markets.
          </p>
        </div>

        <div className="flex flex-col gap-8">
          {FEATURES.map((f) => (
            <article
              key={f.title}
              data-feature-card
              className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.01] p-8 backdrop-blur-md"
            >
              <p className="text-xs uppercase tracking-[0.25em] text-[var(--ig-primary)]">
                {f.kicker}
              </p>
              <div className="mt-4 flex items-start justify-between gap-6">
                <div>
                  <h3 className="text-2xl font-bold text-white">{f.title}</h3>
                  <p className="mt-3 max-w-md text-white/60">{f.body}</p>
                </div>
                <div className="text-right">
                  <div
                    data-metric
                    className="bg-gradient-to-br from-[var(--ig-primary)] to-[var(--ig-accent)] bg-clip-text text-5xl font-black tabular-nums text-transparent"
                  >
                    {f.metric}
                  </div>
                  <div className="mt-1 text-[10px] uppercase tracking-wider text-white/40">
                    {f.metricLabel}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
