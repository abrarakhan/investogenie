import type { Market } from "./api";

export const money = (value: number, market: Market) => new Intl.NumberFormat(market === "IN" ? "en-IN" : "en-US", {
  style: "currency", currency: market === "IN" ? "INR" : "USD", maximumFractionDigits: 2,
}).format(value);

export const pct = (value: number | null) => value === null ? "--" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

/** Accept comma- or space-grouped amounts; invalid input remains NaN for server validation. */
export const amount = (text: string) => Number(text.replace(/[,\s]/g, ""));

export const marketDate = (market: Market) => new Intl.DateTimeFormat("en-CA", {
  timeZone: market === "IN" ? "Asia/Kolkata" : "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

export const errorMessage = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback;
