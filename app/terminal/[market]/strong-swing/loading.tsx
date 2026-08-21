export default function StrongSwingLoading() {
  return (
    <main className="min-h-screen bg-[#05070d] px-5 py-10 text-white">
      <div className="mx-auto max-w-7xl animate-pulse">
        <div className="h-8 w-72 rounded bg-white/10" />
        <div className="mt-3 h-4 w-full max-w-2xl rounded bg-white/5" />
        <div className="mt-10 space-y-3">
          {[0, 1, 2].map((item) => <div key={item} className="h-56 rounded-lg border border-white/8 bg-white/[0.025]" />)}
        </div>
      </div>
    </main>
  );
}
