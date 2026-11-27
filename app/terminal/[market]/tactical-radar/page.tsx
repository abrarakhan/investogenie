import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/app/AppShell";
import TacticalRadarClient from "@/components/tactical/TacticalRadarClient";
import { getSessionUser } from "@/lib/auth";
import { normalizeMarket } from "@/lib/markets";
import { getTacticalRadar } from "@/lib/tacticalRadar";
import { getSectorThrustSnapshot } from "@/lib/sectorThrust";

export const dynamic = "force-dynamic";

export default async function TacticalRadarPage({
  params,
}: {
  params: Promise<{ market: string }>;
}) {
  const { market: marketParam } = await params;
  const market = normalizeMarket(marketParam);
  if (!market) notFound();

  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [data, sectorThrust] = await Promise.all([
    getTacticalRadar(market, user.id, 15),
    getSectorThrustSnapshot(market),
  ]);

  return (
    <AppShell
      email={user.email}
      market={market}
      active="tactical-radar"
      title="Tactical Radar"
      subtitle="Market-aware watchlist candidates across Near-Trigger Breakouts, Mid-Trend Pullbacks, Oversold Snapbacks, and Sector Thrust — kept separate from Strong Swing's strict execution gates."
    >
      <TacticalRadarClient data={data} sectorThrust={sectorThrust} market={market} />
    </AppShell>
  );
}
