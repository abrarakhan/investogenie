import LandingPage from "@/components/landing/LandingPage";

// Server Component shell. The interactive, WebGL-heavy landing experience lives
// in the Client Component below (which lazy-loads the Three.js canvas).
export default function Page() {
  return <LandingPage />;
}
