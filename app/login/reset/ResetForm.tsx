"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { completePasswordReset, type AuthState } from "../actions";

const initial: AuthState = {};

// Same rationale as the login form: a manager silently filling these would set a password the
// user never chose, and on this screen there is no old value worth offering.
const NO_AUTOFILL = {
  autoComplete: "new-password",
  spellCheck: false,
  autoCapitalize: "none" as const,
  autoCorrect: "off",
  "data-1p-ignore": true,
  "data-lpignore": "true",
  "data-bwignore": true,
} as const;

const FIELD =
  "rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none placeholder:text-white/30 focus:border-[var(--ig-primary)]";

export default function ResetForm({ token }: { token: string }) {
  const [revealed, setRevealed] = useState(false);
  const [state, formAction, pending] = useActionState(completePasswordReset, initial);

  // Once the password is set the token is spent, so the form would only fail if used again.
  if (state.message) {
    return (
      <div className="w-full max-w-md">
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-300">
          {state.message}
        </p>
        <Link
          href="/login"
          className="mt-4 block rounded-xl bg-gradient-to-r from-[var(--ig-primary)] to-[var(--ig-accent)] px-4 py-3 text-center font-semibold text-black"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex w-full max-w-md flex-col gap-4">
      <input type="hidden" name="token" value={token} />

      <label className="flex flex-col gap-1.5">
        <span className="flex items-center justify-between text-xs uppercase tracking-widest text-white/50">
          <span>New password</span>
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            className="text-[10px] normal-case tracking-normal text-white/45 underline hover:text-white/75"
          >
            {revealed ? "Hide" : "Show"}
          </button>
        </span>
        <input
          {...NO_AUTOFILL}
          name="password"
          type={revealed ? "text" : "password"}
          required
          minLength={6}
          placeholder="••••••••"
          className={FIELD}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-widest text-white/50">Confirm new password</span>
        <input
          {...NO_AUTOFILL}
          name="confirmPassword"
          type={revealed ? "text" : "password"}
          required
          minLength={6}
          placeholder="••••••••"
          className={FIELD}
        />
      </label>

      {state.error && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-xl bg-gradient-to-r from-[var(--ig-primary)] to-[var(--ig-accent)] px-4 py-3 font-semibold text-black transition-transform hover:scale-[1.02] disabled:opacity-60"
      >
        {pending ? "Working…" : "Set new password"}
      </button>
    </form>
  );
}
