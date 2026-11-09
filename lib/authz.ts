import { notFound, redirect } from "next/navigation";
import { getSessionUser, type SessionUser } from "@/lib/auth";

/**
 * Authorization for shared system resources: canonical market data, shared
 * news intelligence, backfill and pipeline diagnostics. User-owned data stays
 * scoped by user_id; these guards cover what is shared between accounts.
 */
export const isAdmin = (user: Pick<SessionUser, "role"> | null | undefined): boolean => user?.role === "ADMIN";

/** Pages: anonymous → login; signed-in non-admin → 404 (the page's existence is not advertised). */
export async function requireAdminPage(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isAdmin(user)) notFound();
  return user;
}

/** Server actions: throws for anyone but an admin. */
export async function requireAdminAction(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("Not signed in");
  if (!isAdmin(user)) throw new Error("Only the owner can run this shared operation.");
  return user;
}
