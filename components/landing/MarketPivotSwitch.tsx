"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { useMarket } from "@/context/MarketProvider";

/**
 * The Sovereign Market Pivot Switch. A floating geometric toggle between US and
 * India markets. The active "knob" slides via GSAP; the surrounding glow and
 * label cross-fade. Flipping it calls toggleMarket(), which updates global
 * context and CSS theme variables — every feed re-renders without a reload.
 */
export default function MarketPivotSwitch() {
  const { marketId, market, toggleMarket } = useMarket();
  const knob = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!knob.current) return;
    // Slide the knob to the active side and pulse the shell glow.
    gsap.to(knob.current, {
      xPercent: marketId === "US" ? 0 : 100,
      duration: 0.55,
      ease: "power3.inOut",
    });
    if (shell.current) {
      gsap.fromTo(
        shell.current,
        { boxShadow: `0 0 0px 0px ${market.theme.glow}` },
        {
          boxShadow: `0 0 48px 6px ${market.theme.glow}`,
          duration: 0.5,
          yoyo: true,
          repeat: 1,
          ease: "sine.inOut",
        },
      );
    }
  }, [marketId, market.theme.glow]);

  return (
    <button
      ref={shell}
      type="button"
      onClick={toggleMarket}
      aria-label={`Switch market, currently ${market.label}`}
      className="group relative grid grid-cols-2 items-center gap-1 rounded-full border border-white/15 bg-white/5 p-1.5 backdrop-blur-xl"
      style={{ width: "min(320px, 80vw)" }}
    >
      {/* Sliding knob (half width) */}
      <div
        ref={knob}
        className="pointer-events-none absolute left-1.5 top-1.5 bottom-1.5 w-[calc(50%-0.375rem)] rounded-full"
        style={{
          background: `linear-gradient(135deg, var(--ig-primary), var(--ig-accent))`,
        }}
      />
      <span
        className={`relative z-10 flex items-center justify-center gap-1.5 py-2 text-sm font-semibold transition-colors ${
          marketId === "US" ? "text-black" : "text-white/60"
        }`}
      >
        🇺🇸 US
      </span>
      <span
        className={`relative z-10 flex items-center justify-center gap-1.5 py-2 text-sm font-semibold transition-colors ${
          marketId === "IN" ? "text-black" : "text-white/60"
        }`}
      >
        🇮🇳 India
      </span>
    </button>
  );
}
