import Link from "next/link";
import { isResetTokenValid } from "@/lib/passwordResetTokens";
import ResetForm from "./ResetForm";

// The token is checked before the form renders, so a dead link says so plainly instead of
// letting someone type a password into a form that was never going to work.
export const dynamic = "force-dynamic";

export default async function ResetLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  const valid = await isResetTokenValid(token);

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-[#05070d] px-6 text-white">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{ background: "radial-gradient(60% 50% at 50% 0%, var(--ig-glow), transparent 70%)" }}
      />
      <Link href="/" className="relative z-10 mb-10 text-2xl font-black tracking-tight">
        Investo<span className="text-[var(--ig-accent)]">Genie</span>
      </Link>

      <div className="relative z-10 w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur-xl">
        <h1 className="mb-1 text-2xl font-bold">Choose a new password</h1>
        <p className="mb-6 text-sm text-white/50">
          {valid
            ? "This link works once. Use Show to check what you typed before saving."
            : "This reset link is no longer usable."}
        </p>

        {valid ? (
          <ResetForm token={token} />
        ) : (
          <div className="space-y-4">
            <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              The link is invalid, has already been used, or has expired. Reset links last 30
              minutes and only the newest one works.
            </p>
            <Link
              href="/login"
              className="block rounded-xl bg-gradient-to-r from-[var(--ig-primary)] to-[var(--ig-accent)] px-4 py-3 text-center font-semibold text-black"
            >
              Request a new link
            </Link>
          </div>
        )}
      </div>

      <Link href="/login" className="relative z-10 mt-8 text-sm text-white/40 hover:text-white/70">
        ← Back to sign in
      </Link>
    </main>
  );
}
