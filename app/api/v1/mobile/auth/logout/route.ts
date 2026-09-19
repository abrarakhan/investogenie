import { NextRequest, NextResponse } from "next/server";
import { revokeMobileSession } from "@/lib/mobileAuth";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest) {
  await revokeMobileSession(request);
  return new NextResponse(null, { status: 204 });
}

