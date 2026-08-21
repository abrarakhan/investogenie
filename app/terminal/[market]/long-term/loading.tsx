export default function LongTermLoading() {
  return (
    <div className="space-y-4" role="status" aria-live="polite">
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ig-accent)]">
          Long-Term Candidates
        </p>
        <h2 className="mt-2 text-xl font-black text-white">Ranking the fundamentals-covered universe</h2>
        <p className="mt-2 text-sm text-white/45">Preparing strategy scores and supporting evidence...</p>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-[var(--ig-accent)]" />
        </div>
      </div>
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-28 animate-pulse rounded-lg border border-white/10 bg-white/[0.03]" />
      ))}
    </div>
  );
}
