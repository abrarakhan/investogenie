"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * Submit button for server-action forms. The ledger re-renders after each save,
 * which takes a second or two; without feedback the button looked stuck while
 * the update landed in the background. This disables the button and shows a
 * pending label while the action runs, then closes the surrounding "Edit…" /
 * "Record sale" panel once the save completes.
 */
export default function PendingSubmit({ children, pendingLabel = "Saving…", className, closeOnDone = true }: {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
  closeOnDone?: boolean;
}) {
  const { pending } = useFormStatus();
  const ref = useRef<HTMLButtonElement>(null);
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && closeOnDone) {
      const panel = ref.current?.closest("details");
      if (panel) panel.open = false;
    }
    wasPending.current = pending;
  }, [pending, closeOnDone]);
  return (
    <button ref={ref} type="submit" disabled={pending} aria-busy={pending} className={`${className ?? ""} disabled:cursor-wait disabled:opacity-60`}>
      {pending ? pendingLabel : children}
    </button>
  );
}
