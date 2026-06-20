import { type NextRequest, NextResponse } from "next/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

// Handles the magic link / email-confirmation redirect from Supabase Auth.
// e.g. /auth/confirm?token_hash=...&type=signup&next=/dashboard
//
// Only same-origin relative paths are honored for `next` — an absolute or
// protocol-relative value (https://…, //…, /\…) would let a valid confirmation
// flow bounce through our trusted domain to an attacker (open redirect).
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/")) return "/dashboard";
  if (raw[1] === "/" || raw[1] === "\\") return "/dashboard"; // //evil, /\evil
  return raw;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));

  if (token_hash && type) {
    const supabase = createClient(await cookies());
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  return NextResponse.redirect(new URL("/login?error=confirm", request.url));
}
