import { NextRequest, NextResponse } from "next/server";
import { findUserByEmail, verifyPassword } from "@/lib/auth";
import { createMobileSession } from "@/lib/mobileAuth";
import { allowAuthAttempt, RATE_LIMITS } from "@/lib/rateLimit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const deviceName = typeof body?.deviceName === "string" ? body.deviceName.trim() : undefined;
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }
  if (!allowAuthAttempt("login", request.headers, RATE_LIMITS.loginPerIp, { value: email, rule: RATE_LIMITS.loginPerEmail })) {
    return NextResponse.json({ error: "Too many attempts. Wait a few minutes and try again." }, { status: 429 });
  }
  const user = await findUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }
  const session = await createMobileSession(user.id, deviceName);
  return NextResponse.json({ ...session, user: { id: user.id, email: user.email } });
}

