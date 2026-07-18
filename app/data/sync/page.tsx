import { redirect } from "next/navigation";

export default function DataSyncRedirect() {
  redirect("/admin/sync");
}
