import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import AppShell from "@/components/app/AppShell";
import { getUserSwingSettings } from "@/lib/settings";
import { getEmailPreferences } from "@/lib/email-actions";
import { getUserCredentials } from "@/lib/credentials-actions";
import { saveSwingSettings, resetSwingSettings } from "./actions";
import EmailPreferencesForm from "@/components/settings/EmailPreferencesForm";
import CredentialsForm from "@/components/settings/CredentialsForm";

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
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const s = await getUserSwingSettings();
  const emailPrefs = await getEmailPreferences();
  const creds = await getUserCredentials();

  return (
    <AppShell
      email={user.email ?? ""}
      market="US"
      active="settings"
      title="Settings"
      subtitle="Risk defaults and account-level preferences for the research workspace."
      maxWidth="max-w-3xl"
    >
      <section>
        <h2 className="text-2xl font-bold">Swing risk settings</h2>
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
              <span className="block text-xs text-white/40">Show breakdown setups alongside buy breakouts in advanced engine views.</span>
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
      </section>

      <section className="mt-12 border-t border-white/10 pt-12">
        <h2 className="text-2xl font-bold">Email digest</h2>
        <p className="mt-2 text-sm text-white/50">
          Receive a daily morning email with top 5 stocks from the swing candidates
          and probability screens, with full details on each.
        </p>
        <EmailPreferencesForm initialPrefs={emailPrefs} userEmail={user.email || ""} />
      </section>

      <section className="mt-12 border-t border-white/10 pt-12">
        <h2 className="text-2xl font-bold">Secured credentials</h2>
        <p className="mt-2 text-sm text-white/50">
          Store your email and API keys securely. All credentials are encrypted with AES-256-GCM
          before storage in the database.
        </p>
        <div className="mt-8">
          <CredentialsForm initialCreds={creds} />
        </div>
      </section>
    </AppShell>
  );
}
