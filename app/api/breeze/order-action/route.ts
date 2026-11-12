import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { triggerBreezeReconciliation } from "@/lib/breeze/reconciliation";

// Cancel or change one of the signed-in user's own open NSE cash orders, through
// their own Breeze session and only on their confirmed request. The worker
// re-reads the order from the broker, refuses anything that is not an open cash
// order, and records the attempt before acting. Nothing here places a new order.
//   POST /api/breeze/order-action  { action: "cancel" | "modify", orderId, price?, quantity?, confirmed: true }
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const execute = promisify(execFile);
const MIN_GAP_MS = 3_000;
const lastRequest = new Map<string, number>();

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (process.env.BREEZE_ORDER_ACTIONS_DISABLED === "1") {
    return NextResponse.json({ error: "Order changes from the app are switched off." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const action = body?.action === "cancel" ? "CANCEL" : body?.action === "modify" ? "MODIFY" : null;
  const orderId = typeof body?.orderId === "string" ? body.orderId.trim() : "";
  if (!action || !/^[A-Za-z0-9]{6,40}$/.test(orderId) || body?.confirmed !== true) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const price = Number(body?.price);
  const quantity = Number(body?.quantity);
  if (action === "MODIFY" && (!Number.isFinite(price) || price <= 0 || price > 10_000_000
    || !Number.isInteger(quantity) || quantity <= 0 || quantity > 10_000_000)) {
    return NextResponse.json({ error: "Enter a price and a whole-share quantity." }, { status: 400 });
  }
  if (Date.now() - (lastRequest.get(user.id) ?? 0) < MIN_GAP_MS) {
    return NextResponse.json({ error: "Wait a few seconds before the next order change." }, { status: 429 });
  }
  lastRequest.set(user.id, Date.now());

  const root = process.cwd();
  const python = process.env.PYTHON_BIN || [root, ".venv", "bin", "python"].join("/");
  const worker = [root, "workers", "breeze_order_action.py"].join("/");
  const args = action === "MODIFY"
    ? [worker, user.id, action, orderId, price.toFixed(2), String(quantity)]
    : [worker, user.id, action, orderId];
  try {
    const { stdout } = await execute(python, args, { cwd: root, timeout: 45_000, maxBuffer: 64_000 });
    // Refresh the stored account snapshot so the order list reflects the change.
    void triggerBreezeReconciliation().catch(() => false);
    return NextResponse.json(JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}"));
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout ?? "";
    let reason: string | null = null;
    try {
      reason = (JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as { error?: string }).error ?? null;
    } catch { /* fall through to the generic message */ }
    return NextResponse.json(
      { error: reason ?? "The request did not complete. Check the order in ICICI Direct before trying again." },
      { status: 502 },
    );
  }
}
