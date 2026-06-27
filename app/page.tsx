import LandingPage from "@/components/landing/LandingPage";
import { getLiveMarketQuotes } from "@/lib/quotes";

export const dynamic = "force-dynamic";

// Server Component shell. The interactive, WebGL-heavy landing experience lives
// in the Client Component below (which lazy-loads the Three.js canvas).
export default async function Page() {
  const quotes = await getLiveMarketQuotes();
  return <LandingPage quotes={quotes} />;
}
