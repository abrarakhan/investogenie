"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { GmailDisclosureData } from "@/lib/gmail/disclosures";
import { sameAmc } from "@/lib/funds/fundMapping";
import type { UserFundMappingRow } from "@/lib/funds/fundMappingStore";
import {
  disconnectGmailDisclosureInbox,
  ignoreGmailDisclosure,
  importGmailDisclosure,
  scanGmailDisclosureInbox,
} from "@/app/portfolio/fund-mapping/gmail-actions";

const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(new Date(value))
  : "Never";

function priorMonth(value: string | null) {
  const date = value ? new Date(value) : new Date();
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const prior = new Date(Date.UTC(year, month - 1, 1));
  return prior.toISOString().slice(0, 10);
}

export default function GmailDisclosurePanel({
  gmail,
  funds,
}: {
  gmail: GmailDisclosureData;
  funds: UserFundMappingRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  const run = (work: () => Promise<unknown>, success: string) => {
    setNotice(null);
    startTransition(async () => {
      try {
        await work();
        setNotice(success);
        router.refresh();
      } catch (cause) {
        setNotice(cause instanceof Error ? cause.message : "Gmail operation failed");
      }
    });
  };

  if (!gmail.connection.configured) {
    return (
      <section className="rounded-lg border border-amber-300/20 bg-amber-300/[0.06] p-5">
        <h2 className="text-lg font-black">Gmail Disclosure Inbox</h2>
        <p className="mt-2 text-sm text-white/55">
          Gmail OAuth needs deployment credentials before this account can connect. Enable the Gmail API,
          create a Web OAuth client, and set <code>GOOGLE_GMAIL_CLIENT_ID</code> and
          <code> GOOGLE_GMAIL_CLIENT_SECRET</code>. Add <code>/api/gmail/callback</code> on each app origin
          as an authorized redirect URI.
        </p>
        <p className="mt-2 text-xs text-amber-200/70">
          Access is read-only. InvestoGenie stores encrypted OAuth tokens and attachment metadata, never email bodies or attachment files.
        </p>
      </section>
    );
  }

  if (!gmail.connection.connected) {
    return (
      <section className="rounded-lg border border-white/10 bg-white/[0.025] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-black">Gmail Disclosure Inbox</h2>
            <p className="mt-1 max-w-3xl text-sm text-white/48">
              Connect Gmail read-only to discover AMC monthly portfolio attachments. Every import still requires your confirmation.
            </p>
          </div>
          <a href="/api/gmail/connect" className="rounded-lg bg-[var(--ig-accent)] px-4 py-2.5 text-sm font-bold text-black">
            Connect Gmail
          </a>
        </div>
      </section>
    );
  }

  const visible = gmail.attachments.filter((item) => item.status !== "ignored");
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.025] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-black">Gmail Disclosure Inbox</h2>
          <p className="mt-1 text-sm text-white/48">
            Connected to {gmail.connection.email} · last scanned {formatDate(gmail.connection.lastScanAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            disabled={pending}
            onClick={() => run(
              () => scanGmailDisclosureInbox(),
              "Inbox scan complete. Review the discovered attachments below.",
            )}
            className="rounded-lg border border-[var(--ig-accent)]/35 bg-[var(--ig-accent)]/10 px-4 py-2 text-sm font-semibold text-[var(--ig-accent)] disabled:opacity-50"
          >
            {pending ? "Working..." : "Scan Gmail now"}
          </button>
          <button
            disabled={pending}
            onClick={() => {
              if (window.confirm("Disconnect Gmail and remove all discovered email metadata from InvestoGenie?")) {
                run(() => disconnectGmailDisclosureInbox(), "Gmail disconnected.");
              }
            }}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/55"
          >
            Disconnect
          </button>
        </div>
      </div>
      {notice && <div className="mt-4 rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/70">{notice}</div>}

      {visible.length === 0 ? (
        <p className="mt-5 rounded-lg border border-white/8 px-4 py-8 text-center text-sm text-white/40">
          No monthly portfolio attachments discovered yet.
        </p>
      ) : (
        <div className="mt-5 space-y-3">
          {visible.map((attachment) => {
            const matchingFunds = funds.filter((fund) => sameAmc(attachment.inferredAmc, fund.amc));
            const defaultHolding = attachment.matchedHoldingId
              ?? (matchingFunds.length === 1 ? matchingFunds[0].holdingId : "");
            return (
              <article key={attachment.id} className="rounded-lg border border-white/8 bg-black/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-white/85" title={attachment.filename}>{attachment.filename}</p>
                    <p className="mt-1 text-xs text-white/40">{attachment.subject ?? "No subject"} · {formatDate(attachment.receivedAt)}</p>
                    <p className="mt-1 text-[11px] text-white/32">{attachment.sender ?? "Unknown sender"} · {(attachment.sizeBytes / 1024).toFixed(0)} KB</p>
                  </div>
                  <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase text-white/45">
                    {attachment.status}
                  </span>
                </div>
                {attachment.status === "imported" ? (
                  <p className="mt-3 text-xs text-emerald-300">Imported for snapshot month {attachment.snapshotMonth?.slice(0, 7)}.</p>
                ) : (
                  <form
                    className="mt-4 grid gap-3 md:grid-cols-[1fr_180px_auto_auto]"
                    action={(data) => run(
                      () => importGmailDisclosure(data),
                      "Disclosure imported and Fund X-Ray mapping updated.",
                    )}
                  >
                    <input type="hidden" name="attachmentId" value={attachment.id} />
                    <select name="holdingId" required defaultValue={defaultHolding} className="field bg-[#090c12]">
                      <option value="" disabled>Choose matching CAS fund</option>
                      {(matchingFunds.length > 0 ? matchingFunds : funds).map((fund) => (
                        <option key={fund.holdingId} value={fund.holdingId}>{fund.fundName}</option>
                      ))}
                    </select>
                    <input name="snapshotMonth" aria-label="Snapshot month" type="date" required defaultValue={priorMonth(attachment.receivedAt)} className="field" />
                    <button disabled={pending} className="min-h-11 rounded-lg bg-emerald-500/15 px-4 text-sm font-semibold text-emerald-200 disabled:opacity-50">Import snapshot</button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        const data = new FormData();
                        data.set("attachmentId", attachment.id);
                        run(() => ignoreGmailDisclosure(data), "Attachment ignored.");
                      }}
                      className="min-h-11 rounded-lg border border-white/10 px-3 text-sm text-white/50"
                    >
                      Ignore
                    </button>
                  </form>
                )}
                {attachment.errorMessage && <p className="mt-2 text-xs text-rose-300">{attachment.errorMessage}</p>}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
