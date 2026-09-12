import { createHash, randomBytes } from "node:crypto";
import { decryptCredential, encryptCredential } from "@/lib/crypto/credentials";
import { query, queryOne } from "@/lib/db";
import { inferAmc } from "@/lib/funds/fundMapping";
import { classifyGmailDocument, inferSnapshotMonth } from "@/lib/gmail/classification";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_BYTES = 25 * 1024 * 1024;
const SUPPORTED = /\.(xlsx?|xlsm|csv|tsv|pdf)$/i;
const TRUSTED_DISCLOSURE_DOMAINS = [
  "camsonline.com", "kfintech.com", "sbimf.com", "quantmutual.com",
  "motilaloswalmf.com", "canararobeco.com", "hdfcfund.com",
  "icicipruamc.com", "nipponindiaim.com", "franklintempleton.com",
  "franklintempletonindia.com", "adityabirlacapital.com", "widen.net",
  "amazonaws.com", "cloudfront.net",
];

export interface GmailDisclosureAttachment {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
  subject: string | null;
  sender: string | null;
  receivedAt: string | null;
  inferredAmc: string | null;
  documentType: "nsdl_cas" | "amc_disclosure" | "unknown";
  status: "discovered" | "processing" | "imported" | "needs_password" | "needs_review" | "ignored" | "error";
  matchedHoldingId: string | null;
  snapshotMonth: string | null;
  errorMessage: string | null;
}

export interface GmailDisclosureData {
  connection: {
    connected: boolean;
    configured: boolean;
    email: string | null;
    lastScanAt: string | null;
    casPasswordSet: boolean;
    autoImportEnabled: boolean;
  };
  attachments: GmailDisclosureAttachment[];
}

type ConnectionRow = {
  gmail_email: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  token_expires_at: Date | string | null;
  scope: string;
  last_scan_at: Date | string | null;
  cas_pdf_password_encrypted?: string | null;
  auto_import_enabled?: boolean;
};

const iso = (value: Date | string | null) => value
  ? (value instanceof Date ? value.toISOString() : new Date(value).toISOString())
  : null;

export async function getGmailOAuthConfig(userId?: string) {
  const clientId = process.env.GOOGLE_GMAIL_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_GMAIL_CLIENT_SECRET ?? "";
  if (clientId && clientSecret) return { clientId, clientSecret, source: "environment" as const };
  if (!userId) return null;
  const row = await queryOne<{ gmail_client_id_encrypted: string | null; gmail_client_secret_encrypted: string | null }>(
    "select gmail_client_id_encrypted,gmail_client_secret_encrypted from public.user_credentials where user_id=$1",
    [userId],
  );
  if (!row?.gmail_client_id_encrypted || !row.gmail_client_secret_encrypted) return null;
  return {
    clientId: decryptCredential(row.gmail_client_id_encrypted),
    clientSecret: decryptCredential(row.gmail_client_secret_encrypted),
    source: "user" as const,
  };
}

export const hashOAuthState = (state: string) => createHash("sha256").update(state).digest("hex");

export async function createGmailOAuthState(userId: string, redirectUri: string) {
  const state = randomBytes(32).toString("base64url");
  await query("delete from public.gmail_oauth_states where expires_at < now()");
  await query(
    "insert into public.gmail_oauth_states (state_hash,user_id,redirect_uri,expires_at) values ($1,$2,$3,now()+interval '10 minutes')",
    [hashOAuthState(state), userId, redirectUri],
  );
  return state;
}

export async function consumeGmailOAuthState(state: string, userId: string) {
  const row = await queryOne<{ redirect_uri: string }>(
    "delete from public.gmail_oauth_states where state_hash=$1 and user_id=$2 and expires_at > now() returning redirect_uri",
    [hashOAuthState(state), userId],
  );
  return row?.redirect_uri ?? null;
}

export function buildGmailAuthorizationUrl(clientId: string, redirectUri: string, state: string) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  for (const [key, value] of Object.entries({
    client_id: clientId, redirect_uri: redirectUri, response_type: "code",
    scope: GMAIL_READONLY_SCOPE, access_type: "offline", prompt: "consent",
    include_granted_scopes: "true", state,
  })) url.searchParams.set(key, value);
  return url.toString();
}

type TokenResponse = {
  access_token?: string; refresh_token?: string; expires_in?: number; scope?: string;
  error?: string; error_description?: string;
};

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body, cache: "no-store",
  });
  const payload = await response.json() as TokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || "Google token exchange failed");
  }
  return payload;
}

export async function completeGmailConnection(input: { userId: string; code: string; redirectUri: string }) {
  const config = await getGmailOAuthConfig(input.userId);
  if (!config) throw new Error("Gmail OAuth is not configured");
  const token = await tokenRequest(new URLSearchParams({
    code: input.code, client_id: config.clientId, client_secret: config.clientSecret,
    redirect_uri: input.redirectUri, grant_type: "authorization_code",
  }));
  const profileResponse = await fetch(API + "/profile", {
    headers: { authorization: "Bearer " + token.access_token }, cache: "no-store",
  });
  if (!profileResponse.ok) throw new Error("Could not read the connected Gmail profile");
  const profile = await profileResponse.json() as { emailAddress: string };
  const existing = await queryOne<{ refresh_token_encrypted: string | null }>(
    "select refresh_token_encrypted from public.gmail_connections where user_id=$1", [input.userId],
  );
  await query(
    "insert into public.gmail_connections (user_id,gmail_email,access_token_encrypted,refresh_token_encrypted,token_expires_at,scope,connected_at,updated_at) " +
    "values ($1,$2,$3,$4,now()+($5 || ' seconds')::interval,$6,now(),now()) " +
    "on conflict (user_id) do update set gmail_email=excluded.gmail_email,access_token_encrypted=excluded.access_token_encrypted," +
    "refresh_token_encrypted=coalesce(excluded.refresh_token_encrypted,gmail_connections.refresh_token_encrypted)," +
    "token_expires_at=excluded.token_expires_at,scope=excluded.scope,connected_at=now(),updated_at=now()",
    [input.userId, profile.emailAddress, encryptCredential(token.access_token!),
      token.refresh_token ? encryptCredential(token.refresh_token) : existing?.refresh_token_encrypted ?? null,
      String(token.expires_in ?? 3600), token.scope ?? GMAIL_READONLY_SCOPE],
  );
  return profile.emailAddress;
}

async function getAccessToken(userId: string) {
  const connection = await queryOne<ConnectionRow>(
    "select gmail_email,access_token_encrypted,refresh_token_encrypted,token_expires_at,scope,last_scan_at from public.gmail_connections where user_id=$1",
    [userId],
  );
  if (!connection) throw new Error("Gmail is not connected");
  const expires = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
  if (expires > Date.now() + 60_000) return decryptCredential(connection.access_token_encrypted);
  if (!connection.refresh_token_encrypted) throw new Error("Gmail authorization expired; reconnect Gmail");
  const config = await getGmailOAuthConfig(userId);
  if (!config) throw new Error("Gmail OAuth is not configured");
  const token = await tokenRequest(new URLSearchParams({
    refresh_token: decryptCredential(connection.refresh_token_encrypted),
    client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token",
  }));
  await query(
    "update public.gmail_connections set access_token_encrypted=$2,token_expires_at=now()+($3 || ' seconds')::interval,updated_at=now() where user_id=$1",
    [userId, encryptCredential(token.access_token!), String(token.expires_in ?? 3600)],
  );
  return token.access_token!;
}

async function gmailGet<T>(userId: string, path: string): Promise<T> {
  const token = await getAccessToken(userId);
  const response = await fetch(API + path, {
    headers: { authorization: "Bearer " + token }, cache: "no-store",
  });
  if (!response.ok) throw new Error("Gmail request failed (" + response.status + "): " + (await response.text()).slice(0, 250));
  return response.json() as Promise<T>;
}

type GmailPart = {
  partId?: string; mimeType?: string; filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
};
type GmailMessage = { id: string; internalDate?: string; payload?: GmailPart };

const header = (part: GmailPart | undefined, name: string) =>
  part?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? null;
const flatten = (part: GmailPart | undefined): GmailPart[] =>
  part ? [part, ...(part.parts ?? []).flatMap(flatten)] : [];

const decodeBase64Url = (value: string) =>
  Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function decodeHtmlAttribute(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)));
}

function trustedDisclosureUrl(value: string): URL | null {
  try {
    const nested = decodeHtmlAttribute(value).match(/~(https?:\/\/[^\s]+)$/i)?.[1];
    const url = new URL(nested ?? decodeHtmlAttribute(value));
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (!TRUSTED_DISCLOSURE_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) return null;
    return url;
  } catch {
    return null;
  }
}

async function readLimitedBody(response: Response): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new Error("Disclosure download exceeds the 25 MB import limit");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size);
}

export function extractDisclosureDownloadUrl(html: string): string | null {
  const decoded = html
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;|&#x22;/gi, '"')
    .replace(/&#x3d;/gi, "=")
    .replace(/&#61;/g, "=");
  const hrefs = [...decoded.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
  const rawUrls = [...decoded.matchAll(/https?:\/\/[^\s"'<>]+/gi)].map((match) => match[0]);
  const candidates = [...new Set([...hrefs, ...rawUrls])]
    .map((value) => trustedDisclosureUrl(value))
    .filter((url): url is URL => Boolean(url))
    .filter((url) => !/\.(?:png|jpe?g|gif|svg|css)(?:$|\?)/i.test(url.pathname));
  const ranked = candidates.sort((a, b) => {
    const score = (url: URL) => {
      if (/\.(?:xlsx?|xlsm|csv|tsv|pdf)$/i.test(url.pathname)) return 3;
      if (/^(?:delivery|scdelivery)\.(?:camsonline|kfintech)\.com$/i.test(url.hostname)) return 2;
      if (/portfolio|disclos/i.test(url.pathname)) return 1;
      return 0;
    };
    return score(b) - score(a);
  });
  return ranked[0]?.toString() ?? null;
}

// AMC mail subjects are inconsistent and often omit "portfolio disclosure".
// Search broadly for attached spreadsheets, then apply our strict filename,
// sender, and subject classifier before recording anything.
const SEARCH =
  'has:attachment newer_than:24m {filename:xls filename:xlsx filename:xlsm filename:csv filename:tsv subject:"portfolio disclosure" subject:"monthly portfolio" subject:"monthly disclosure" subject:"portfolio statement" subject:"consolidated account statement" subject:"e-CAS" subject:"CAS statement"}';
const LINK_SEARCH =
  'newer_than:3m {subject:"monthly portfolio" subject:"portfolio disclosure"}';

async function listMessageIds(userId: string, search: string, pages: number) {
  let pageToken: string | undefined;
  const ids: string[] = [];
  for (let page = 0; page < pages; page++) {
    const params = new URLSearchParams({ q: search, maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const result = await gmailGet<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(
      userId, "/messages?" + params.toString(),
    );
    ids.push(...(result.messages ?? []).map((item) => item.id));
    pageToken = result.nextPageToken;
    if (!pageToken) break;
  }
  return ids;
}

export async function scanGmailDisclosures(userId: string) {
  const messageIds = [...new Set([
    ...(await listMessageIds(userId, SEARCH, 3)),
    ...(await listMessageIds(userId, LINK_SEARCH, 2)),
  ])];
  let attachments = 0;
  const linkedAmcs = new Set<string>();
  for (const messageId of messageIds) {
    const message = await gmailGet<GmailMessage>(userId, "/messages/" + encodeURIComponent(messageId) + "?format=full");
    const subject = header(message.payload, "Subject");
    const sender = header(message.payload, "From");
    const receivedAt = message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null;
    for (const part of flatten(message.payload)) {
      const filename = (part.filename ?? "").trim();
      const size = Number(part.body?.size ?? 0);
      if (!filename || !SUPPORTED.test(filename) || size > MAX_BYTES) continue;
      const amc = inferAmc((sender ?? "") + " " + (subject ?? "") + " " + filename, null);
      const documentType = classifyGmailDocument({ filename, subject, sender });
      if (documentType === "unknown") continue;
      await query(
        "insert into public.gmail_disclosure_attachments " +
        "(user_id,message_id,attachment_id,part_id,filename,mime_type,size_bytes,email_subject,sender,received_at,inferred_amc,document_type) " +
        "values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) " +
        "on conflict (user_id,message_id,part_id) do update set attachment_id=excluded.attachment_id,filename=excluded.filename," +
        "mime_type=excluded.mime_type,size_bytes=excluded.size_bytes,email_subject=excluded.email_subject,sender=excluded.sender," +
        "received_at=excluded.received_at,inferred_amc=excluded.inferred_amc,document_type=excluded.document_type,updated_at=now()",
        [userId, message.id, part.body?.attachmentId ?? null, part.partId ?? filename, filename,
          part.mimeType ?? null, size, subject, sender, receivedAt, amc, documentType],
      );
      attachments++;
    }

    const amc = inferAmc((sender ?? "") + " " + (subject ?? ""), null);
    if (!amc || linkedAmcs.has(amc) || !/(?:monthly\s+)?portfolio|portfolio\s+disclosure/i.test(subject ?? "")) continue;
    const body = flatten(message.payload)
      .filter((part) => /^text\/(?:html|plain)$/i.test(part.mimeType ?? "") && part.body?.data)
      .map((part) => decodeBase64Url(part.body!.data!).toString("utf8"))
      .join("\n");
    const sourceUrl = extractDisclosureDownloadUrl(body);
    if (!sourceUrl) continue;
    linkedAmcs.add(amc);
    const month = inferSnapshotMonth({ filename: "", subject, receivedAt });
    const partId = "link:" + createHash("sha256").update(sourceUrl).digest("hex").slice(0, 24);
    const filename = `${amc.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}-${month.slice(0, 7)}-portfolio.download`;
    await query(
      `insert into public.gmail_disclosure_attachments
         (user_id,message_id,part_id,filename,mime_type,size_bytes,email_subject,sender,received_at,inferred_amc,document_type,source_kind,source_url_encrypted)
       values ($1,$2,$3,$4,null,0,$5,$6,$7,$8,'amc_disclosure','link',$9)
       on conflict (user_id,message_id,part_id) do update set filename=excluded.filename,email_subject=excluded.email_subject,
         sender=excluded.sender,received_at=excluded.received_at,inferred_amc=excluded.inferred_amc,
         document_type='amc_disclosure',source_kind='link',source_url_encrypted=excluded.source_url_encrypted,
         status=case when gmail_disclosure_attachments.status='imported' then 'imported' else 'discovered' end,
         error_message=case when gmail_disclosure_attachments.status='imported' then gmail_disclosure_attachments.error_message else null end,
         updated_at=now()`,
      [userId, message.id, partId, filename, subject, sender, receivedAt, amc, encryptCredential(sourceUrl)],
    );
    await query(
      `update public.gmail_disclosure_attachments
          set status='ignored',error_message=null,updated_at=now()
        where user_id=$1 and document_type='amc_disclosure' and inferred_amc=$2
          and message_id<>$3 and source_kind='link' and status<>'imported'`,
      [userId, amc, message.id],
    );
    attachments++;
  }
  await query("update public.gmail_connections set last_scan_at=now(),updated_at=now() where user_id=$1", [userId]);
  const { processPendingGmailAttachments } = await import("@/lib/gmail/processing");
  const processing = await processPendingGmailAttachments(userId);
  return { messages: messageIds.length, attachments, processing };
}

export async function scanAllConnectedGmailDisclosures() {
  const connections = await query<{ user_id: string; gmail_email: string }>(
    "select user_id,gmail_email from public.gmail_connections order by connected_at",
  );
  const results: Array<{
    userId: string;
    email: string;
    messages: number;
    attachments: number;
    processing?: { processed: number; imported: number; review: number; errors: number };
    error?: string;
  }> = [];
  for (const connection of connections) {
    try {
      const result = await scanGmailDisclosures(connection.user_id);
      results.push({
        userId: connection.user_id,
        email: connection.gmail_email,
        ...result,
      });
    } catch (cause) {
      results.push({
        userId: connection.user_id,
        email: connection.gmail_email,
        messages: 0,
        attachments: 0,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
  return {
    connections: connections.length,
    successful: results.filter((item) => !item.error).length,
    failed: results.filter((item) => item.error).length,
    messages: results.reduce((sum, item) => sum + item.messages, 0),
    attachments: results.reduce((sum, item) => sum + item.attachments, 0),
    processed: results.reduce((sum, item) => sum + (item.processing?.processed ?? 0), 0),
    imported: results.reduce((sum, item) => sum + (item.processing?.imported ?? 0), 0),
    review: results.reduce((sum, item) => sum + (item.processing?.review ?? 0), 0),
    results,
  };
}

export async function downloadGmailDisclosureAttachment(userId: string, recordId: string) {
  const record = await queryOne<{
    message_id: string; attachment_id: string | null; part_id: string;
    filename: string; mime_type: string | null; size_bytes: number;
    source_kind: "attachment" | "link"; source_url_encrypted: string | null;
  }>(
    "select message_id,attachment_id,part_id,filename,mime_type,size_bytes,source_kind,source_url_encrypted from public.gmail_disclosure_attachments where id=$1 and user_id=$2 and status <> 'ignored'",
    [recordId, userId],
  );
  if (!record) throw new Error("Gmail disclosure attachment was not found");
  if (record.size_bytes > MAX_BYTES) throw new Error("Attachment exceeds the 25 MB import limit");
  if (record.source_kind === "link") {
    if (!record.source_url_encrypted) throw new Error("Disclosure download link is unavailable");
    const initialUrl = trustedDisclosureUrl(decryptCredential(record.source_url_encrypted));
    if (!initialUrl) throw new Error("Disclosure download link is not trusted");
    let url: URL = initialUrl;
    const visited = new Set<string>();
    for (let step = 0; step < 8; step++) {
      if (visited.has(url.toString())) throw new Error("Disclosure download entered a redirect loop");
      visited.add(url.toString());
      const response = await fetch(url, {
        redirect: "manual",
        cache: "no-store",
        headers: {
          accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,application/pdf,text/html;q=0.8,*/*;q=0.5",
          "accept-language": "en-IN,en;q=0.9",
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36",
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        const nextUrl = location ? trustedDisclosureUrl(new URL(location, url).toString()) : null;
        if (!nextUrl) throw new Error("Disclosure link redirected outside trusted AMC domains");
        url = nextUrl;
        continue;
      }
      if (!response.ok) throw new Error(`Disclosure download failed (${response.status})`);
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (contentLength > MAX_BYTES) throw new Error("Disclosure download exceeds the 25 MB import limit");
      const bytes = await readLimitedBody(response);
      const mimeType = response.headers.get("content-type")?.split(";")[0] ?? null;
      if (/text\/html/i.test(mimeType ?? "")) {
        const nextUrl = extractDisclosureDownloadUrl(bytes.toString("utf8"));
        if (!nextUrl) throw new Error("Disclosure email link opened a web page without a trusted portfolio download");
        url = new URL(nextUrl);
        continue;
      }
      const disposition = response.headers.get("content-disposition") ?? "";
      const dispositionName = disposition.match(/filename\*?=(?:UTF-8''|["']?)([^"';]+)/i)?.[1];
      const pathName = decodeURIComponent(new URL(response.url || url.toString()).pathname.split("/").pop() ?? "");
      const extension = mimeType?.includes("spreadsheetml") ? ".xlsx"
        : mimeType?.includes("ms-excel") ? ".xls"
          : mimeType?.includes("csv") ? ".csv"
            : mimeType?.includes("pdf") ? ".pdf" : "";
      const filename = decodeURIComponent(dispositionName ?? pathName) || record.filename.replace(/\.download$/, extension);
      if (!SUPPORTED.test(filename)) throw new Error("Disclosure link did not return a supported portfolio file");
      return { ...record, filename, mime_type: mimeType, size_bytes: bytes.length, bytes };
    }
    throw new Error("Disclosure download exceeded the redirect limit");
  }
  let data: string | undefined;
  if (record.attachment_id) {
    const body = await gmailGet<{ data?: string }>(
      userId, "/messages/" + encodeURIComponent(record.message_id) + "/attachments/" + encodeURIComponent(record.attachment_id),
    );
    data = body.data;
  } else {
    const message = await gmailGet<GmailMessage>(userId, "/messages/" + encodeURIComponent(record.message_id) + "?format=full");
    data = flatten(message.payload).find((part) => part.partId === record.part_id)?.body?.data;
  }
  if (!data) throw new Error("Gmail returned an empty attachment");
  return { ...record, bytes: decodeBase64Url(data) };
}

export async function getGmailDisclosureData(userId: string): Promise<GmailDisclosureData> {
  const [connection, rows, oauthConfig] = await Promise.all([
    queryOne<ConnectionRow>(
      "select gmail_email,access_token_encrypted,refresh_token_encrypted,token_expires_at,scope,last_scan_at,cas_pdf_password_encrypted,auto_import_enabled from public.gmail_connections where user_id=$1",
      [userId],
    ),
    query<{
      id: string; filename: string; mime_type: string | null; size_bytes: number;
      email_subject: string | null; sender: string | null; received_at: Date | string | null;
      inferred_amc: string | null; document_type: GmailDisclosureAttachment["documentType"]; status: GmailDisclosureAttachment["status"];
      matched_holding_id: string | null; snapshot_month: Date | string | null; error_message: string | null;
    }>(
      "select id,filename,mime_type,size_bytes,email_subject,sender,received_at,inferred_amc,document_type,status,matched_holding_id,snapshot_month,error_message " +
      `from public.gmail_disclosure_attachments a where user_id=$1
         and (document_type <> 'nsdl_cas' or id=(
           select newest.id from public.gmail_disclosure_attachments newest
            where newest.user_id=$1 and newest.document_type='nsdl_cas'
            order by newest.received_at desc nulls last,newest.discovered_at desc,newest.id desc
            limit 1
         ))
       order by received_at desc nulls last,discovered_at desc limit 100`,
      [userId],
    ),
    getGmailOAuthConfig(userId),
  ]);
  return {
    connection: {
      connected: Boolean(connection), configured: Boolean(oauthConfig),
      email: connection?.gmail_email ?? null, lastScanAt: iso(connection?.last_scan_at ?? null),
      casPasswordSet: Boolean(connection?.cas_pdf_password_encrypted),
      autoImportEnabled: connection?.auto_import_enabled ?? true,
    },
    attachments: rows.map((row) => ({
      id: row.id, filename: row.filename, mimeType: row.mime_type, sizeBytes: Number(row.size_bytes),
      subject: row.email_subject, sender: row.sender, receivedAt: iso(row.received_at),
      inferredAmc: row.inferred_amc, status: row.status, matchedHoldingId: row.matched_holding_id,
      documentType: row.document_type,
      snapshotMonth: iso(row.snapshot_month), errorMessage: row.error_message,
    })),
  };
}
