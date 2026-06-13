import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import LoginForm from "./LoginForm";

// If already authenticated, skip straight to the terminal.
export default async function LoginPage() {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-[#05070d] px-6 text-white">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, var(--ig-glow), transparent 70%)",
        }}
      />
      <Link
        href="/"
        className="relative z-10 mb-10 text-2xl font-black tracking-tight"
      >
        Investo<span className="text-[var(--ig-accent)]">Genie</span>
      </Link>
      <div className="relative z-10 w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur-xl">
        <h1 className="mb-1 text-2xl font-bold">Access your terminal</h1>
        <p className="mb-6 text-sm text-white/50">
          Multi-asset portfolios across the US &amp; Indian markets.
        </p>
        <LoginForm />
      </div>
      <Link
        href="/"
        className="relative z-10 mt-8 text-sm text-white/40 hover:text-white/70"
      >
        ← Back to landing
      </Link>
    </main>
  );
}
