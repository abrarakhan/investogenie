"use client";

import { useActionState, useState } from "react";
import { login, signup, resetPassword, type AuthState } from "./actions";

const initial: AuthState = {};

type Mode = "signin" | "signup" | "reset";

export default function LoginForm({ resetEnabled = false }: { resetEnabled?: boolean }) {
  const [mode, setMode] = useState<Mode>("signin");
  const action = mode === "signin" ? login : mode === "signup" ? signup : resetPassword;
  const [state, formAction, pending] = useActionState(action, initial);

  return (
    <div className="w-full max-w-md">
      <div className="mb-6 flex rounded-full border border-white/10 bg-white/5 p-1 text-sm">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded-full py-2 font-semibold transition-colors ${
              mode === m ? "bg-white text-black" : "text-white/60 hover:text-white"
            }`}
          >
            {m === "signin" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      {mode === "reset" && (
        <p className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200/90">
          Enter the recovery key from <code className="font-mono">.env.local</code> on the machine
          running InvestoGenie, along with the new password you want.
        </p>
      )}

      <form action={formAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-widest text-white/50">Email</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
            className="rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none placeholder:text-white/30 focus:border-[var(--ig-primary)]"
          />
        </label>
        {mode === "reset" && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-widest text-white/50">Recovery key</span>
            <input
              name="recoveryKey"
              type="password"
              autoComplete="off"
              required
              placeholder="from .env.local"
              className="rounded-xl border border-white/10 bg-black/40 px-4 py-3 font-mono text-white outline-none placeholder:text-white/30 focus:border-[var(--ig-primary)]"
            />
          </label>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-widest text-white/50">
            {mode === "reset" ? "New password" : "Password"}
          </span>
          <input
            name="password"
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            placeholder="••••••••"
            className="rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none placeholder:text-white/30 focus:border-[var(--ig-primary)]"
          />
        </label>

        {mode === "reset" && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-widest text-white/50">Confirm new password</span>
            <input
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              placeholder="••••••••"
              className="rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none placeholder:text-white/30 focus:border-[var(--ig-primary)]"
            />
          </label>
        )}

        {state.error && (
          <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {state.error}
          </p>
        )}
        {state.message && (
          <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
            {state.message}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-2 rounded-xl bg-gradient-to-r from-[var(--ig-primary)] to-[var(--ig-accent)] px-4 py-3 font-semibold text-black transition-transform hover:scale-[1.02] disabled:opacity-60"
        >
          {pending
            ? "Working…"
            : mode === "signin"
              ? "Enter the terminal"
              : mode === "signup"
                ? "Create account"
                : "Set new password"}
        </button>
      </form>

      {resetEnabled && (
        <div className="mt-4 text-center">
          {mode === "reset" ? (
            <button
              type="button"
              onClick={() => setMode("signin")}
              className="text-xs text-white/40 underline hover:text-white/70"
            >
              Back to sign in
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setMode("reset")}
              className="text-xs text-white/40 underline hover:text-white/70"
            >
              Forgot password?
            </button>
          )}
        </div>
      )}
    </div>
  );
}
