import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getUserSwingSettings } from "@/lib/settings";
import { saveSwingSettings, resetSwingSettings } from "./actions";

export const dynamic = "force-dynamic";

function Field({
  name, label, value, hint, step = "0.1", min = "0.25", max = "15",
}: {
  name: string; label: string; value: number; hint: string; step?: string; min?: string; max?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-white/80">{label}</span>
      <input
        name={name}
        type="number"
        step={step}
        min={min}
        max={max}
        defaultValue={value}
        className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-[var(--ig-primary)]"
      />
      <span className="mt-1 block text-xs text-white/40">{hint}</span>
    </label>
  );
}

export default async function SettingsPage() {
  if (!(await getSessionUser())) redirect("/login");
  const s = await getUserSwingSettings();

  return (
    <div className="min-h-screen bg-[#05070d] text-white">
      <header className="border-b border-white/10 px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link href="/" className="text-xl font-black tracking-tight">
            Investo<span className="text-[var(--ig-accent)]">Genie</span>
            <span className="ml-2 align-middle text-[10px] uppercase tracking-widest text-white/40">Risk Settings</span>
          </Link>
          <Link href="/terminal/us" className="text-sm text-white/60 hover:text-white">← Terminal</Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-bold">Swing risk settings</h1>
        <p className="mt-2 text-sm text-white/50">
          These tune the trade levels (entry/target/stop/trail) computed for every
          stock. Leave them as-is to use the defaults. Changes apply instantly — no
          rescan needed.
        </p>

        <form action={saveSwingSettings} className="mt-8 space-y-6">
          <div className="grid gap-5 sm:grid-cols-3">
            <Field name="stop_atr_mult" label="Stop (× ATR)" value={s.stopAtrMult} hint="Distance of the protective stop from entry. Default 1.5." />
            <Field name="target_rr" label="Target (reward:risk)" value={s.targetRR} hint="Profit target as a multiple of risk. Default 2.0." min="0.5" max="10" />
            <Field name="trail_atr_mult" label="Trailing stop (× ATR)" value={s.trailAtrMult} hint="Chandelier trail distance. Default 3.0." min="0.5" max="15" />
          </div>

          <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <input type="checkbox" name="include_short" defaultChecked={s.includeShort} className="h-4 w-4" />
            <span>
              <span className="block text-sm font-medium">Include short / sell-side setups</span>
              <span className="block text-xs text-white/40">Show breakdown (down-trend) setups alongside long breakouts.</span>
            </span>
          </label>

          <div className="flex items-center gap-3">
            <button type="submit" className="rounded-lg bg-gradient-to-r from-[var(--ig-primary)] to-[var(--ig-accent)] px-5 py-2.5 text-sm font-semibold text-black">
              Save settings
            </button>
          </div>
        </form>

        <form action={resetSwingSettings} className="mt-4">
          <button type="submit" className="text-xs text-white/40 hover:text-rose-400">
            Reset to defaults
          </button>
        </form>
      </main>
    </div>
  );
}
