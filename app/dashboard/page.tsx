import { redirect } from "next/navigation";

// The combined dashboard is replaced by separate per-market terminals.
export default function DashboardRedirect() {
  redirect("/terminal/us");
}
