import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

// Read-only estimate of the broker's charges for a cash order, from the signed-in
// user's own Breeze session. Nothing is placed and nothing is stored.
//   POST /api/breeze/order-preview  { assetId, price, quantity, action? }
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const execute = promisify(execFile);

// Each estimate is a broker request that counts against the account's daily allowance.
const MIN_GAP_MS = 5_000;
const DAILY_LIMIT = 40;
const usage = new Map<string, { last: number; day: string; count: number }>();

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const assetId = body?.assetId;
  const price = Number(body?.price);
  const quantity = Number(body?.quantity);
  const action = body?.action === "sell" ? "sell" : "buy";
  if (typeof assetId !== "string" || !/^[0-9a-f-]{36}$/i.test(assetId)
    || !Number.isFinite(price) || price <= 0 || price > 10_000_000
    || !Number.isInteger(quantity) || quantity <= 0 || quantity > 10_000_000) {
    return NextResponse.json({ error: "Choose a stock, then enter a price and a whole-share quantity." }, { status: 400 });
  }

  const day = new Date().toISOString().slice(0, 10);
  const seen = usage.get(user.id);
  const record = seen && seen.day === day ? seen : { last: 0, day, count: 0 };
  if (Date.now() - record.last < MIN_GAP_MS) {
    return NextResponse.json({ error: "Wait a few seconds before estimating again." }, { status: 429 });
  }
  if (record.count >= DAILY_LIMIT) {
    return NextResponse.json({ error: "Daily limit for charge estimates reached; try again tomorrow." }, { status: 429 });
  }
  usage.set(user.id, { last: Date.now(), day, count: record.count + 1 });

  const root = process.cwd();
  const python = process.env.PYTHON_BIN || [root, ".venv", "bin", "python"].join("/");
  const worker = [root, "workers", "breeze_order_preview.py"].join("/");
  try {
    const { stdout } = await execute(python, [worker, user.id, assetId, action, String(price), String(quantity)], {
      cwd: root, timeout: 45_000, maxBuffer: 64_000,
    });
    return NextResponse.json(JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}"));
  } catch (error) {
    // The worker reports its own reason on stdout before exiting non-zero.
    const stdout = (error as { stdout?: string }).stdout ?? "";
    let reason: string | null = null;
    try {
      reason = (JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as { error?: string }).error ?? null;
    } catch { /* fall through to the generic message */ }
    return NextResponse.json(
      { error: reason ?? "Could not get an estimate from Breeze. Check your session in Settings." },
      { status: 502 },
    );
  }
}
