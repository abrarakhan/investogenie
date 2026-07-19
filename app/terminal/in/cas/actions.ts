"use server";

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ensureScaffold } from "@/app/dashboard/actions";
import { getSessionUser } from "@/lib/auth";
import { query, queryOne, tx } from "@/lib/db";
import {
  AmcDisclosureProvider,
  parseDisclosureSource,
  SnapshotRejectedError,
  type ParsedDisclosureRow,
} from "@/lib/funds/amcProvider";

const execFileAsync = promisify(execFile);

type ImportedAssetClass = "MUTUAL_FUND" | "STOCK";

interface ParsedHoldingRow {
  name: string;
  folio: string | null;
  isin: string | null;
  quantity: number;
  price: number | null;
  value: number;
  assetClass: ImportedAssetClass;
}

const money = (value: string | undefined | null) => {
  if (!value) return NaN;
  const cleaned = value.replace(/[₹,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  return Number(cleaned);
};

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if ((ch === "," || ch === "\t") && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function looksLikeHeader(cells: string[]) {
  const joined = cells.map(normalizeHeader).join(" ");
  const hasQuantity = joined.includes("unit") || joined.includes("quantity") || joined.includes("balance");
  const hasValue = joined.includes("market") || joined.includes("current") || joined.includes("value") || joined.includes("valuation");
  const hasName = joined.includes("scheme") || joined.includes("security") || joined.includes("company") || joined.includes("description") || joined.includes("scrip");
  return hasName && hasQuantity && hasValue;
}

function getCell(row: Record<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    const value = row[name];
    if (value) return value;
  }
  return undefined;
}

function inferAssetClass(name: string, row: Record<string, string> = {}): ImportedAssetClass {
  const haystack = `${name} ${Object.values(row).join(" ")}`;
  if (/scheme|fund|growth|idcw|direct|regular|nav/i.test(haystack)) return "MUTUAL_FUND";
  return "STOCK";
}

function parseStructured(text: string): ParsedHoldingRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const headerIndex = lines.findIndex((line) => looksLikeHeader(splitCsvLine(line)));
  if (headerIndex === -1) return [];
  const headers = splitCsvLine(lines[headerIndex]).map(normalizeHeader);
  const rows: ParsedHoldingRow[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const cells = splitCsvLine(line);
    if (cells.length < 3) continue;
    const mapped: Record<string, string> = {};
    headers.forEach((header, index) => { mapped[header] = cells[index] ?? ""; });
    const name = getCell(mapped, [
      "scheme_name", "scheme", "fund_name", "mutual_fund", "security_name", "security", "company_name", "company", "scrip_name", "description", "name",
    ]);
    const quantity = money(getCell(mapped, ["units", "unit_balance", "closing_units", "balance_units", "quantity", "qty", "balance"]));
    const price = money(getCell(mapped, ["nav", "closing_nav", "current_nav", "price", "market_price", "rate", "closing_price"]));
    const value = money(getCell(mapped, ["market_value", "current_value", "valuation", "amount", "value", "holding_value"]));
    if (!name || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(value) || value <= 0) continue;
    const isin = getCell(mapped, ["isin", "isin_code"]) ?? null;
    rows.push({
      name,
      folio: getCell(mapped, ["folio", "folio_no", "folio_number"]) ?? null,
      isin,
      quantity,
      price: Number.isFinite(price) && price > 0 ? price : null,
      value,
      assetClass: inferAssetClass(name, mapped),
    });
  }
  return rows;
}

function parseLooseText(text: string): ParsedHoldingRow[] {
  const rows: ParsedHoldingRow[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let currentName: string | null = null;
  let folio: string | null = null;
  let isin: string | null = null;

  for (const line of lines) {
    const folioMatch = line.match(/folio\s*(?:no\.?|number)?\s*[:\-]?\s*([A-Z0-9\/\-]+)/i);
    if (folioMatch) folio = folioMatch[1];
    const isinMatch = line.match(/\b(IN[A-Z0-9]{10})\b/i);
    if (isinMatch) isin = isinMatch[1].toUpperCase();

    const isNameLine = /fund|scheme|regular|direct|growth|idcw|equity|limited|ltd\.?|bank|industries|finance|technolog/i.test(line)
      && !/folio|total|market value|current value|nav|units|quantity|isin/i.test(line)
      && line.length > 5;
    if (isNameLine) currentName = line.replace(/^(scheme|security|company)\s*name\s*[:\-]?\s*/i, "").trim();

    const unitsMatch = line.match(/(?:units?|quantity|qty|balance)\s*[:\-]?\s*([0-9,.]+)/i);
    const priceMatch = line.match(/(?:nav|price|rate)\s*[:\-]?\s*₹?\s*([0-9,.]+)/i);
    const valueMatch = line.match(/(?:market\s*value|current\s*value|valuation|holding\s*value|value)\s*[:\-]?\s*₹?\s*([0-9,.]+)/i);

    if (currentName && unitsMatch && valueMatch) {
      const quantity = money(unitsMatch[1]);
      const price = priceMatch ? money(priceMatch[1]) : NaN;
      const value = money(valueMatch[1]);
      if (Number.isFinite(quantity) && quantity > 0 && Number.isFinite(value) && value > 0) {
        rows.push({
          name: currentName,
          folio,
          isin,
          quantity,
          price: Number.isFinite(price) && price > 0 ? price : null,
          value,
          assetClass: inferAssetClass(currentName),
        });
        currentName = null;
        isin = null;
      }
    }
  }
  return rows;
}


function compactCasLines(text: string): string[] {
  const raw = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const rows: string[] = [];
  let current = "";
  for (const line of raw) {
    const startsRecord = /\bIN[A-Z0-9]{10}\b/i.test(line)
      || /scheme|fund|regular|direct|growth|idcw|limited|ltd\.?|bank|industries|finance|technolog/i.test(line);
    const hasNumericTail = (line.match(/(?:₹\s*)?[0-9][0-9,.]*(?:\.\d+)?/g) ?? []).length >= 2;
    if (current && startsRecord && hasNumericTail) {
      rows.push(current);
      current = line;
    } else if (!current) {
      current = line;
    } else if (startsRecord || hasNumericTail || /folio|isin|nav|unit|quantity|market value|current value/i.test(line)) {
      current = `${current} ${line}`;
    }
    if (current && (current.match(/(?:₹\s*)?[0-9][0-9,.]*(?:\.\d+)?/g) ?? []).length >= 4 && /\bIN[A-Z0-9]{10}\b/i.test(current)) {
      rows.push(current);
      current = "";
    }
  }
  if (current) rows.push(current);
  return rows;
}

function parseNumericTokens(line: string): number[] {
  return (line.match(/(?:₹\s*)?[0-9][0-9,.]*(?:\.\d+)?/g) ?? [])
    .map((token) => money(token))
    .filter((n) => Number.isFinite(n) && n >= 0);
}

function parseIsinRows(text: string): ParsedHoldingRow[] {
  const rows: ParsedHoldingRow[] = [];
  for (const line of compactCasLines(text)) {
    const isinMatch = line.match(/\b(IN[A-Z0-9]{10})\b/i);
    if (!isinMatch) continue;
    const isin = isinMatch[1].toUpperCase();
    const afterIsin = line.slice(line.indexOf(isinMatch[0]) + isinMatch[0].length).trim();
    const numbers = parseNumericTokens(afterIsin);
    if (numbers.length < 2) continue;
    const firstNumber = afterIsin.search(/(?:₹\s*)?[0-9][0-9,.]*(?:\.\d+)?/);
    const rawName = (firstNumber >= 0 ? afterIsin.slice(0, firstNumber) : afterIsin)
      .replace(/\b(equity|debt|mutual fund|demat|current|balance|free|pledge|locked|value)\b/ig, " ")
      .replace(/\s+/g, " ")
      .trim();
    const name = rawName.length >= 3 ? rawName : `CAS Holding ${isin}`;
    const quantity = numbers.find((n) => n > 0) ?? 0;
    const value = [...numbers].reverse().find((n) => n > 0) ?? 0;
    if (quantity <= 0 || value <= 0 || value === quantity) continue;
    const maybePrice = numbers.length >= 3 ? numbers[numbers.length - 2] : value / quantity;
    rows.push({
      name,
      folio: null,
      isin,
      quantity,
      price: maybePrice > 0 && maybePrice !== value ? maybePrice : value / quantity,
      value,
      assetClass: inferAssetClass(name),
    });
  }
  return rows;
}

function parseNumericTailRows(text: string): ParsedHoldingRow[] {
  const rows: ParsedHoldingRow[] = [];
  for (const line of compactCasLines(text)) {
    if (/\bIN[A-Z0-9]{10}\b/i.test(line)) continue;
    if (!/scheme|fund|regular|direct|growth|idcw|limited|ltd\.?|bank|industries|finance|technolog/i.test(line)) continue;
    const numbers = parseNumericTokens(line);
    if (numbers.length < 2) continue;
    const firstNumber = line.search(/(?:₹\s*)?[0-9][0-9,.]*(?:\.\d+)?/);
    if (firstNumber < 4) continue;
    const name = line.slice(0, firstNumber)
      .replace(/^(scheme|security|company|scrip)\s*name\s*[:\-]?\s*/i, "")
      .replace(/\bfolio\b.*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (name.length < 4) continue;
    const quantity = numbers.find((n) => n > 0) ?? 0;
    const value = [...numbers].reverse().find((n) => n > 0) ?? 0;
    if (quantity <= 0 || value <= 0 || value === quantity) continue;
    const maybePrice = numbers.length >= 3 ? numbers[numbers.length - 2] : value / quantity;
    rows.push({
      name,
      folio: line.match(/folio\s*(?:no\.?|number)?\s*[:\-]?\s*([A-Z0-9\/\-]+)/i)?.[1] ?? null,
      isin: null,
      quantity,
      price: maybePrice > 0 && maybePrice !== value ? maybePrice : value / quantity,
      value,
      assetClass: inferAssetClass(name),
    });
  }
  return rows;
}

function tickerFromRow(row: ParsedHoldingRow): string {
  if (row.isin && /^[A-Z]{2}[A-Z0-9]{10}$/i.test(row.isin)) return row.isin.toUpperCase();
  const prefix = row.assetClass === "MUTUAL_FUND" ? "MF" : "EQ";
  return `${prefix}_${row.name}`
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 54) || `CAS_${prefix}_${Date.now()}`;
}

async function upsertCasAsset(row: ParsedHoldingRow): Promise<string> {
  const ticker = tickerFromRow(row);
  const exchange = row.assetClass === "MUTUAL_FUND" ? "CAS_MF" : "CAS_STOCK";
  const asset = await queryOne<{ id: string }>(
    `insert into public.assets (ticker, name, asset_class, exchange, country, currency)
     values ($1, $2, $3::asset_class, $4, 'IN', 'INR')
     on conflict (exchange, ticker) do update set name = excluded.name, is_active = true
     returning id`,
    [ticker, row.name, row.assetClass, exchange],
  );
  if (!asset) throw new Error(`Could not create CAS asset for ${row.name}`);
  if (row.assetClass === "MUTUAL_FUND") {
    await query(
      `insert into public.mutual_fund_meta (asset_id, amfi_code_in, category, plan_type)
       values ($1, $2, 'CAS Import', $3)
       on conflict (asset_id) do update set category = excluded.category, plan_type = excluded.plan_type`,
      [asset.id, row.isin, /regular/i.test(row.name) ? "REGULAR" : "DIRECT"],
    );
  }
  return asset.id;
}

async function extractPdfText(file: File, password: string): Promise<string | "encrypted" | "bad_password" | "parser_missing" | "no_text" | "crypto_missing"> {
  const dir = join(tmpdir(), "investogenie-cas");
  await mkdir(dir, { recursive: true });
  const pdfPath = join(dir, `${randomUUID()}.pdf`);
  await writeFile(pdfPath, Buffer.from(await file.arrayBuffer()));
  try {
    const python = process.env.CAS_PDF_PYTHON ?? process.env.PYTHON_BIN ?? "python3";
    const script = join(process.cwd(), "scripts/extract-cas-pdf.py");
    const args = [script, pdfPath];
    if (password) args.push("--password", password);
    const { stdout } = await execFileAsync(python, args, { maxBuffer: 20 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const stderr = typeof error === "object" && error && "stderr" in error ? String(error.stderr) : "";
    if (stderr.includes("password required")) return "encrypted";
    if (stderr.includes("did not unlock")) return "bad_password";
    if (stderr.includes("No module named")) return "parser_missing";
    if (stderr.toLowerCase().includes("cryptography") || stderr.toLowerCase().includes("crypto")) return "crypto_missing";
    if (stderr.includes("No text could be extracted")) return "no_text";
    throw error;
  } finally {
    await unlink(pdfPath).catch(() => {});
  }
}

async function fileToText(file: File, password: string): Promise<string | "encrypted" | "bad_password" | "parser_missing" | "no_text" | "crypto_missing"> {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  if (name.endsWith(".pdf") || type === "application/pdf") return extractPdfText(file, password);
  const text = await file.text();
  if (text.startsWith("%PDF")) return extractPdfText(file, password);
  return text;
}

export async function importCasStatement(formData: FormData): Promise<void> {
  try {
  const file = formData.get("casFile");
  if (!(file instanceof File) || file.size === 0) redirect("/terminal/in/cas?status=missing");
  const password = String(formData.get("pdfPassword") ?? "");
  const extracted = await fileToText(file, password);
  if (extracted === "encrypted") redirect("/terminal/in/cas?status=encrypted");
  if (extracted === "bad_password") redirect("/terminal/in/cas?status=bad_password");
  if (extracted === "parser_missing") redirect("/terminal/in/cas?status=parser_missing");
  if (extracted === "crypto_missing") redirect("/terminal/in/cas?status=crypto_missing");
  if (extracted === "no_text") redirect("/terminal/in/cas?status=no_text");
  const text = extracted.trim();
  if (!text) redirect("/terminal/in/cas?status=empty");

  const parsed = parseStructured(text).concat(parseLooseText(text), parseIsinRows(text), parseNumericTailRows(text));
  const byKey = new Map<string, ParsedHoldingRow>();
  for (const row of parsed) byKey.set(`${row.assetClass}:${row.isin ?? row.name}:${row.folio ?? ""}`, row);
  const rows = [...byKey.values()];
  if (rows.length === 0) redirect("/terminal/in/cas?status=empty");

  const scaffold = await ensureScaffold();
  if (!scaffold) redirect("/login");

  await tx(async (c) => {
    for (const row of rows) {
      const assetId = await upsertCasAsset(row);
      const price = row.price && row.price > 0 ? row.price : row.value / row.quantity;
      await c.query(
        `insert into public.holdings (user_id, portfolio_id, asset_id, quantity, avg_cost)
         values ($1, $2, $3, $4, $5)
         on conflict (portfolio_id, asset_id) do update set
           quantity = excluded.quantity,
           avg_cost = excluded.avg_cost,
           updated_at = now()`,
        [scaffold.userId, scaffold.portfolioId, assetId, row.quantity, price],
      );
      await c.query(
        `insert into public.latest_quotes (asset_id, price, change_pct, currency, as_of, source)
         values ($1, $2, null, 'INR', now(), 'CAS')
         on conflict (asset_id) do update set
           price = excluded.price,
           currency = excluded.currency,
           as_of = excluded.as_of,
           source = excluded.source,
           updated_at = now()`,
        [assetId, price],
      );
    }
  });

  const funds = rows.filter((r) => r.assetClass === "MUTUAL_FUND").length;
  const stocks = rows.filter((r) => r.assetClass === "STOCK").length;
  revalidatePath("/terminal/in");
  redirect(`/terminal/in/cas?status=imported&count=${rows.length}&funds=${funds}&stocks=${stocks}`);
  } catch (error) {
    const digest = typeof error === "object" && error && "digest" in error ? String(error.digest) : "";
    if (digest.startsWith("NEXT_REDIRECT")) throw error;
    console.error("CAS import failed", error);
    redirect("/terminal/in/cas?status=failed");
  }
}

function disclosureStockTicker(row: ParsedDisclosureRow): string {
  if (row.ticker) return row.ticker.toUpperCase().replace(/[^A-Z0-9&.-]+/g, "").slice(0, 32);
  if (row.isin) return row.isin.toUpperCase();
  return `AMC_${row.stock_name}`
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 54);
}

async function resolveStockAssetId(row: ParsedDisclosureRow): Promise<string> {
  const ticker = disclosureStockTicker(row);
  if (row.ticker) {
    const listed = await queryOne<{ id: string }>(
      "select id from public.assets where asset_class = 'STOCK'::asset_class and country = 'IN' and ticker = $1 order by case when exchange = 'NSE' then 0 when exchange = 'BSE' then 1 else 2 end limit 1",
      [ticker],
    );
    if (listed) return listed.id;
  }

  const asset = await queryOne<{ id: string }>(
    `insert into public.assets (ticker, name, asset_class, exchange, country, currency)
     values ($1, $2, 'STOCK'::asset_class, 'AMC_HOLDING', 'IN', 'INR')
     on conflict (exchange, ticker) do update set name = excluded.name, is_active = true
     returning id`,
    [ticker, row.stock_name],
  );
  if (!asset) throw new Error(`Could not create stock asset for ${row.stock_name}`);
  return asset.id;
}

export async function importAmcDisclosure(formData: FormData): Promise<void> {
  try {
    const user = await getSessionUser();
    if (!user) redirect("/login");

    const fundAssetId = String(formData.get("fundAssetId") ?? "");
    const file = formData.get("disclosureFile");
    const password = String(formData.get("disclosurePassword") ?? "");
    const asOfDateRaw = String(formData.get("asOfDate") ?? "");
    const asOfDate = /^\d{4}-\d{2}-\d{2}$/.test(asOfDateRaw) ? asOfDateRaw : new Date().toISOString().slice(0, 10);

    if (!fundAssetId) redirect("/terminal/in/cas?disclosure=missing_fund");
    if (!(file instanceof File) || file.size === 0) redirect("/terminal/in/cas?disclosure=missing_file");

    const fund = await queryOne<{ id: string; ticker: string; name: string }>(
      `select a.id, a.ticker, a.name
         from public.holdings h
         join public.assets a on a.id = h.asset_id
        where h.user_id = $1 and a.id = $2 and a.asset_class = 'MUTUAL_FUND'::asset_class
        limit 1`,
      [user.id, fundAssetId],
    );
    if (!fund) redirect("/terminal/in/cas?disclosure=invalid_fund");

    const parsed = await parseDisclosureSource(file, { password });
    if (parsed === "bad_password") redirect("/terminal/in/cas?disclosure=bad_password");
    if (parsed === "parser_failed") redirect("/terminal/in/cas?disclosure=failed");

    const rows = parsed.rows
      .filter((r) => r.stock_name && Number.isFinite(Number(r.weight_percentage)) && Number(r.weight_percentage) > 0 && Number(r.weight_percentage) <= 100)
      .slice(0, 250);
    if (rows.length === 0) redirect("/terminal/in/cas?disclosure=empty");

    const stockIds: Array<{ id: string; weight: number }> = [];
    for (const row of rows) {
      stockIds.push({ id: await resolveStockAssetId(row), weight: Number(row.weight_percentage) });
    }

    await tx(async (c) => {
      await c.query(
        "delete from public.user_mutual_fund_holdings where user_id = $1 and fund_asset_id = $2",
        [user.id, fundAssetId],
      );
      for (const row of stockIds) {
        await c.query(
          `insert into public.user_mutual_fund_holdings
             (user_id, fund_asset_id, stock_asset_id, weight_percentage, as_of_date, source)
           values ($1, $2, $3, $4, $5, 'AMC_DISCLOSURE')
           on conflict (user_id, fund_asset_id, stock_asset_id) do update set
             weight_percentage = excluded.weight_percentage,
             as_of_date = excluded.as_of_date,
             source = excluded.source,
             imported_at = now()`,
          [user.id, fundAssetId, row.id, row.weight, asOfDate],
        );
      }
    });

    // Additive: also store the month-keyed snapshot (fund_schemes +
    // fund_holdings_snapshot) that the X-Ray's history path reads. The
    // user_mutual_fund_holdings write above stays exactly as it was — the
    // current X-Ray keeps reading it. A snapshot that fails the ±2% weight
    // check is rejected without failing the import the user just ran.
    try {
      const fullParsed = await parseDisclosureSource(file, { password, full: true });
      if (typeof fullParsed === "string") {
        console.warn(`AMC snapshot skipped: full-mode parse returned ${fullParsed}`);
      } else {
        await new AmcDisclosureProvider().ingestSnapshot({
          meta: {
            schemeCode: fund.ticker,
            name: fund.name,
            isin: /^IN[A-Z0-9]{10}$/.test(fund.ticker) ? fund.ticker : null,
            amc: null,
            category: null,
            subCategory: null,
          },
          month: asOfDate,
          rows: fullParsed.rows,
          assetId: fund.id,
        });
      }
    } catch (error) {
      if (error instanceof SnapshotRejectedError) {
        console.warn("AMC snapshot rejected at ingest:", error.message);
      } else {
        console.warn("AMC snapshot ingest failed (legacy import unaffected)", error);
      }
    }

    revalidatePath("/terminal/in");
    revalidatePath("/terminal/in/cas");
    redirect(`/terminal/in/cas?disclosure=imported&rows=${stockIds.length}`);
  } catch (error) {
    const digest = typeof error === "object" && error && "digest" in error ? String(error.digest) : "";
    if (digest.startsWith("NEXT_REDIRECT")) throw error;
    console.error("AMC disclosure import failed", error);
    redirect("/terminal/in/cas?disclosure=failed");
  }
}

