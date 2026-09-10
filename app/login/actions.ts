"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import { isResetKeyConfigured, resetKeyMatches } from "@/lib/passwordReset";
import {
  issueResetToken,
  redeemResetToken,
  TOKEN_TTL_MINUTES,
} from "@/lib/passwordResetTokens";
import { sendEmailWithConfig } from "@/lib/email/nodemailer-service";
import { passwordResetEmail } from "@/lib/email/password-reset-template";
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
  redirect("/terminal/in");
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
  redirect("/terminal/in");
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

/** Resolves the account's own stored SMTP credentials — the same ones the daily digest uses. */
async function smtpConfigFor(userId: string) {
  const creds = await queryOne<{
    smtp_host: string | null;
    smtp_port: number | null;
    smtp_user: string | null;
    smtp_password_encrypted: string | null;
  }>(
    `select smtp_host, smtp_port, smtp_user, smtp_password_encrypted
       from public.user_credentials where user_id = $1`,
    [userId],
  );
  if (!creds?.smtp_host || !creds.smtp_user || !creds.smtp_password_encrypted) return null;
  const { decryptCredential } = await import("@/lib/crypto/credentials");
  return {
    host: creds.smtp_host,
    port: creds.smtp_port || 587,
    user: creds.smtp_user,
    password: decryptCredential(creds.smtp_password_encrypted),
  };
}

/**
 * Emails a one-time reset link.
 *
 * The reply is identical whether or not the address has an account, and whether or not the
 * hourly cap was hit — otherwise this form becomes a way to test which emails are registered.
 * Failures are logged server-side rather than surfaced for the same reason.
 */
export async function requestPasswordResetEmail(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter the email address on your account." };

  const neutral: AuthState = {
    message: `If that address has an account, a reset link is on its way. It expires in ${TOKEN_TTL_MINUTES} minutes.`,
  };

  try {
    const user = await findUserByEmail(email);
    if (!user) return neutral;

    const issued = await issueResetToken(user.id);
    if (!issued) return neutral; // hourly cap reached

    const smtp = await smtpConfigFor(user.id);
    if (!smtp) {
      console.warn("[password-reset] no SMTP credentials configured; cannot send reset email");
      return neutral;
    }

    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
    const resetUrl = `${baseUrl}/login/reset?token=${issued.token}`;
    await sendEmailWithConfig(smtp, {
      to: user.email,
      subject: "Reset your InvestoGenie password",
      html: passwordResetEmail(resetUrl, TOKEN_TTL_MINUTES),
    });
  } catch (error) {
    console.error("[password-reset] could not send reset email:", error);
  }

  return neutral;
}

/** Completes a reset from an emailed link. The token is consumed whether or not it is valid. */
export async function completePasswordReset(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (!password) return { error: "Enter a new password." };
  if (password.length < 6) return { error: "Password must be at least 6 characters." };
  if (password !== confirm) return { error: "The two passwords do not match." };

  const redeemed = await redeemResetToken(token);
  if (!redeemed) {
    return { error: "That reset link is invalid, already used, or has expired. Request a new one." };
  }

  await query(`update public.users set password_hash = $2 where id = $1`, [
    redeemed.userId,
    await hashPassword(password),
  ]);

  return { message: "Password updated. Sign in with your new password." };
}

export async function signout(): Promise<void> {
  await destroySession();
  revalidatePath("/", "layout");
  redirect("/login");
}
