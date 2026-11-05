import { describe, expect, it } from "vitest";
import { mapRecordedPositionRows } from "./recordedPositions";

const row = (overrides: Partial<Parameters<typeof mapRecordedPositionRows>[0][number]> = {}) => ({
  ledger_id: "trade-1", asset_id: "asset-1", ticker: "NAZARA", name: "Nazara Technologies",
  asset_class: "STOCK", exchange: "NSE", currency: "INR", country: "IN",
  quantity: "274", sold_quantity: "0", buy_price: "405.71", strategy_label: "Default Swing",
  ...overrides,
});

describe("mapRecordedPositionRows", () => {
  it("shows an open recorded trade as a terminal position", () => {
    expect(mapRecordedPositionRows([row()])).toEqual([expect.objectContaining({
      id: "ledger:trade-1", quantity: 274, avgCost: 405.71, sourceLabel: "Default Swing",
      asset: expect.objectContaining({ ticker: "NAZARA", country: "IN" }),
    })]);
  });

  it("subtracts partial exits from the visible quantity", () => {
    expect(mapRecordedPositionRows([row({ quantity: "100", sold_quantity: "35" })])[0].quantity).toBe(65);
  });

  it("does not display a fully exited row even before its status reconciliation", () => {
    expect(mapRecordedPositionRows([row({ quantity: "100", sold_quantity: "100" })])).toEqual([]);
  });
});
