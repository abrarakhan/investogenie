import { redirect } from "next/navigation";
import AppShell from "@/components/app/AppShell";
import { getSessionUser } from "@/lib/auth";
import { getDataHealthPageData } from "@/lib/dataHealth";
import DataHealthClient from "./DataHealthClient";

export const dynamic = "force-dynamic";

export default async function DataHealthPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const data = await getDataHealthPageData(user.id);

  return (
    <AppShell
      email={user.email ?? ""}
      market="US"
      active="data"
      title="Data Health"
      subtitle="Coverage gaps, source freshness, and sync logs in one place so stale data is visible before it reaches strategies."
      actions={<div className="text-xs text-white/35">Generated {new Date(data.generatedAt).toLocaleString("en-IN")}</div>}
      maxWidth="max-w-[1500px]"
    >
      <DataHealthClient key={data.generatedAt} data={data} />
    </AppShell>
  );
}
