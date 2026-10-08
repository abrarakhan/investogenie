import type { MarketId } from "@/lib/types";

export function validateShareQuantity(market: MarketId, quantity: number): void {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Quantity must be greater than zero");
  if (market === "IN" && !Number.isInteger(quantity)) {
    throw new Error("India stock quantity must be a whole number of shares. Check that price and quantity are entered in the correct fields.");
  }
}
