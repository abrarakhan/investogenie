"use client";

import { useActionState } from "react";
import { createInvitation, type InviteState } from "@/app/settings/invite-actions";

const initial: InviteState = {};

export default function InviteForm() {
  const [state, formAction, pending] = useActionState(createInvitation, initial);
  return (
    <form action={formAction} className="mt-6 flex flex-col gap-3 sm:max-w-xl">
      <label className="block">
        <span className="text-sm font-medium text-white/80">Invitee email (optional)</span>
        <input
          name="email"
          type="email"
          placeholder="Leave blank to allow any email"
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-[var(--ig-primary)]"
        />
        <span className="mt-1 block text-xs text-white/40">Bind the link to one address so a forwarded link cannot be used by someone else.</span>
      </label>
      <button type="submit" disabled={pending} className="self-start rounded-lg bg-[var(--ig-primary)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-60">
        {pending ? "Creating…" : "Create invitation link"}
      </button>
      {state.error && <p className="text-sm text-rose-300">{state.error}</p>}
      {state.link && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">
          <p>Send this one-time link{state.email ? ` to ${state.email}` : ""}. It is shown only now and expires {new Date(state.expiresAt!).toLocaleString()}.</p>
          <input readOnly value={state.link} onFocus={(event) => event.currentTarget.select()} className="mt-2 w-full rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-xs text-white" />
        </div>
      )}
    </form>
  );
}
