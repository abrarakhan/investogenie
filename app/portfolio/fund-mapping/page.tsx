import { redirect } from "next/navigation";
import AppShell from "@/components/app/AppShell";
import { getSessionUser } from "@/lib/auth";
import { getFundMappingData } from "@/lib/funds/fundMappingStore";
import { getFundOverlap } from "@/lib/engines-runtime";
import FundMappingClient from "./FundMappingClient";

export const dynamic = "force-dynamic";

export default async function FundMappingPage({ searchParams }: { searchParams: Promise<{ linked?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // Reuse the same engine the terminal's X-Ray uses rather than recomputing
  // overlap here — mapping decisions and the X-Ray must never disagree.
  const [data, params, overlap] = await Promise.all([
    getFundMappingData(user.id),
    searchParams,
    getFundOverlap(),
  ]);

  return (
    <AppShell
      email={user.email ?? ""}
      market="IN"
      active="fund-mapping"
      title="Fund Mapping"
      subtitle="Link your CAS fund holdings to loaded AMC monthly portfolio disclosures so Fund X-Ray can calculate true stock overlap."
      maxWidth="max-w-[1500px]"
    >
      <FundMappingClient
        data={data}
        linkedStocks={params.linked ?? null}
        pairwiseOverlaps={overlap?.pairwiseOverlaps ?? []}
      />
    </AppShell>
  );
}
