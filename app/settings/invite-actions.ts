"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/authz";
import { INVITE_TTL_HOURS, issueInvitation, revokeInvitation } from "@/lib/invitations";

export interface InviteState { link?: string; error?: string; expiresAt?: string; email?: string | null }

/** Admin only. The plaintext link is returned once and never stored. */
export async function createInvitation(_prev: InviteState, formData: FormData): Promise<InviteState> {
  let admin;
  try {
    admin = await requireAdminAction();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Not allowed." };
  }
  try {
    const issued = await issueInvitation(admin.id, String(formData.get("email") ?? ""));
    const requestHeaders = await headers();
    const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
    const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
    const protocol = requestHeaders.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
    const base = configured || (host ? `${protocol}://${host}` : "http://localhost:3000");
    revalidatePath("/settings");
    return {
      link: `${base}/login?invite=${issued.token}`,
      expiresAt: issued.expiresAt.toISOString(),
      email: issued.email,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : `Could not create the invitation (valid ${INVITE_TTL_HOURS}h).` };
  }
}

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  await requireAdminAction();
  await revokeInvitation(String(formData.get("id") ?? ""));
  revalidatePath("/settings");
}
