"use client";

import { useActionState, useState } from "react";
import { login, signup, resetPassword, requestPasswordResetEmail, type AuthState } from "./actions";

const initial: AuthState = {};

// "emailreset" sends a one-time link and is the normal path; "reset" is the offline fallback
// using the recovery key, for when mail is down or the inbox is unreachable.
type Mode = "signin" | "signup" | "emailreset" | "reset";

// Password managers fill anything that looks like a login. On the reset form that is actively
// harmful: a silently autofilled value becomes the account's new password without the user ever
// seeing it. These opt-out attributes are respected by 1Password, LastPass and Bitwarden
// respectively; `autoComplete` alone is not enough, and browsers ignore "off" on password inputs.
const NO_AUTOFILL = {
  autoComplete: "off",
  spellCheck: false,
  autoCapitalize: "none" as const,
  autoCorrect: "off",
  "data-1p-ignore": true,
  "data-lpignore": "true",
  "data-bwignore": true,
} as const;

export default function LoginForm({ resetEnabled = false }: { resetEnabled?: boolean }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [revealed, setRevealed] = useState(false);
  const action =
    mode === "signin" ? login
      : mode === "signup" ? signup
        : mode === "emailreset" ? requestPasswordResetEmail
          : resetPassword;
  const [state, formAction, pending] = useActionState(action, initial);
  const isReset = mode === "reset" || mode === "emailreset";

  const changeMode = (next: Mode) => {
    setMode(next);
    setRevealed(false);
  };

  return (
    <div className="w-full max-w-md">
      <div className="mb-6 flex rounded-full border border-white/10 bg-white/5 p-1 text-sm">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => changeMode(m)}
            className={`flex-1 rounded-full py-2 font-semibold transition-colors ${
              mode === m ? "bg-white text-black" : "text-white/60 hover:text-white"
            }`}
          >
            {m === "signin" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      {mode === "emailreset" && (
        <p className="mb-4 rounded-lg border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-xs leading-relaxed text-sky-200/90">
          We&apos;ll email a one-time link to the address on your account. It works once and
          expires in 30 minutes.
        </p>
      )}
      {mode === "reset" && (
        <p className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200/90">
          Enter the recovery key from <code className="font-mono">.env.local</code> on the machine
          running InvestoGenie, along with the new password you want.
        </p>
      )}

      {/* Keyed by mode so switching tabs remounts the inputs. Without this React reuses the
          same elements and a value the browser autofilled for sign-in stays in the field after
          switching to reset — which is how a password nobody chose can get submitted. */}
      <form key={mode} action={formAction} className="flex flex-col gap-4">
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
            {/* Plain text, not a password input: it is pasted rather than remembered, and a
                type="password" field here is precisely what invites a manager to overwrite it.
                Showing it also lets the user confirm they pasted the right thing. */}
            <input
              {...NO_AUTOFILL}
              name="recoveryKey"
              type="text"
              required
              placeholder="from .env.local"
              className="rounded-xl border border-white/10 bg-black/40 px-4 py-3 font-mono text-sm text-white outline-none placeholder:text-white/30 focus:border-[var(--ig-primary)]"
            />
          </label>
        )}

        {/* The emailed-link flow collects the new password on the page the link opens, so the
            login screen only needs the address to send it to. */}
        {mode !== "emailreset" && (
          <label className="flex flex-col gap-1.5">
            <span className="flex items-center justify-between text-xs uppercase tracking-widest text-white/50">
              <span>{mode === "reset" ? "New password" : "Password"}</span>
              {mode === "reset" && (
                <button
                  type="button"
                  onClick={() => setRevealed((v) => !v)}
                  className="text-[10px] normal-case tracking-normal text-white/45 underline hover:text-white/75"
                >
                  {revealed ? "Hide" : "Show"}
                </button>
              )}
            </span>
            <input
              {...(mode === "reset" ? NO_AUTOFILL : {})}
              name="password"
              type={mode === "reset" && revealed ? "text" : "password"}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
              placeholder="••••••••"
              className="rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none placeholder:text-white/30 focus:border-[var(--ig-primary)]"
            />
          </label>
        )}

        {mode === "reset" && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-widest text-white/50">Confirm new password</span>
            <input
              {...NO_AUTOFILL}
              name="confirmPassword"
              type={revealed ? "text" : "password"}
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
                : mode === "emailreset"
                  ? "Email me a reset link"
                  : "Set new password"}
        </button>
      </form>

      <div className="mt-4 flex flex-col items-center gap-2 text-center">
        {isReset ? (
          <button
            type="button"
            onClick={() => changeMode("signin")}
            className="text-xs text-white/40 underline hover:text-white/70"
          >
            Back to sign in
          </button>
        ) : (
          <button
            type="button"
            onClick={() => changeMode("emailreset")}
            className="text-xs text-white/40 underline hover:text-white/70"
          >
            Forgot password?
          </button>
        )}

        {/* The recovery key is the fallback for when mail is not working, so it is only
            offered once the emailed route is already on screen — and only if a key exists. */}
        {resetEnabled && mode === "emailreset" && (
          <button
            type="button"
            onClick={() => changeMode("reset")}
            className="text-[11px] text-white/30 underline hover:text-white/60"
          >
            Can&apos;t receive email? Use the recovery key
          </button>
        )}
        {mode === "reset" && (
          <button
            type="button"
            onClick={() => changeMode("emailreset")}
            className="text-[11px] text-white/30 underline hover:text-white/60"
          >
            Email me a link instead
          </button>
        )}
      </div>
    </div>
  );
}
