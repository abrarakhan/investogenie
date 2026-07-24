import Link from "next/link";
import type { ReactNode } from "react";

/** Shared chrome for every Help / knowledge-base page (public, no auth). */
export function HelpShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-[#05070d] text-white">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-[#05070d]/85 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link href="/" className="text-lg font-black tracking-tight">
            Investo<span className="text-cyan-300">Genie</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm text-white/60">
            <Link href="/help" className="hover:text-white">Help</Link>
            <Link href="/terminal/in" className="rounded-full border border-white/15 px-4 py-1.5 hover:bg-white/10 hover:text-white">
              Open Terminal
            </Link>
          </nav>
        </div>
      </header>
      {children}
      <footer className="border-t border-white/10 px-6 py-10">
        <div className="mx-auto max-w-3xl text-xs leading-relaxed text-white/35">
          InvestoGenie is a research and education tool. Nothing here is investment advice, a
          recommendation, or a solicitation to buy or sell any security. Strategy write-ups
          describe how the app computes its signals; they are adaptations of publicly documented
          methods, not the original authors&apos; proprietary systems. Markets involve risk of loss.
        </div>
      </footer>
    </main>
  );
}

/** Article container with a consistent measure and vertical rhythm. */
export function Article({ children }: { children: ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-6 py-12 sm:py-16">{children}</article>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">{children}</p>;
}

export function Title({ children }: { children: ReactNode }) {
  return <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">{children}</h1>;
}

export function Lede({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-lg leading-relaxed text-white/60">{children}</p>;
}

export function Meta({ items }: { items: string[] }) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/40">
      {items.map((it, i) => (
        <span key={it} className="flex items-center gap-3">
          {i > 0 && <span className="text-white/20">•</span>}
          {it}
        </span>
      ))}
    </div>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 className="mt-12 border-b border-white/10 pb-2 text-2xl font-bold tracking-tight">{children}</h2>;
}

export function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-8 text-lg font-semibold text-white/90">{children}</h3>;
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mt-4 leading-relaxed text-white/70">{children}</p>;
}

export function UL({ children }: { children: ReactNode }) {
  return <ul className="mt-4 space-y-2 pl-5 text-white/70 marker:text-cyan-300/70 [list-style:disc]">{children}</ul>;
}

export function LI({ children }: { children: ReactNode }) {
  return <li className="leading-relaxed">{children}</li>;
}

/** Numbered walkthrough steps. */
export function Steps({ items }: { items: { title: string; body: ReactNode }[] }) {
  return (
    <ol className="mt-6 space-y-4">
      {items.map((s, i) => (
        <li key={s.title} className="flex gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-300/15 text-sm font-bold text-cyan-300">
            {i + 1}
          </span>
          <div>
            <div className="font-semibold text-white/90">{s.title}</div>
            <div className="mt-1 text-sm leading-relaxed text-white/60">{s.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A monospace formula / rule block. */
export function Formula({ children }: { children: ReactNode }) {
  return (
    <pre className="mt-4 overflow-x-auto rounded-lg border border-white/10 bg-black/50 px-4 py-3 font-mono text-sm leading-relaxed text-cyan-100/90">
      {children}
    </pre>
  );
}

export function Callout({ tone = "info", children }: { tone?: "info" | "warn"; children: ReactNode }) {
  const styles =
    tone === "warn"
      ? "border-amber-400/30 bg-amber-400/[0.06] text-amber-100/80"
      : "border-cyan-300/25 bg-cyan-300/[0.05] text-cyan-50/80";
  return <div className={`mt-6 rounded-lg border px-4 py-3 text-sm leading-relaxed ${styles}`}>{children}</div>;
}

/** "What the app computes" spec table: term → definition. */
export function SpecTable({ rows }: { rows: { k: ReactNode; v: ReactNode }[] }) {
  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-white/8 align-top">
              <td className="w-[42%] py-3 pr-4 font-mono text-cyan-200/85">{r.k}</td>
              <td className="py-3 text-white/70">{r.v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function References({ items }: { items: { text: ReactNode; note?: string }[] }) {
  return (
    <>
      <H2>Origins &amp; further reading</H2>
      <ol className="mt-4 space-y-3 text-sm text-white/60">
        {items.map((r, i) => (
          <li key={i} className="flex gap-3">
            <span className="font-mono text-white/30">[{i + 1}]</span>
            <span className="leading-relaxed">
              {r.text}
              {r.note && <span className="block text-white/40">{r.note}</span>}
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

export function ArticleFooterNav() {
  return (
    <div className="mt-14 border-t border-white/10 pt-6">
      <Link href="/help" className="text-sm text-cyan-300 hover:text-cyan-200">← Back to Help</Link>
    </div>
  );
}
