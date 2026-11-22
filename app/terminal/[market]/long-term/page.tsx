import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import AppShell from "@/components/app/AppShell";
import LongTermCandidatesClient from "@/components/long-term/LongTermCandidatesClient";
import { getLongTermCandidates } from "@/lib/long-term-actions";
import { normalizeMarket } from "@/lib/markets";

export const dynamic = "force-dynamic";

export default async function LongTermPage({
  params,
}: {
  params: Promise<{ market: string }>;
}) {
  const { market: marketParam } = await params;
  const marketId = normalizeMarket(marketParam);
  if (!marketId) notFound();

  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/terminal/${marketParam.toLowerCase()}/long-term`)}`);
  const result = await getLongTermCandidates({ market: marketId, limit: 50 });

  return (
    <AppShell
      email={user.email}
      market={marketId}
      active="long-term"
      title="Long-Term Candidates"
      subtitle="Six long-horizon investors' published fundamentals criteria, scored against every stock and ranked."
    >
      <LongTermCandidatesClient market={marketId} initial={result} />
    </AppShell>
  );
}
