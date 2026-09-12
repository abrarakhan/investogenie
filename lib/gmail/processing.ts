import { decryptCredential } from "@/lib/crypto/credentials";
import { importCasStatementBytes, CasImportError } from "@/lib/cas/importStatement";
import { query, queryOne } from "@/lib/db";
import { AmcDisclosureProvider, parseDisclosureSource } from "@/lib/funds/amcProvider";
import { inferAmc, sameAmc } from "@/lib/funds/fundMapping";
import { downloadGmailDisclosureAttachment } from "@/lib/gmail/disclosures";
import { inferSnapshotMonth, type GmailDocumentType } from "@/lib/gmail/classification";

type HeldFund = { holding_id: string; asset_id: string; ticker: string; name: string; isin: string | null; amc: string | null };

async function heldFunds(userId: string): Promise<HeldFund[]> {
  const rows = await query<Omit<HeldFund, "amc">>(
    `select h.id holding_id,a.id asset_id,a.ticker,
            coalesce(amfi.scheme_name,a.name,a.ticker) name,
            coalesce(nullif(chd.isin,''),nullif(m.amfi_code_in,'')) isin
       from public.holdings h join public.assets a on a.id=h.asset_id
       left join public.cas_holding_details chd on chd.holding_id=h.id and chd.user_id=h.user_id
       left join public.mutual_fund_meta m on m.asset_id=a.id
       left join lateral (
         select master.scheme_name
           from public.amfi_scheme_master master
          where upper(master.isin_payout_or_growth)=upper(coalesce(nullif(chd.isin,''),nullif(m.amfi_code_in,'')))
             or upper(master.isin_reinvestment)=upper(coalesce(nullif(chd.isin,''),nullif(m.amfi_code_in,'')))
          order by master.is_active desc,master.nav_date desc nulls last
          limit 1
       ) amfi on true
      where h.user_id=$1 and a.asset_class='MUTUAL_FUND'::asset_class`, [userId],
  );
  return rows.map((row) => ({ ...row, amc: inferAmc(row.name, row.isin) }));
}

async function processCas(userId: string, id: string, passwordEncrypted: string | null) {
  const attachment = await downloadGmailDisclosureAttachment(userId, id);
  const result = await importCasStatementBytes({
    userId,
    bytes: attachment.bytes,
    filename: attachment.filename,
    password: passwordEncrypted ? decryptCredential(passwordEncrypted) : undefined,
  });
  // Retain the latest successful CAS as the only actionable record. Historical
  // failures are no longer useful once a newer cumulative statement imports.
  await query(
    `update public.gmail_disclosure_attachments
        set status='ignored',error_message=null,updated_at=now()
      where user_id=$1 and document_type='nsdl_cas' and id<>$2`,
    [userId, id],
  );
  return result;
}

async function processDisclosure(userId: string, id: string, meta: { inferred_amc: string | null; filename: string; email_subject: string | null; received_at: Date | string | null }) {
  const attachment = await downloadGmailDisclosureAttachment(userId, id);
  const funds = (await heldFunds(userId)).filter((fund) => sameAmc(meta.inferred_amc, fund.amc));
  if (!funds.length) throw new Error(`No imported CAS fund matches ${meta.inferred_amc ?? "this disclosure's AMC"}`);
  const multiScheme = /\.(?:xlsx?|xlsm)$/i.test(attachment.filename);
  if (!multiScheme && funds.length !== 1) throw new Error(`${funds.length} funds match this single-scheme attachment; choose the fund manually`);
  const month = inferSnapshotMonth({ filename: meta.filename, subject: meta.email_subject, receivedAt: meta.received_at });
  let imported = 0;
  let totalRows = 0;
  const failures: string[] = [];
  for (const fund of funds) {
    const prior = await queryOne<{ id: string }>(
      "select id from public.gmail_attachment_imports where attachment_id=$1 and holding_id=$2 and snapshot_month=$3 and status='imported'", [id, fund.holding_id, month],
    );
    if (prior) continue;
    const file = new File([new Uint8Array(attachment.bytes)], attachment.filename, { type: attachment.mime_type ?? "application/octet-stream" });
    let parsed = await parseDisclosureSource(file, { full: true, sheet: multiScheme ? fund.name : undefined });
    // A one-fund AMC cannot be mapped to the wrong user holding. Some AMCs use
    // opaque sheet codes, so accept an unselected workbook only when its full
    // contents still form one valid ~100% portfolio at ingest.
    if (typeof parsed === "string" && multiScheme && funds.length === 1) {
      parsed = await parseDisclosureSource(file, { full: true });
    }
    if (typeof parsed === "string" || !parsed.rows.length) {
      failures.push(fund.name);
      continue;
    }
    try {
      await new AmcDisclosureProvider().ingestSnapshot({
        meta: { schemeCode: fund.ticker, name: fund.name, isin: fund.isin, amc: fund.amc, category: null, subCategory: null },
        month, rows: parsed.rows, assetId: fund.asset_id,
      });
      await query(
        `insert into public.user_fund_mappings
           (user_id,user_holding_id,scheme_code,status,match_method,confidence,matched_at,matched_by,updated_at)
         values ($1,$2,$3,'matched','gmail_disclosure',1,now(),$1,now())
         on conflict (user_id,user_holding_id) do update set scheme_code=excluded.scheme_code,status='matched',
           match_method='gmail_disclosure',confidence=1,matched_at=now(),matched_by=$1,rejected_at=null,updated_at=now()`,
        [userId, fund.holding_id, fund.ticker],
      );
      await query(
        `insert into public.gmail_attachment_imports
           (attachment_id,user_id,holding_id,scheme_code,snapshot_month,row_count,status,detail)
         values ($1,$2,$3,$4,$5,$6,'imported','Automatic unambiguous Gmail import')
         on conflict (attachment_id,holding_id,snapshot_month) do update set row_count=excluded.row_count,status='imported',detail=excluded.detail,imported_at=now()`,
        [id, userId, fund.holding_id, fund.ticker, month, parsed.rows.length],
      );
      imported++;
      totalRows += parsed.rows.length;
    } catch (cause) {
      failures.push(`${fund.name}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  if (!imported && failures.length) throw new Error(`No scheme sheet imported: ${failures.slice(0, 3).join("; ")}`);
  return { imported, rows: totalRows, month, failures: failures.length };
}

export async function processPendingGmailAttachments(userId: string) {
  const connection = await queryOne<{ cas_pdf_password_encrypted: string | null; auto_import_enabled: boolean }>(
    "select cas_pdf_password_encrypted,auto_import_enabled from public.gmail_connections where user_id=$1", [userId],
  );
  if (!connection?.auto_import_enabled) return { processed: 0, imported: 0, review: 0, errors: 0 };

  // A consolidated account statement is cumulative. Importing older CAS PDFs
  // wastes work and can overwrite newer holdings with historical balances.
  await query(
    `with latest_cas as (
       select id
         from public.gmail_disclosure_attachments
        where user_id=$1 and document_type='nsdl_cas'
        order by received_at desc nulls last,discovered_at desc,id desc
        limit 1
     )
     update public.gmail_disclosure_attachments a
        set status='ignored',error_message='Superseded by the latest CAS statement',updated_at=now()
      where a.user_id=$1 and a.document_type='nsdl_cas'
        and a.id <> coalesce((select id from latest_cas),a.id)
        and (a.status in ('discovered','needs_password','error')
             or (a.status='processing' and a.processing_started_at < now()-interval '30 minutes'))`,
    [userId],
  );
  const candidates = await query<{ id: string; document_type: GmailDocumentType; inferred_amc: string | null; filename: string; email_subject: string | null; received_at: Date | string | null }>(
    `select id,document_type,inferred_amc,filename,email_subject,received_at
       from public.gmail_disclosure_attachments
      where user_id=$1
        and (status in ('discovered','needs_password') or (status='processing' and processing_started_at < now()-interval '30 minutes'))
        and document_type <> 'unknown'
        and (document_type <> 'nsdl_cas' or id=(
          select newest.id from public.gmail_disclosure_attachments newest
           where newest.user_id=$1 and newest.document_type='nsdl_cas'
           order by newest.received_at desc nulls last,newest.discovered_at desc,newest.id desc
           limit 1
        ))
      order by case when document_type='nsdl_cas' then 0 else 1 end,
               received_at desc nulls last
      limit 15`, [userId],
  );
  const result = { processed: 0, imported: 0, review: 0, errors: 0 };
  for (const item of candidates) {
    const claimed = await queryOne<{ id: string }>(
      `update public.gmail_disclosure_attachments set status='processing',processing_started_at=now(),error_message=null,updated_at=now()
        where id=$1 and user_id=$2
          and (status in ('discovered','needs_password') or (status='processing' and processing_started_at < now()-interval '30 minutes'))
        returning id`, [item.id, userId],
    );
    if (!claimed) continue;
    result.processed++;
    try {
      const detail = item.document_type === "nsdl_cas"
        ? await processCas(userId, item.id, connection.cas_pdf_password_encrypted)
        : await processDisclosure(userId, item.id, item);
      await query(
        `update public.gmail_disclosure_attachments set status='imported',snapshot_month=$1,imported_at=now(),
           processing_completed_at=now(),error_message=null,updated_at=now() where id=$2 and user_id=$3`,
        ["month" in detail ? detail.month : null, item.id, userId],
      );
      result.imported++;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const needsPassword = cause instanceof CasImportError && (cause.code === "encrypted" || cause.code === "bad_password");
      const needsReview = item.document_type === "amc_disclosure" && /(?:No imported CAS fund|choose the fund manually|No scheme sheet imported)/i.test(message);
      const status = needsPassword ? "needs_password" : needsReview ? "needs_review" : "error";
      await query(
        `update public.gmail_disclosure_attachments set status=$1,error_message=$2,processing_completed_at=now(),updated_at=now() where id=$3 and user_id=$4`,
        [status, message.slice(0, 500), item.id, userId],
      );
      if (needsPassword || needsReview) result.review++; else result.errors++;
    }
  }
  return result;
}
