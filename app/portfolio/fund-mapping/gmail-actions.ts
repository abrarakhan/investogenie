"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { encryptCredential } from "@/lib/crypto/credentials";
import { processPendingGmailAttachments } from "@/lib/gmail/processing";
import {
  downloadGmailDisclosureAttachment,
  scanGmailDisclosures,
} from "@/lib/gmail/disclosures";
import { inferAmc } from "@/lib/funds/fundMapping";
import {
  AmcDisclosureProvider,
  parseDisclosureSource,
} from "@/lib/funds/amcProvider";

async function requireUser() {
  const user = await getSessionUser();
  if (!user) throw new Error("Not signed in");
  return user;
}

export async function scanGmailDisclosureInbox() {
  const user = await requireUser();
  const result = await scanGmailDisclosures(user.id);
  revalidatePath("/portfolio/fund-mapping");
  return result;
}

export async function saveGmailOAuthCredentials(formData: FormData) {
  const user = await requireUser();
  const clientId = String(formData.get("gmailClientId") ?? "").trim();
  const clientSecret = String(formData.get("gmailClientSecret") ?? "").trim();
  if (!clientId || !clientSecret) throw new Error("Enter both the Google OAuth client ID and client secret");
  if (!clientId.endsWith(".apps.googleusercontent.com")) throw new Error("Enter a Google OAuth Web application client ID");
  await query(
    `insert into public.user_credentials (user_id,gmail_client_id_encrypted,gmail_client_secret_encrypted)
     values ($1,$2,$3)
     on conflict (user_id) do update set gmail_client_id_encrypted=excluded.gmail_client_id_encrypted,
       gmail_client_secret_encrypted=excluded.gmail_client_secret_encrypted,updated_at=now()`,
    [user.id, encryptCredential(clientId), encryptCredential(clientSecret)],
  );
  revalidatePath("/portfolio/fund-mapping");
}

export async function saveGmailAutoImportSettings(formData: FormData) {
  const user = await requireUser();
  const password = String(formData.get("casPassword") ?? "").trim();
  const enabled = String(formData.get("autoImport") ?? "") === "on";
  await query(
    `update public.gmail_connections set
       cas_pdf_password_encrypted=coalesce($2,cas_pdf_password_encrypted),
       auto_import_enabled=$3,updated_at=now() where user_id=$1`,
    [user.id, password ? encryptCredential(password) : null, enabled],
  );
  const result = enabled ? await processPendingGmailAttachments(user.id) : null;
  revalidatePath("/portfolio/fund-mapping");
  return result;
}

export async function clearGmailCasPassword() {
  const user = await requireUser();
  await query("update public.gmail_connections set cas_pdf_password_encrypted=null,updated_at=now() where user_id=$1", [user.id]);
  revalidatePath("/portfolio/fund-mapping");
}

export async function disconnectGmailDisclosureInbox() {
  const user = await requireUser();
  await query("delete from public.gmail_connections where user_id=$1", [user.id]);
  await query("delete from public.gmail_disclosure_attachments where user_id=$1", [user.id]);
  revalidatePath("/portfolio/fund-mapping");
}

export async function ignoreGmailDisclosure(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("attachmentId") ?? "");
  await query(
    "update public.gmail_disclosure_attachments set status='ignored',updated_at=now() where id=$1 and user_id=$2",
    [id, user.id],
  );
  revalidatePath("/portfolio/fund-mapping");
}

type HeldFund = {
  holding_id: string;
  asset_id: string;
  ticker: string;
  name: string;
  isin: string | null;
};

export async function importGmailDisclosure(formData: FormData) {
  const user = await requireUser();
  const attachmentId = String(formData.get("attachmentId") ?? "");
  const holdingId = String(formData.get("holdingId") ?? "");
  const monthRaw = String(formData.get("snapshotMonth") ?? "");
  const month = /^\d{4}-\d{2}(?:-\d{2})?$/.test(monthRaw)
    ? monthRaw.slice(0, 7) + "-01"
    : "";
  if (!attachmentId || !holdingId || !month) throw new Error("Choose a fund and disclosure month");

  const document = await queryOne<{ document_type: string }>(
    "select document_type from public.gmail_disclosure_attachments where id=$1 and user_id=$2", [attachmentId, user.id],
  );
  if (document?.document_type !== "amc_disclosure") throw new Error("This attachment is not an AMC portfolio disclosure");

  const fund = await queryOne<HeldFund>(
    "select h.id holding_id,a.id asset_id,a.ticker,coalesce(amfi.scheme_name,a.name,a.ticker) name," +
    "coalesce(nullif(chd.isin,''),nullif(m.amfi_code_in,'')) isin " +
    "from public.holdings h join public.assets a on a.id=h.asset_id " +
    "left join public.cas_holding_details chd on chd.holding_id=h.id and chd.user_id=h.user_id " +
    "left join public.mutual_fund_meta m on m.asset_id=a.id " +
    "left join lateral (select master.scheme_name from public.amfi_scheme_master master " +
    "where upper(master.isin_payout_or_growth)=upper(coalesce(nullif(chd.isin,''),nullif(m.amfi_code_in,''))) " +
    "or upper(master.isin_reinvestment)=upper(coalesce(nullif(chd.isin,''),nullif(m.amfi_code_in,''))) " +
    "order by master.is_active desc,master.nav_date desc nulls last limit 1) amfi on true " +
    "where h.id=$1 and h.user_id=$2 and a.asset_class='MUTUAL_FUND' limit 1",
    [holdingId, user.id],
  );
  if (!fund) throw new Error("The selected fund holding was not found");

  try {
    const attachment = await downloadGmailDisclosureAttachment(user.id, attachmentId);
    const file = new File([new Uint8Array(attachment.bytes)], attachment.filename, {
      type: attachment.mime_type ?? "application/octet-stream",
    });
    const isWorkbook = /\.(?:xlsx?|xlsm)$/i.test(attachment.filename);
    let parsed = await parseDisclosureSource(file, { full: true, sheet: isWorkbook ? fund.name : undefined });
    if (typeof parsed === "string" && !isWorkbook) parsed = await parseDisclosureSource(file, { full: true });
    if (typeof parsed === "string" || parsed.rows.length === 0) {
      throw new Error("No portfolio rows were detected for the selected fund");
    }
    await new AmcDisclosureProvider().ingestSnapshot({
      meta: {
        schemeCode: fund.ticker,
        name: fund.name,
        isin: fund.isin,
        amc: inferAmc(fund.name, fund.isin),
        category: null,
        subCategory: null,
      },
      month,
      rows: parsed.rows,
      assetId: fund.asset_id,
    });
    await query(
      "insert into public.user_fund_mappings " +
      "(user_id,user_holding_id,scheme_code,status,match_method,confidence,matched_at,matched_by,updated_at) " +
      "values ($1,$2,$3,'matched','gmail_disclosure',1,now(),$1,now()) " +
      "on conflict (user_id,user_holding_id) do update set scheme_code=excluded.scheme_code,status='matched'," +
      "match_method='gmail_disclosure',confidence=1,matched_at=now(),matched_by=$1,rejected_at=null,updated_at=now()",
      [user.id, fund.holding_id, fund.ticker],
    );
    await query(
      "update public.gmail_disclosure_attachments set status='imported',matched_holding_id=$1," +
      "snapshot_month=$2,imported_at=now(),error_message=null,updated_at=now() where id=$3 and user_id=$4",
      [fund.holding_id, month, attachmentId, user.id],
    );
    revalidatePath("/portfolio/fund-mapping");
    revalidatePath("/terminal/in");
    return { rows: parsed.rows.length };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await query(
      "update public.gmail_disclosure_attachments set status='error',error_message=$1,updated_at=now() where id=$2 and user_id=$3",
      [message.slice(0, 500), attachmentId, user.id],
    );
    revalidatePath("/portfolio/fund-mapping");
    throw cause;
  }
}
