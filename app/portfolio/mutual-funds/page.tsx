import Link from "next/link";
import { redirect } from "next/navigation";
import AppShell from "@/components/app/AppShell";
import FundXRay from "@/components/funds/FundXRay";
import { HoldingsGroup } from "@/components/dashboard/ConsolidatedHoldings";
import { getConsolidatedIndiaHoldings } from "@/lib/portfolioHoldings";
import { getSessionUser } from "@/lib/auth";
import { getFundOverlap } from "@/lib/engines-runtime";
import { getGmailDisclosureData } from "@/lib/gmail/disclosures";

export const dynamic = "force-dynamic";

const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(value))
  : "never";

/** Mutual funds on their own screen: CAS import health, holdings and the Fund Overlap X-Ray. */
export default async function MutualFundsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const [overlap, gmail, holdings] = await Promise.all([
    getFundOverlap(),
    getGmailDisclosureData(user.id),
    getConsolidatedIndiaHoldings(user.id),
  ]);
  const funds = holdings.holdings.filter((row) => row.source === "MUTUAL_FUND");
  const connection = gmail.connection;
  const latestCas = gmail.attachments.find((item) => item.documentType === "nsdl_cas") ?? null;
  const importBroken = connection.connected && (connection.needsReconnect || Boolean(connection.lastError));

  return (
    <AppShell
      email={user.email ?? ""}
      market="IN"
      active="mutual-funds"
      title="Mutual Funds"
      subtitle="Your CAS fund holdings, their import status, and the look-through X-Ray of overlapping underlying stocks."
      maxWidth="max-w-6xl"
    >
      <section className={`mb-8 rounded-lg border p-4 ${importBroken ? "border-rose-400/30 bg-rose-400/[0.05]" : "border-white/10 bg-white/[0.025]"}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-bold">CAS import from Gmail</h2>
            <p className="mt-1 text-sm text-white/50">
              {!connection.connected
                ? "Gmail is not connected. Connect it to import your NSDL CAS statements automatically."
                : connection.needsReconnect
                  ? `Paused: Google no longer accepts the authorization for ${connection.email}. Reconnect to resume imports.`
                  : connection.lastError
                    ? `The last scan of ${connection.email} failed.`
                    : `Connected to ${connection.email} · last scanned ${formatDate(connection.lastScanAt)}.`}
            </p>
            {connection.lastError && <p className="mt-1 text-xs text-rose-100/75">{connection.lastError}</p>}
            {latestCas && (
              <p className="mt-2 text-xs text-white/45">
                Latest CAS email: {latestCas.filename} · received {formatDate(latestCas.receivedAt)} · {latestCas.status.replace("_", " ")}
                {latestCas.errorMessage ? ` — ${latestCas.errorMessage}` : ""}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {(!connection.connected || connection.needsReconnect) && (
              <a href="/api/gmail/connect" className="rounded-lg bg-[var(--ig-accent)] px-4 py-2 text-sm font-bold text-black">
                {connection.connected ? "Reconnect Gmail" : "Connect Gmail"}
              </a>
            )}
            <Link href="/terminal/in/cas" className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/5">
              Upload CAS PDF
            </Link>
            <Link href="/portfolio/fund-mapping" className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/5">
              Fund mapping &amp; Gmail inbox
            </Link>
          </div>
        </div>
      </section>
      <section className="mb-8 rounded-3xl border border-white/10 bg-white/[0.02] p-6">
        <HoldingsGroup
          title="Mutual fund holdings"
          rows={funds}
          total={holdings.totals.MUTUAL_FUND.value}
          note={`Units from your CAS${holdings.fundStatementDate ? ` (statement ${formatDate(holdings.fundStatementDate)})` : ""}, valued at the latest NAV; "CAS" marks funds still valued at the statement value, and "as of" marks an NAV older than 5 days.`}
        />
      </section>
      <FundXRay overlap={overlap} />
    </AppShell>
  );
}
