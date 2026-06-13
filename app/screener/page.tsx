import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { runScreener } from "@/lib/screener";
import ScreenerTable from "@/components/screener/ScreenerTable";

export const dynamic = "force-dynamic";

export default async function ScreenerPage() {
  const supabase = createClient(await cookies());
  const rows = await runScreener(supabase);

  return (
    <div className="min-h-screen bg-[#05070d] text-white">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#05070d]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-xl font-black tracking-tight">
            Investo<span className="text-[var(--ig-accent)]">Genie</span>
            <span className="ml-2 align-middle text-[10px] uppercase tracking-widest text-white/40">
              Screener
            </span>
          </Link>
          <nav className="flex gap-5 text-sm text-white/60">
            <Link href="/dashboard" className="hover:text-white">Dashboard</Link>
            <Link href="/" className="hover:text-white">Home</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Swing Screener</h1>
          <p className="mt-2 max-w-2xl text-white/50">
            The derivative-aided swing classifier run across the liquid universe —
            Nifty 50 (live NSE EOD) and the S&amp;P 100 subset. Breakouts and
            volatility squeezes are flagged; an OI build-up upgrades a breakout to
            a validated long.
          </p>
          <p className="mt-2 text-xs text-amber-300/70">
            Note: US bars are an anchored demo feed (free US EOD providers block
            scripted access here); Indian bars are live NSE bhavcopy data.
          </p>
        </div>

        <ScreenerTable rows={rows} />
      </main>
    </div>
  );
}
