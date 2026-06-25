// Lightweight email+password auth.
//  • passwords: bcrypt (bcryptjs).
//  • sessions: a signed (HS256, jose) httpOnly cookie carrying the user id —
//    stateless, no session table, no Docker auth service.
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { queryOne } from "@/lib/db";

const COOKIE = "ig_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days
const secret = new TextEncoder().encode(
  process.env.SESSION_SECRET ?? "dev-insecure-session-secret-change-me-0123456789",
);

export interface SessionUser {
  id: string;
  email: string;
}

// ---- passwords --------------------------------------------------------------
export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

// ---- session cookie (set/clear only valid in actions & route handlers) -------
export async function createSession(user: SessionUser): Promise<void> {
  const token = await new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** Resolve the signed-in user from the session cookie (read-only; safe in RSC). */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    if (!payload.sub) return null;
    return { id: payload.sub, email: (payload.email as string) ?? "" };
  } catch {
    return null;
  }
}

// ---- user records -----------------------------------------------------------
interface UserRow {
  id: string;
  email: string;
  password_hash: string;
}

export function findUserByEmail(email: string) {
  return queryOne<UserRow>(
    "select id, email, password_hash from public.users where lower(email) = lower($1)",
    [email],
  );
}

export async function createUser(email: string, password: string): Promise<SessionUser> {
  const hash = await hashPassword(password);
  const row = await queryOne<{ id: string; email: string }>(
    "insert into public.users (email, password_hash) values (lower($1), $2) returning id, email",
    [email, hash],
  );
  if (!row) throw new Error("could not create user");
  return { id: row.id, email: row.email };
}
