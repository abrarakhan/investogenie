"use client";

import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { loadCandidateGroup } from "@/lib/candidate-group-actions";
import type { LazyScreen } from "@/lib/lazyCandidateGroups";

export interface LazySource {
  screen: LazyScreen;
  market: string;
  status: string;
}

const VersionContext = createContext<number>(0);

/** Wrap on-demand groups with the page's render time so opened groups reload after a refresh. */
export function LazyGroupsVersion({ value, children }: { value: number; children: ReactNode }) {
  return <VersionContext.Provider value={value}>{children}</VersionContext.Provider>;
}

/**
 * A collapsible candidate group. With `items` it renders immediately; with
 * `source` instead, its cards are fetched the first time it is opened.
 */
export default function LazyCandidateGroup<T>({ summary, defaultOpen = false, items, ranks, source, render }: {
  summary: ReactNode;
  defaultOpen?: boolean;
  items?: T[];
  ranks?: Record<string, number>;
  source?: LazySource;
  render: (items: T[], ranks: Record<string, number>) => ReactNode;
}) {
  const [loaded, setLoaded] = useState<{ items: T[]; ranks: Record<string, number> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const version = useContext(VersionContext);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const loadedVersion = useRef<number | null>(null);
  const ready = items ? { items, ranks: ranks ?? {} } : loaded;

  const load = (force = false) => {
    if (!source || pending || (!force && ready)) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await loadCandidateGroup(source.screen, source.market, source.status);
        loadedVersion.current = version;
        if (result.ok) setLoaded({ items: result.items as T[], ranks: result.ranks });
        else setError(result.error ?? "Could not load this group.");
      } catch {
        setError("Could not load this group.");
      }
    });
  };

  // A group opened before hydration finished never delivered its toggle event.
  useEffect(() => {
    if (detailsRef.current?.open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The page re-rendered with newer quotes: refresh an opened group, forget a closed one.
  useEffect(() => {
    if (!source || loadedVersion.current === null || loadedVersion.current === version) return;
    loadedVersion.current = null;
    if (detailsRef.current?.open) load(true);
    else setLoaded(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  return (
    <details
      ref={detailsRef}
      open={defaultOpen}
      onToggle={(event) => { if (event.currentTarget.open) load(); }}
      className="group rounded-lg border border-white/10 bg-white/[0.012]"
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        {summary}
        <span className="shrink-0 text-xs font-semibold text-white/45 group-open:hidden">Expand</span>
        <span className="hidden shrink-0 text-xs font-semibold text-white/45 group-open:inline">Collapse</span>
      </summary>
      <div className="space-y-3 border-t border-white/8 p-3 sm:p-4">
        {ready
          ? render(ready.items, ready.ranks)
          : error
            ? <div className="flex flex-wrap items-center gap-3 text-sm text-rose-200/80">
                {error}
                <button type="button" onClick={() => load()} className="rounded-md border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/5">Retry</button>
              </div>
            : <div className="py-4 text-center text-sm text-white/40" aria-live="polite">Loading candidates…</div>}
      </div>
    </details>
  );
}
