import { redirect } from "next/navigation";

// Swing Candidates lives per-market under the terminal. This is the stable
// top-level entry point (formerly /screener, which is now the stock screener).
export default function SwingCandidatesRedirect() {
  redirect("/terminal/us/screener");
}
