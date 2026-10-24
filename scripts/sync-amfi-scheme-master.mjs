import { existsSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import {
  parseAmfiSchemeMaster,
  resolveSchemeFamilies,
} from "../lib/funds/amfiSchemeMaster.mjs";

const root = process.cwd();
const envFile = resolve(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://localhost:5432/investogenie";
const SOURCE_URLS = [
  process.env.AMFI_SCHEME_MASTER_URL,
  "https://www.amfiindia.com/spages/NAVAll.txt",
  "https://portal.amfiindia.com/spages/NAVAll.txt",
].filter(Boolean);
const USER_AGENT = process.env.AMFI_USER_AGENT ?? "InvestoGenie/1.0 (local scheme-master sync)";
const ACTIVE_NAV_AGE_DAYS = Number(process.env.AMFI_ACTIVE_NAV_AGE_DAYS ?? 45);
const BATCH_SIZE = 750;

const isLocal = /127\.0\.0\.1|localhost/.test(DATABASE_URL);
const client = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

async function fetchMaster() {
  let lastError = null;
  for (const url of SOURCE_URLS) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/plain,*/*" },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (!text.includes("Scheme Code;") || text.length < 100_000) {
        throw new Error("response did not look like the AMFI NAV master");
      }
      return { text, url };
    } catch (error) {
      lastError = error;
      console.warn(`[amfi-master] ${url} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw lastError ?? new Error("No AMFI scheme-master URL was available");
}

function activeCutoff(records) {
  const newest = records.reduce((max, row) => row.navDate > max ? row.navDate : max, "1970-01-01");
  const date = new Date(`${newest}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ACTIVE_NAV_AGE_DAYS);
  return date.toISOString().slice(0, 10);
}

function databaseRows(records, sourceUrl) {
  const cutoff = activeCutoff(records);
  return records.map((row) => ({
    amfi_code: row.amfiCode,
    scheme_name: row.schemeName,
    amc: row.amc,
    scheme_category: row.schemeCategory,
    portfolio_key: row.portfolioKey,
    isin_payout_or_growth: row.isinPayoutOrGrowth,
    isin_reinvestment: row.isinReinvestment,
    plan_type: row.planType,
    option_type: row.optionType,
    nav: row.nav,
    nav_date: row.navDate,
    is_active: row.navDate >= cutoff,
    source_url: sourceUrl,
  }));
}

async function upsertMaster(rows) {
  await client.query("update public.amfi_scheme_master set is_active = false where source = 'AMFI_NAV'");
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE);
    await client.query(
      `insert into public.amfi_scheme_master (
         amfi_code, scheme_name, amc, scheme_category, portfolio_key,
         isin_payout_or_growth, isin_reinvestment, plan_type, option_type,
         nav, nav_date, is_active, source, source_url, last_seen_at, synced_at
       )
       select x.amfi_code, x.scheme_name, x.amc, x.scheme_category, x.portfolio_key,
              x.isin_payout_or_growth, x.isin_reinvestment, x.plan_type, x.option_type,
              x.nav, x.nav_date, x.is_active, 'AMFI_NAV', x.source_url, now(), now()
         from jsonb_to_recordset($1::jsonb) as x(
           amfi_code text, scheme_name text, amc text, scheme_category text,
           portfolio_key text, isin_payout_or_growth text, isin_reinvestment text,
           plan_type text, option_type text, nav numeric, nav_date date,
           is_active boolean, source_url text
         )
       on conflict (amfi_code) do update set
         scheme_name = excluded.scheme_name,
         amc = excluded.amc,
         scheme_category = excluded.scheme_category,
         portfolio_key = excluded.portfolio_key,
         isin_payout_or_growth = excluded.isin_payout_or_growth,
         isin_reinvestment = excluded.isin_reinvestment,
         plan_type = excluded.plan_type,
         option_type = excluded.option_type,
         nav = excluded.nav,
         nav_date = excluded.nav_date,
         is_active = excluded.is_active,
         source_url = excluded.source_url,
         last_seen_at = now(),
         synced_at = now()`,
      [JSON.stringify(batch)],
    );
  }
}

async function loadSnapshotSchemes() {
  const result = await client.query(
    `select fs.scheme_code "schemeCode", fs.name, fs.isin, fs.amc
       from public.fund_schemes fs
      where exists (
        select 1 from public.fund_holdings_snapshot fhs
         where fhs.scheme_code = fs.scheme_code
      )
      order by fs.scheme_code`,
  );
  return result.rows;
}

async function upsertIdentifier({ type, value, schemeCode, row }) {
  const result = await client.query(
    `insert into public.fund_scheme_identifiers (
       identifier_type, identifier_value, scheme_code, amfi_code,
       plan_type, option_type, source, is_active, last_seen_at
     )
     values ($1, $2, $3, $4, $5, $6, 'AMFI_NAV', $7, now())
     on conflict (identifier_type, identifier_value) do update set
       amfi_code = excluded.amfi_code,
       plan_type = excluded.plan_type,
       option_type = excluded.option_type,
       is_active = excluded.is_active,
       last_seen_at = now(),
       source = case
         when public.fund_scheme_identifiers.source = 'FUND_SCHEME'
           then public.fund_scheme_identifiers.source
         else excluded.source
       end
     where public.fund_scheme_identifiers.scheme_code = excluded.scheme_code
     returning identifier_value`,
    [type, value, schemeCode, row.amfiCode, row.planType, row.optionType, row.isActive],
  );
  return result.rowCount === 1;
}

async function bridgeSnapshotIdentifiers(records, schemes) {
  const resolved = resolveSchemeFamilies(records, schemes);
  await client.query(
    "update public.fund_scheme_identifiers set is_active = false where source = 'AMFI_NAV'",
  );
  let identifiersUpserted = 0;
  let conflicts = 0;
  for (const [schemeCode, match] of resolved) {
    for (const row of match.records) {
      const identifiers = [
        ["AMFI_CODE", row.amfiCode],
        ["ISIN", row.isinPayoutOrGrowth],
        ["ISIN", row.isinReinvestment],
      ].filter(([, value]) => Boolean(value));
      for (const [type, value] of identifiers) {
        const ok = await upsertIdentifier({ type, value, schemeCode, row });
        if (ok) identifiersUpserted += 1;
        else conflicts += 1;
      }
    }
  }
  return {
    snapshotSchemes: schemes.length,
    schemesResolved: resolved.size,
    identifiersUpserted,
    conflicts,
    matches: [...resolved].map(([schemeCode, match]) => ({
      schemeCode,
      method: match.method,
      variants: match.records.length,
    })),
  };
}

/**
 * Price held mutual funds from the AMFI master. A fund is priced only by its holding's OWN
 * ISIN (from the CAS row, or the fund's metadata when that holds an ISIN). A Fund Mapping link
 * is deliberately not used: it identifies the portfolio disclosure, which is plan-agnostic, and
 * may point at a different plan (Regular vs Direct) with a different NAV. Never moves a quote
 * backwards in time.
 */
async function refreshHeldFundNavs() {
  const result = await client.query(
    `with held as (
       select distinct a.id asset_id,
              upper(coalesce(nullif(chd.isin,''),
                             case when mfm.amfi_code_in ~* '^IN[A-Z0-9]{10}$' then mfm.amfi_code_in end)) isin
         from public.holdings h
         join public.assets a on a.id=h.asset_id and a.asset_class='MUTUAL_FUND'
         left join public.cas_holding_details chd on chd.holding_id=h.id and chd.user_id=h.user_id
         left join public.mutual_fund_meta mfm on mfm.asset_id=a.id
        where h.quantity > 0
     ), nav as (
       select distinct on (held.asset_id) held.asset_id, s.nav, s.nav_date
         from held
         join public.amfi_scheme_master s
           on held.isin is not null
          and (upper(s.isin_payout_or_growth)=held.isin or upper(s.isin_reinvestment)=held.isin)
        where s.nav > 0
        order by held.asset_id, s.nav_date desc
     ), written as (
       insert into public.latest_quotes (asset_id,price,change_pct,currency,as_of,source,updated_at)
       select asset_id,nav,null,'INR',nav_date,'AMFI_NAV',now() from nav
       on conflict (asset_id) do update set
         price=excluded.price,
         -- 1D change only against the previous AMFI NAV within 5 days. Against an older CAS
         -- statement NAV it would show weeks of movement as one day's change.
         change_pct=case
           when latest_quotes.as_of::date = excluded.as_of::date then latest_quotes.change_pct
           when latest_quotes.source='AMFI_NAV' and latest_quotes.price > 0
                and excluded.as_of::date - latest_quotes.as_of::date between 1 and 5
             then round(((excluded.price/latest_quotes.price)-1)*100, 4)
         end,
         as_of=excluded.as_of, source='AMFI_NAV', updated_at=now()
       where latest_quotes.as_of is null or latest_quotes.as_of::date <= excluded.as_of::date
       returning asset_id
     )
     select (select count(*) from held)::int held,
            (select count(*) from held where isin is null)::int without_isin,
            (select count(*) from written)::int priced`,
  );
  return result.rows[0];
}

async function logRun(status, detail, error, startedAt) {
  try {
    await client.query(
      `insert into public.cron_logs (job, status, detail, error, duration_ms)
       values ('amfi-scheme-master', $1, $2::jsonb, $3, $4)`,
      [status, JSON.stringify(detail ?? {}), error ?? null, Date.now() - startedAt],
    );
  } catch (logError) {
    console.warn(`[amfi-master] could not write cron log: ${logError instanceof Error ? logError.message : String(logError)}`);
  }
}

async function main() {
  const startedAt = Date.now();
  await client.connect();
  try {
    const tableCheck = await client.query(
      "select to_regclass('public.amfi_scheme_master') master, to_regclass('public.fund_scheme_identifiers') identifiers",
    );
    if (!tableCheck.rows[0]?.master || !tableCheck.rows[0]?.identifiers) {
      throw new Error("Migration 0023_amfi_scheme_master.sql has not been applied");
    }

    const { text, url } = await fetchMaster();
    const parsed = parseAmfiSchemeMaster(text);
    if (parsed.length < 1_000) throw new Error(`AMFI parser returned only ${parsed.length} rows`);
    const rows = databaseRows(parsed, url);
    const records = parsed.map((row, index) => ({ ...row, isActive: rows[index].is_active }));

    await client.query("begin");
    await upsertMaster(rows);
    const schemes = await loadSnapshotSchemes();
    const bridge = await bridgeSnapshotIdentifiers(records, schemes);
    const heldNavs = await refreshHeldFundNavs();
    await client.query("commit");

    const result = {
      source: url,
      parsed: rows.length,
      active: rows.filter((row) => row.is_active).length,
      heldFunds: heldNavs.held,
      heldFundsPriced: heldNavs.priced,
      heldFundsWithoutIsin: heldNavs.without_isin,
      ...bridge,
    };
    await logRun("ok", result, null, startedAt);
    console.log(`[amfi-master] ${JSON.stringify(result)}`);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    await logRun("error", {}, message, startedAt);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`[amfi-master] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
