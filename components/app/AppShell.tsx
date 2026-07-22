import Link from "next/link";
import { Suspense } from "react";
import { signout } from "@/app/login/actions";
import { MARKETS } from "@/lib/markets";
import type { MarketId } from "@/lib/types";
import ApplyMarketTheme from "@/components/terminal/ApplyMarketTheme";
import { getWorstDataHealthStatus } from "@/lib/dataHealth";
import type { FreshnessStatus } from "@/lib/status";

type NavSection = {
  title: string;
  items: Array<{
    label: string;
    href: string;
    active?: boolean;
    badge?: string;
    statusDot?: "data-health";
    muted?: boolean;
  }>;
};

const marketPath = (market: MarketId) => market.toLowerCase();

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const DOT: Record<FreshnessStatus, string> = {
  fresh: "bg-emerald-400",
  stale: "bg-amber-400",
  failed: "bg-rose-400",
  unknown: "bg-white/35",
  off_hours: "bg-slate-400",
};

async function DataHealthDot() {
  const status = await getWorstDataHealthStatus();
  return <span title={`Data health: ${status}`} className={`h-2 w-2 rounded-full ${DOT[status]}`} />;
}

function MarketSwitch({ market, activeArea }: { market: MarketId; activeArea: string }) {
  const currentPath = marketPath(market);
  const target = activeArea === "overview" ? "/markets" : "/terminal";

  return (
    <div className="grid grid-cols-2 rounded-lg border border-white/10 bg-black/25 p-1 text-xs font-semibold">
      {(["US", "IN"] as MarketId[]).map((m) => (
        <Link
          key={m}
          href={`${target}/${marketPath(m)}${activeArea === "stock-screener" ? "/stocks" : activeArea === "swing" ? "/screener" : activeArea === "probability" ? "/probability" : ""}`}
          className={cx(
            "rounded-md px-3 py-1.5 text-center transition-colors",
            m.toLowerCase() === currentPath
              ? "bg-[var(--ig-accent)] text-black"
              : "text-white/45 hover:bg-white/5 hover:text-white",
          )}
        >
          {MARKETS[m].flag} {m}
        </Link>
      ))}
    </div>
  );
}

export default function AppShell({
  children,
  email,
  market,
  active,
  title,
  subtitle,
  actions,
  maxWidth = "max-w-7xl",
}: {
  children: React.ReactNode;
  email?: string;
  market: MarketId;
  active: "overview" | "terminal" | "stock-screener" | "swing" | "probability" | "forward-test" | "import-holdings" | "fund-mapping" | "data" | "settings";
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  maxWidth?: string;
}) {
  const cfg = MARKETS[market];
  const m = marketPath(market);
  const sections: NavSection[] = [
    {
      title: "Market Workspace",
      items: [
        { label: "Markets", href: `/markets/${m}`, active: active === "overview" },
        { label: "Terminal", href: `/terminal/${m}`, active: active === "terminal" },
        { label: "Stock Screener", href: `/terminal/${m}/stocks`, active: active === "stock-screener" },
        { label: "Swing Candidates", href: `/terminal/${m}/screener`, active: active === "swing", badge: "Buy" },
      ],
    },
    {
      title: "Analysis",
      items: [
        { label: "Probability", href: `/terminal/${m}/probability`, active: active === "probability" },
        { label: "Forward Test", href: `/terminal/${m}/forward-test`, active: active === "forward-test" },
      ],
    },
    {
      title: "Portfolio",
      items: [
        { label: "Import Holdings", href: "/terminal/in/cas", active: active === "import-holdings", badge: market === "IN" ? undefined : "IN" },
        { label: "Fund Mapping", href: "/portfolio/fund-mapping", active: active === "fund-mapping", badge: market === "IN" ? undefined : "IN" },
        { label: "Fund X-Ray", href: "/terminal/in", active: false, muted: market !== "IN" },
      ],
    },
    {
      title: "Operations",
      items: [
        { label: "Data Health", href: "/data/health", active: active === "data", statusDot: "data-health" },
        { label: "Settings", href: "/settings", active: active === "settings" },
        { label: "Help", href: "/help" },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-[#05070d] text-white">
      <ApplyMarketTheme market={market} />
      <div className="lg:grid lg:min-h-screen lg:grid-cols-[248px_1fr]">
        <aside className="hidden border-r border-white/10 bg-black/20 lg:block">
          <div className="sticky top-0 flex h-screen flex-col px-4 py-5">
            <Link href="/" className="text-xl font-black tracking-tight">
              Investo<span className="text-[var(--ig-accent)]">Genie</span>
              <span className="mt-1 block text-[10px] uppercase tracking-[0.28em] text-white/35">
                {cfg.label}
              </span>
            </Link>

            <div className="mt-6">
              <MarketSwitch market={market} activeArea={active} />
            </div>

            <nav className="mt-7 flex-1 space-y-7">
              {sections.map((section) => (
                <div key={section.title}>
                  <div className="mb-2 px-2 text-[10px] font-bold uppercase tracking-[0.22em] text-white/28">
                    {section.title}
                  </div>
                  <div className="space-y-1">
                    {section.items.map((item) => (
                      <Link
                        key={`${section.title}:${item.label}`}
                        href={item.href}
                        className={cx(
                          "flex h-9 items-center justify-between rounded-lg px-3 text-sm transition-colors",
                          item.active
                            ? "bg-[var(--ig-accent)]/16 text-white shadow-[inset_3px_0_0_var(--ig-accent)]"
                            : "text-white/52 hover:bg-white/[0.06] hover:text-white",
                          item.muted && "opacity-45",
                        )}
                      >
                        <span>{item.label}</span>
                        <span className="flex items-center gap-2">
                        {item.statusDot === "data-health" && (
                          <Suspense fallback={<span className="h-2 w-2 rounded-full bg-white/20" />}>
                            <DataHealthDot />
                          </Suspense>
                        )}
                        {item.badge && (
                          <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] uppercase text-white/38">
                            {item.badge}
                          </span>
                        )}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </nav>

            {email && (
              <div className="border-t border-white/10 pt-4">
                <div className="truncate text-xs text-white/38">Signed in</div>
                <div className="truncate text-sm text-white/72">{email}</div>
                <form action={signout} className="mt-3">
                  <button
                    type="submit"
                    className="w-full rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-xs font-medium text-white/62 transition-colors hover:bg-white/[0.07] hover:text-white"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            )}
          </div>
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-30 border-b border-white/10 bg-[#05070d]/88 backdrop-blur-xl">
            <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-6">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <Link href="/" className="text-lg font-black tracking-tight lg:hidden">
                    Investo<span className="text-[var(--ig-accent)]">Genie</span>
                  </Link>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-white/45">
                    {cfg.flag} {cfg.label}
                  </span>
                </div>
                <h1 className="mt-2 truncate text-2xl font-black tracking-tight">{title}</h1>
                {subtitle && <p className="mt-1 max-w-3xl text-sm text-white/48">{subtitle}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-3">
                <div className="lg:hidden">
                  <MarketSwitch market={market} activeArea={active} />
                </div>
                {actions}
              </div>
            </div>
            <nav className="flex gap-1 overflow-x-auto border-t border-white/10 px-5 py-2 text-xs lg:hidden">
              {sections.flatMap((s) => s.items).map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className={cx(
                    "shrink-0 rounded-md px-3 py-1.5",
                    item.active ? "bg-[var(--ig-accent)] text-black" : "text-white/55 hover:bg-white/5 hover:text-white",
                    item.muted && "opacity-45",
                  )}
                >
                  <span>{item.label}</span>
                  {item.statusDot === "data-health" && (
                    <Suspense fallback={<span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-white/20" />}>
                      <DataHealthDot />
                    </Suspense>
                  )}
                </Link>
              ))}
            </nav>
          </header>

          <main className={cx("mx-auto px-5 py-8 lg:px-6", maxWidth)}>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
