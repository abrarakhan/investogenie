import Link from "next/link";
import { MARKETS } from "@/lib/markets";
import type { MarketId } from "@/lib/types";

/**
 * Navigates between the two SEPARATE terminals (/terminal/us, /terminal/in).
 * Unlike the landing pivot, this is real navigation — each market is its own
 * terminal, not a re-theme of one combined view.
 */
export default function TerminalSwitch({ market }: { market: MarketId }) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-white/[0.035] p-1">
      {(["US", "IN"] as MarketId[]).map((m) => {
        const active = m === market;
        return (
          <Link
            key={m}
            href={`/terminal/${m.toLowerCase()}`}
            className={`rounded-md px-4 py-1.5 text-center text-xs font-semibold transition-colors ${
              active ? "text-black" : "text-white/55 hover:text-white"
            }`}
            style={
              active
                ? { background: "linear-gradient(135deg, var(--ig-primary), var(--ig-accent))" }
                : undefined
            }
          >
            {MARKETS[m].flag} {m === "US" ? "US" : "India"}
          </Link>
        );
      })}
    </div>
  );
}
