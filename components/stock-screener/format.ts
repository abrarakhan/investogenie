// Presentational formatters for screener values. Null -> "—" everywhere (never
// 0). Money fields are Rs. Crore for INR rows and USD millions for USD rows, so
// formatting takes the row currency.
import type { FieldFormat } from "@/lib/screener/fields";

export const DASH = "—";

export function fmtPrice(n: number | null, currency: string): string {
  if (n === null || n === undefined) return DASH;
  const sym = currency === "USD" ? "$" : "₹";
  return `${sym}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function fmtPct(n: number | null, withSign = true): string {
  if (n === null || n === undefined) return DASH;
  const sign = withSign && n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function fmtNumber(n: number | null, digits = 2): string {
  if (n === null || n === undefined) return DASH;
  return n.toFixed(digits);
}

export function fmtInteger(n: number | null): string {
  if (n === null || n === undefined) return DASH;
  return Math.round(n).toLocaleString();
}

/** Compact money in the row's own unit: ₹ Cr rolls to k-Cr / L-Cr; $ mn rolls
 *  to $B / $T. Values arrive already in Cr (INR) or mn (USD). */
export function fmtMoney(n: number | null, currency: string): string {
  if (n === null || n === undefined) return DASH;
  if (currency === "USD") {
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}T`;
    if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}B`;
    return `$${Math.round(n).toLocaleString()}M`;
  }
  if (Math.abs(n) >= 100_000) return `₹${(n / 100_000).toFixed(2)}L Cr`;
  if (Math.abs(n) >= 1_000) return `₹${(n / 1_000).toFixed(1)}k Cr`;
  return `₹${Math.round(n).toLocaleString()} Cr`;
}

/** Format a value by the field's declared format + the row currency. */
export function formatValue(
  value: number | string | null,
  format: FieldFormat,
  currency: string,
): string {
  if (value === null || value === undefined || value === "") return DASH;
  if (typeof value === "string") return value;
  switch (format) {
    case "percent": return fmtPct(value);
    case "price": return fmtPrice(value, currency);
    case "money": return fmtMoney(value, currency);
    case "integer": return fmtInteger(value);
    case "number": return fmtNumber(value);
    default: return String(value);
  }
}

/** Colour class for a signed value (green up / red down / muted null). */
export function signColor(n: number | null): string {
  if (n === null || n === undefined) return "text-white/30";
  return n > 0 ? "text-emerald-400" : n < 0 ? "text-rose-400" : "text-white/60";
}

/** Plain CSV cell string (no currency symbols) for exports. */
export function rawCell(value: number | string | null): string {
  if (value === null || value === undefined) return "";
  return String(value);
}
