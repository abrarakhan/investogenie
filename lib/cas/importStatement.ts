import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PoolClient } from "pg";
import { normalizeFolio, parseCasHoldings, type ParsedHoldingRow } from "@/lib/cas/parse";
import { queryOne, tx } from "@/lib/db";

const execFileAsync = promisify(execFile);

export type CasImportErrorCode = "encrypted" | "bad_password" | "parser_missing" | "no_text" | "crypto_missing" | "empty";

export class CasImportError extends Error {
  constructor(readonly code: CasImportErrorCode, message: string) {
    super(message);
    this.name = "CasImportError";
  }
}

const AMC_HEADER_ONLY = /^(?:aditya\s+birla\s+sun\s+life|canara\s+robeco|dsp|franklin\s+templeton|hdfc|icici\s+prudential|motilal\s+oswal|nippon\s+india|sbi)\s+mutual\s+fund$/i;
const CAS_NOISE = /(?:scheme\s+name\s+(?:of|changed)|fundamental\s+attributes|load\s+structure|entry\s+load|exit\s+load|please\s+refer|sai\s*\/\s*sid|addendum|trxn\.ref\.no|purchase\s+trxn|available\s+on\s+www|for\s+further\s+details|w\.e\.f\.?|with\s+effect\s+from|registration\s*\/\s*enrolment|investor\s+service\s+centre|\bgst\b)/i;

function isNoise(row: ParsedHoldingRow) {
  if (row.isin) return false;
  const name = row.name.replace(/\s+/g, " ").trim();
  return CAS_NOISE.test(name) || (row.assetClass === "MUTUAL_FUND" && AMC_HEADER_ONLY.test(name));
}

function tickerFor(row: ParsedHoldingRow) {
  if (row.isin && /^[A-Z]{2}[A-Z0-9]{10}$/i.test(row.isin)) {
    if (row.assetClass === "MUTUAL_FUND") {
      const folio = normalizeFolio(row.folio)?.replace(/[^A-Z0-9]/gi, "").slice(0, 20);
      return `${row.isin.toUpperCase()}${folio ? `_${folio}` : ""}`.slice(0, 54);
    }
    return row.isin.toUpperCase();
  }
  const prefix = row.assetClass === "MUTUAL_FUND" ? "MF" : "EQ";
  return `${prefix}_${row.name}`.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 54);
}

async function extractText(bytes: Buffer, filename: string, password: string) {
  const lower = filename.toLowerCase();
  if (!lower.endsWith(".pdf") && !bytes.subarray(0, 4).equals(Buffer.from("%PDF"))) return bytes.toString("utf8");
  const dir = join(tmpdir(), "investogenie-cas");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${randomUUID()}.pdf`);
  await writeFile(path, bytes);
  try {
    const python = process.env.CAS_PDF_PYTHON ?? process.env.PYTHON_BIN ?? "python3";
    const args = [join(process.cwd(), "scripts/extract-cas-pdf.py"), path];
    if (password) args.push("--password", password);
    const { stdout } = await execFileAsync(python, args, { maxBuffer: 20 * 1024 * 1024 });
    return stdout;
  } catch (cause) {
    const stderr = typeof cause === "object" && cause && "stderr" in cause ? String(cause.stderr) : "";
    if (stderr.includes("password required")) throw new CasImportError("encrypted", "CAS PDF password is required");
    if (stderr.includes("did not unlock")) throw new CasImportError("bad_password", "Saved CAS PDF password did not unlock the statement");
    if (stderr.includes("No module named")) throw new CasImportError("parser_missing", "CAS PDF parser dependency is unavailable");
    if (/cryptography|crypto/i.test(stderr)) throw new CasImportError("crypto_missing", "Encrypted PDF support is unavailable");
    if (stderr.includes("No text could be extracted")) throw new CasImportError("no_text", "No text could be extracted from the CAS PDF");
    throw cause;
  } finally {
    await unlink(path).catch(() => {});
  }
}

async function upsertAsset(c: PoolClient, row: ParsedHoldingRow) {
  const ticker = tickerFor(row);
  const exchange = row.assetClass === "MUTUAL_FUND" ? "CAS_MF" : "CAS_STOCK";
  const asset = (await c.query<{ id: string }>(
    `insert into public.assets (ticker,name,asset_class,exchange,country,currency)
     values ($1,$2,$3::asset_class,$4,'IN','INR')
     on conflict (exchange,ticker) do update set name=excluded.name,is_active=true returning id`,
    [ticker, row.name, row.assetClass, exchange],
  )).rows[0];
  if (!asset) throw new Error(`Could not create CAS asset for ${row.name}`);
  if (row.assetClass === "MUTUAL_FUND") {
    await c.query(
      `insert into public.mutual_fund_meta (asset_id,amfi_code_in,category,plan_type)
       values ($1,$2,'CAS Import',$3)
       on conflict (asset_id) do update set amfi_code_in=excluded.amfi_code_in,category=excluded.category,plan_type=excluded.plan_type`,
      [asset.id, row.isin, /regular/i.test(row.name) ? "REGULAR" : "DIRECT"],
    );
  }
  return asset.id;
}

/** Add/update holdings from a consolidated statement. Background imports do
 * not delete absent holdings because an emailed statement may be partial. */
export async function importCasStatementBytes(input: { userId: string; bytes: Buffer; filename: string; password?: string }) {
  const text = (await extractText(input.bytes, input.filename, input.password ?? "")).trim();
  if (!text) throw new CasImportError("empty", "CAS statement is empty");
  const rows = parseCasHoldings(text).filter((row) => !isNoise(row));
  if (!rows.length) throw new CasImportError("empty", "No holdings were detected in the CAS statement");
  let portfolio = await queryOne<{ id: string }>("select id from public.portfolios where user_id=$1 order by created_at limit 1", [input.userId]);
  if (!portfolio) portfolio = await queryOne<{ id: string }>("insert into public.portfolios (user_id,name) values ($1,'My Portfolio') returning id", [input.userId]);
  if (!portfolio) throw new Error("Could not create the user's portfolio");

  await tx(async (c) => {
    for (const row of rows) {
      const assetId = await upsertAsset(c, row);
      const currentPrice = row.price && row.price > 0 ? row.price : row.value / row.quantity;
      const costPerUnit = row.costValue && row.costValue > 0 ? row.costValue / row.quantity : currentPrice;
      const holding = (await c.query<{ id: string }>(
        `insert into public.holdings (user_id,portfolio_id,asset_id,quantity,avg_cost)
         values ($1,$2,$3,$4,$5)
         on conflict (portfolio_id,asset_id) do update set quantity=excluded.quantity,avg_cost=excluded.avg_cost,updated_at=now()
         returning id`, [input.userId, portfolio.id, assetId, row.quantity, costPerUnit],
      )).rows[0];
      await c.query(
        `insert into public.latest_quotes (asset_id,price,change_pct,currency,as_of,source)
         values ($1,$2,null,'INR',now(),'CAS')
         on conflict (asset_id) do update set price=excluded.price,currency='INR',as_of=excluded.as_of,source='CAS',updated_at=now()`, [assetId, currentPrice],
      );
      if (row.assetClass === "MUTUAL_FUND" && holding) {
        await c.query(
          `insert into public.cas_holding_details
             (holding_id,user_id,asset_id,isin,folio_number,holder_name,cost_value,market_value,as_of_date,source_file)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           on conflict (holding_id) do update set isin=excluded.isin,folio_number=excluded.folio_number,
             holder_name=excluded.holder_name,cost_value=excluded.cost_value,market_value=excluded.market_value,
             as_of_date=excluded.as_of_date,source_file=excluded.source_file,imported_at=now()`,
          [holding.id, input.userId, assetId, row.isin, normalizeFolio(row.folio), row.holderName ?? null,
            row.costValue ?? null, row.value, row.asOfDate ?? null, input.filename],
        );
        console.log(`[CAS] Parsed: ${row.name} (${row.isin ?? "no ISIN"}) folio ${normalizeFolio(row.folio) ?? "-"} — ${row.quantity.toFixed(3)} units`);
      }
    }
  });
  return { rows: rows.length, funds: rows.filter((row) => row.assetClass === "MUTUAL_FUND").length, stocks: rows.filter((row) => row.assetClass === "STOCK").length };
}
