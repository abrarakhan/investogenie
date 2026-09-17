import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const execute = promisify(execFile);
const requests = new Map<string, number>();

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (Date.now() - (requests.get(user.id) ?? 0) < 60_000) {
    return NextResponse.json({ skipped: true });
  }
  const body = await request.json().catch(() => null);
  const ids = body?.assetIds;
  if (!Array.isArray(ids) || ids.length > 50 || ids.some((id) => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))) {
    return NextResponse.json({ error: "Invalid asset list" }, { status: 400 });
  }
  if (!ids.length) return NextResponse.json({ updated: 0 });
  requests.set(user.id, Date.now());
  try {
    const root = process.cwd();
    const python = process.env.PYTHON_BIN || [root, ".venv", "bin", "python"].join("/");
    const worker = [root, "workers", "breeze_page_quotes.py"].join("/");
    const { stdout } = await execute(python, [worker, user.id, JSON.stringify(ids)], {
      cwd: root, timeout: 55_000, maxBuffer: 256_000,
    });
    return NextResponse.json(JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}"));
  } catch {
    return NextResponse.json({ error: "Breeze quote refresh failed. Check your session in Settings; existing prices were retained." }, { status: 502 });
  }
}
