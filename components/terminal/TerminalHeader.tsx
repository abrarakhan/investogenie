import Link from "next/link";
import TerminalSwitch from "./TerminalSwitch";
import { signout } from "@/app/login/actions";
import { MARKETS } from "@/lib/markets";
import type { MarketId } from "@/lib/types";

export default function TerminalHeader({
  email,
  market,
}: {
  email: string;
  market: MarketId;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#05070d]/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" className="text-xl font-black tracking-tight">
          Investo<span className="text-[var(--ig-accent)]">Genie</span>
          <span className="ml-2 align-middle text-[10px] uppercase tracking-widest text-white/40">
            {MARKETS[market].label} Terminal
          </span>
        </Link>

        <div className="flex items-center gap-4">
          <Link
            href={`/terminal/${market.toLowerCase()}/screener`}
            className="hidden rounded-full border border-white/15 px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white sm:block"
          >
            Screener
          </Link>
          <Link
            href="/settings"
            className="hidden rounded-full border border-white/15 px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white sm:block"
          >
            Settings
          </Link>
          <TerminalSwitch market={market} />
          <div className="hidden text-right sm:block">
            <div className="text-xs text-white/40">Signed in</div>
            <div className="max-w-[160px] truncate text-sm text-white/80">{email}</div>
          </div>
          <form action={signout}>
            <button
              type="submit"
              className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
