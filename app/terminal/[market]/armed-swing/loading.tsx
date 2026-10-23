export default function ArmedSwingLoading() {
  return (
    <div className="min-h-[100dvh] bg-[#05070d] px-5 py-8 text-white lg:px-6">
      <div className="mx-auto max-w-7xl animate-pulse">
        <div className="h-7 w-64 rounded bg-white/10" />
        <div className="mt-3 h-4 w-full max-w-2xl rounded bg-white/[0.06]" />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="h-48 rounded-xl border border-white/8 bg-white/[0.025]" />
          ))}
        </div>
      </div>
    </div>
  );
}
