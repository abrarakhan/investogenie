"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { isResetKeyConfigured, resetKeyMatches } from "@/lib/passwordReset";
import {
  createSession,
  destroySession,
  findUserByEmail,
  createUser,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";

export interface AuthState {
  error?: string;
  message?: string;
}

function readCredentials(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  return { email, password };
}

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const { email, password } = readCredentials(formData);
  if (!email || !password) return { error: "Email and password are required." };

  const user = await findUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return { error: "Invalid email or password." };
  }
  await createSession({ id: user.id, email: user.email });
  revalidatePath("/", "layout");
  redirect("/terminal/us");
}

export async function signup(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const { email, password } = readCredentials(formData);
  if (!email || !password) return { error: "Email and password are required." };
  if (password.length < 6) return { error: "Password must be at least 6 characters." };

  if (await findUserByEmail(email)) {
    return { error: "An account with that email already exists." };
  }
  const user = await createUser(email, password);
  await createSession(user);
  revalidatePath("/", "layout");
  redirect("/terminal/us");
}

/**
 * Password reset from the login screen.
 *
 * The screen is reachable by anything that can reach the app — every device on the tailnet —
 * so a bare "type a new password" form here would be an account-takeover path, not a
 * convenience. It is therefore gated on a recovery key held in .env.local, which only someone
 * with host access can read. With no key configured the flow stays off entirely and the login
 * screen does not offer it, so this cannot become a silent hole by omission.
 *
 * `scripts/reset-local-password.mjs` (and the "Reset InvestoGenie Password" desktop shortcut)
 * remain the host-access recovery path and need no key.
 */
export async function isPasswordResetEnabled(): Promise<boolean> {
  return isResetKeyConfigured(process.env.PASSWORD_RESET_KEY);
}

export async function resetPassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const expectedKey = process.env.PASSWORD_RESET_KEY ?? "";
  // Re-checked here rather than trusting the UI: the action is independently reachable.
  if (!isResetKeyConfigured(expectedKey)) {
    return { error: "Password reset is not enabled on this server." };
  }

  const email = String(formData.get("email") ?? "").trim();
  const suppliedKey = String(formData.get("recoveryKey") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (!email || !suppliedKey || !password) {
    return { error: "Email, recovery key and a new password are required." };
  }
  if (password.length < 6) return { error: "Password must be at least 6 characters." };
  if (password !== confirm) return { error: "The two passwords do not match." };
  if (!resetKeyMatches(suppliedKey, expectedKey)) {
    return { error: "That recovery key is not valid." };
  }

  // Deliberately reported the same way as a bad key: with a valid key the account list is not
  // worth enumerating, but there is also no reason to confirm which emails exist.
  const user = await findUserByEmail(email);
  if (!user) return { error: "That recovery key is not valid." };

  await query(`update public.users set password_hash = $2 where id = $1`, [
    user.id,
    await hashPassword(password),
  ]);

  // No session is created — the new password has to work on the next sign-in, which proves
  // the reset actually took.
  return { message: "Password updated. Sign in with your new password." };
}

export async function signout(): Promise<void> {
  await destroySession();
  revalidatePath("/", "layout");
  redirect("/login");
}
