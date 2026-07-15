import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import TerminalHeader from "@/components/terminal/TerminalHeader";
import ApplyMarketTheme from "@/components/terminal/ApplyMarketTheme";
import { query } from "@/lib/db";
import { importAmcDisclosure, importCasStatement } from "./actions";
import ImportButton from "./ImportButton";

export const dynamic = "force-dynamic";

function statusMessage(status: string | undefined, count: string | undefined, funds: string | undefined, stocks: string | undefined) {
  if (status === "imported") return `Imported ${count ?? ""} holdings: ${funds ?? "0"} funds and ${stocks ?? "0"} stocks.`;
  if (status === "missing") return "Choose a CAS PDF, text, or CSV file before importing.";
  if (status === "too_large") return "The CAS file is too large for the local upload limit. Try a smaller CAS export or increase serverActions.bodySizeLimit.";
  if (status === "encrypted") return "This CAS PDF is encrypted. Enter the CAS password and try again.";
  if (status === "bad_password") return "The CAS password did not unlock the PDF.";
  if (status === "parser_missing") return "PDF parser dependency is missing. Install pypdf in the local virtualenv.";
  if (status === "crypto_missing") return "The PDF needs crypto support. I installed it locally; restart the app and try again.";
  if (status === "no_text") return "The PDF unlocked, but no text could be extracted. It may be a scanned/image CAS; export text/CSV from CAMS/KFintech and upload that.";
  if (status === "failed") return "CAS import failed on the server. Check the file/password; if it is a scanned image PDF, export text/CSV from CAMS/KFintech and try again.";
  if (status === "empty") return "No holdings were detected. For CSV/text, use columns such as Scheme/Security Name, ISIN, Units/Quantity, NAV/Price, and Current Value.";
  return null;
}

function disclosureMessage(status: string | undefined, rows: string | undefined) {
  if (status === "imported") return `Imported ${rows ?? ""} stock weights into Fund Overlap X-Ray.`;
  if (status === "missing_fund") return "Choose the fund this AMC disclosure belongs to.";
  if (status === "missing_file") return "Choose the AMC monthly portfolio disclosure file before importing.";
  if (status === "invalid_fund") return "That fund was not found in your local mutual fund holdings.";
  if (status === "bad_password") return "The disclosure PDF password did not unlock the file.";
  if (status === "empty") return "No stock weights were detected. Try the AMC Excel/CSV disclosure, or a PDF with selectable text.";
  if (status === "failed") return "AMC disclosure import failed. Try the XLSX/CSV version from the AMC downloads page if the PDF layout is not extractable.";
  return null;
}

export default async function CasUploadPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; count?: string; funds?: string; stocks?: string; disclosure?: string; rows?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  const message = statusMessage(params.status, params.count, params.funds, params.stocks);
  const disclosureStatus = disclosureMessage(params.disclosure, params.rows);
  const funds = await query<{ id: string; ticker: string; name: string | null }>(
    `select distinct a.id, a.ticker, a.name
       from public.holdings h
       join public.assets a on a.id = h.asset_id
      where h.user_id = $1 and a.asset_class = 'MUTUAL_FUND'::asset_class
      order by coalesce(a.name, a.ticker)`,
    [user.id],
  );

  return (
    <div className="min-h-screen bg-[#05070d] text-white">
      <ApplyMarketTheme market="IN" />
      <TerminalHeader email={user.email ?? ""} market="IN" />
      <main className="mx-auto max-w-4xl space-y-8 px-6 py-10">
        <div>
          <Link href="/terminal/in" className="text-sm text-white/50 hover:text-white">Back to India terminal</Link>
          <h1 className="mt-4 text-3xl font-black">CAS Statement Import</h1>
          <p className="mt-2 max-w-2xl text-white/55">
            Use this when Breeze/OI data is empty or unavailable. Upload your CAS PDF, CSV, or copied text table,
            and InvestoGenie will create local mutual fund and stock holdings for portfolio analysis.
          </p>
        </div>

        {message && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-white/75">
            {message}
          </div>
        )}

        {disclosureStatus && (
          <div className="rounded-2xl border border-[var(--ig-accent)]/25 bg-[var(--ig-accent)]/8 px-5 py-4 text-sm text-white/75">
            {disclosureStatus}
          </div>
        )}

        <section className="rounded-3xl border border-white/10 bg-white/[0.02] p-6">
          <h2 className="text-lg font-bold">Upload CAS PDF, text, or CSV</h2>
          <p className="mt-2 text-sm text-white/45">
            PDFs are extracted locally with the password you provide for this import only. Best CSV/text columns: Scheme/Security Name, Folio, ISIN, Units/Quantity, NAV/Price, Current Value. Files are not stored after import.
          </p>
          <form action={importCasStatement} className="mt-6 space-y-4">
            <input
              name="casFile"
              type="file"
              accept=".pdf,.csv,.txt,.tsv,application/pdf,text/csv,text/plain"
              className="block w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/70 file:mr-4 file:rounded-full file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-white"
            />
            <label className="block text-sm text-white/55">
              PDF password, if encrypted
              <input
                name="pdfPassword"
                type="password"
                autoComplete="off"
                className="mt-2 block w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/80 outline-none focus:border-[var(--ig-accent)]"
                placeholder="Usually PAN/date-based CAS password"
              />
            </label>
            <ImportButton />
          </form>
        </section>


        <section className="rounded-3xl border border-white/10 bg-white/[0.02] p-6">
          <h2 className="text-lg font-bold">Import AMC monthly portfolio disclosure</h2>
          <p className="mt-2 text-sm text-white/45">
            Download the latest monthly portfolio disclosure from the fund house, choose the matching fund below, and upload the XLSX, CSV, text, or selectable-text PDF. The importer replaces that fund&apos;s stock look-through weights in the local database.
          </p>
          <form action={importAmcDisclosure} className="mt-6 space-y-4">
            <label className="block text-sm text-white/55">
              Fund holding
              <select
                name="fundAssetId"
                className="mt-2 block w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/80 outline-none focus:border-[var(--ig-accent)]"
                defaultValue=""
              >
                <option value="" disabled>Choose fund</option>
                {funds.map((fund) => (
                  <option key={fund.id} value={fund.id}>
                    {fund.name || fund.ticker}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm text-white/55">
                Disclosure as-of date
                <input
                  name="asOfDate"
                  type="date"
                  className="mt-2 block w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/80 outline-none focus:border-[var(--ig-accent)]"
                />
              </label>
              <label className="block text-sm text-white/55">
                PDF password, if encrypted
                <input
                  name="disclosurePassword"
                  type="password"
                  autoComplete="off"
                  className="mt-2 block w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/80 outline-none focus:border-[var(--ig-accent)]"
                  placeholder="Only needed for encrypted PDFs"
                />
              </label>
            </div>
            <input
              name="disclosureFile"
              type="file"
              accept=".xlsx,.xls,.csv,.txt,.tsv,.pdf,application/pdf,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="block w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/70 file:mr-4 file:rounded-lg file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-white"
            />
            <ImportButton label="Import AMC disclosure" pendingLabel="Importing disclosure..." />
          </form>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.02] p-6">
          <h2 className="text-lg font-bold">What gets imported</h2>
          <p className="mt-2 text-sm text-white/50">
            Mutual funds are imported as CAS fund assets, stocks are imported as CAS stock assets, and a local latest quote is derived from the statement value divided by units/quantity. That makes the India terminal useful immediately even before broker or exchange mapping is added.
          </p>
        </section>
      </main>
    </div>
  );
}
