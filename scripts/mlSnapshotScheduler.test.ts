import { describe, expect, it } from "vitest";
import { verifyCapture } from "./ml-snapshot-scheduler.mjs";

function recorder() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  return { calls, query: async (sql: string, params: unknown[]) => { calls.push({ sql, params }); } };
}
const quiet = { ...console, error: () => {} };

describe("after-close Strong Swing parity check", () => {
  it("records a clean check as its own job", async () => {
    const client = recorder();
    expect(await verifyCapture(client, "2026-11-13", async () => {}, quiet)).toBe(true);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].sql).toContain("'ok'");
    expect(client.calls[0].params[0]).toBe("strong-swing-parity-in");
  });

  it("records a difference as a failed job without throwing", async () => {
    const client = recorder();
    const failing = async () => { throw new Error("recorded values differ from the bars"); };
    expect(await verifyCapture(client, "2026-11-13", failing, quiet)).toBe(false);
    expect(client.calls[0].sql).toContain("'error'");
    expect(client.calls[0].params[2]).toContain("differ");
  });

  it("does nothing when no checker is configured", async () => {
    const client = recorder();
    expect(await verifyCapture(client, "2026-11-13", undefined, quiet)).toBeNull();
    expect(client.calls).toHaveLength(0);
  });
});
