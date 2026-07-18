import Link from "next/link";
import TerminalSwitch from "./TerminalSwitch";
import { signout } from "@/app/login/actions";
import { MARKETS } from "@/lib/markets";
import type { MarketId } from "@/lib/types";

const navItem = "hidden h-9 items-center border-r border-white/10 px-3 text-xs font-medium text-white/62 transition-colors last:border-r-0 hover:bg-white/[0.07] hover:text-white md:flex";

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

        <div className="flex flex-wrap items-center gap-3">
          <nav className="hidden overflow-hidden rounded-lg border border-white/10 bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] md:flex">
            <Link href={`/markets/${market.toLowerCase()}`} className={navItem}>
              Overview
            </Link>
            <Link href="/screener" className={navItem}>
              Screener
            </Link>
            <Link href={`/terminal/${market.toLowerCase()}/screener`} className={navItem}>
              Swing Candidates
            </Link>
            <Link href="/admin/sync" className={navItem}>
              Sync
            </Link>
            {market === "IN" && (
              <Link href="/terminal/in/cas" className={navItem}>
                CAS Upload
              </Link>
            )}
            <Link href="/settings" className={navItem}>
              Settings
            </Link>
          </nav>
          <TerminalSwitch market={market} />
          <div className="hidden text-right sm:block">
            <div className="text-xs text-white/40">Signed in</div>
            <div className="max-w-[160px] truncate text-sm text-white/80">{email}</div>
          </div>
          <form action={signout}>
            <button
              type="submit"
              className="h-9 rounded-lg border border-white/10 bg-white/[0.035] px-3 text-xs font-medium text-white/62 transition-colors hover:bg-white/[0.07] hover:text-white"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
