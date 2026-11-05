import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ calls: [] as Array<{ sql: string; params?: unknown[] }>, assets: [] as unknown[], bars: [] as unknown[] }));

vi.mock("pg", () => ({
  Pool: class {
    async query(sql: string, params?: unknown[]) {
      db.calls.push({ sql, params });
      if (sql.startsWith("select now()")) return { rows: [{ started_at: new Date("2026-11-05T09:00:00Z") }] };
      if (sql.includes("from public.assets a\n        where a.is_active")) return { rows: db.assets };
      if (sql.includes("from public.daily_ohlcv o\n            where o.asset_id = any($1)")) return { rows: db.bars };
      if (sql.startsWith("update public.swing_signals")) return { rows: [], rowCount: 3 };
      return { rows: [] };
    }
    async end() {}
  },
}));

import { computeSignals } from "@/lib/ingest/signals";

const bars = Array.from({ length: 60 }, (_, index) => {
  const close = 100 + (index % 4);
  return {
    asset_id: "a1", date: new Date(Date.UTC(2026, 6, 1 + index)).toISOString().slice(0, 10),
    open: close - 0.5, high: close + 0.5, low: close - 1, close, volume: 1_000_000, open_interest: null,
  };
});

describe("computeSignals retirement", () => {
  beforeEach(() => {
    db.calls = [];
    db.assets = [];
    db.bars = [];
  });

  it("retires rows the scan did not recompute, using the scan's start time", async () => {
    db.assets = [{ id: "a1", ticker: "AAA", country: "IN", exchange: "NSE", asset_class: "STOCK" }];
    db.bars = bars;

    const summary = await computeSignals("postgres://localhost/test");

    const retire = db.calls.find((call) => call.sql.startsWith("update public.swing_signals"));
    expect(summary.scanned).toBe(1);
    expect(summary.retired).toBe(3);
    expect(retire?.sql).toContain("verdict='NO_SETUP'");
    expect(retire?.sql).toContain("where computed_at < $1");
    expect(retire?.params).toEqual([new Date("2026-11-05T09:00:00Z")]);
    // Retirement runs after the upsert, never before it.
    const upsertIndex = db.calls.findIndex((call) => call.sql.startsWith("insert into public.swing_signals"));
    expect(upsertIndex).toBeGreaterThan(-1);
    expect(db.calls.indexOf(retire!)).toBeGreaterThan(upsertIndex);
  });

  it("retires nothing when the scan computed no rows", async () => {
    const summary = await computeSignals("postgres://localhost/test");
    expect(summary.retired).toBe(0);
    expect(db.calls.some((call) => call.sql.startsWith("update public.swing_signals"))).toBe(false);
  });
});
