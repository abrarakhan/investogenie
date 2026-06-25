"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createSession,
  destroySession,
  findUserByEmail,
  createUser,
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
  redirect("/dashboard");
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
  redirect("/dashboard");
}

export async function signout(): Promise<void> {
  await destroySession();
  revalidatePath("/", "layout");
  redirect("/login");
}
