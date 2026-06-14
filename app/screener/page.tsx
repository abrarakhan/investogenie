import { redirect } from "next/navigation";

// The combined screener is replaced by per-market terminal screeners.
export default function ScreenerRedirect() {
  redirect("/terminal/us/screener");
}
