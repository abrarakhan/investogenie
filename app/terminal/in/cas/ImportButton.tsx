"use client";

import { useFormStatus } from "react-dom";

export default function ImportButton({
  label = "Import CAS holdings",
  pendingLabel = "Importing CAS...",
}: {
  label?: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-[var(--ig-accent)] px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
