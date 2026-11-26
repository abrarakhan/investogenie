import { notFound, redirect } from "next/navigation";
import { normalizeMarket } from "@/lib/markets";

export const dynamic = "force-dynamic";

export default async function ArmedSwingRedirectPage({
  params,
}: {
  params: Promise<{ market: string }>;
}) {
  const { market: marketParam } = await params;
  const market = normalizeMarket(marketParam);
  if (!market) notFound();
  redirect(`/terminal/${market.toLowerCase()}/tactical-radar`);
}
