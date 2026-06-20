"use client";

import { useEffect, useRef, useState } from "react";

interface Result {
  id: string;
  ticker: string;
  name: string | null;
  exchange: string | null;
  country: string;
  assetClass: string;
  currency: string;
  price: number | null;
  changePct: number | null;
}

/**
 * Typeahead asset picker over the full catalog. Writes the chosen asset's id
 * into a hidden input named `name`, so it plugs into the existing server-action
 * forms without any extra wiring.
 */
export default function AssetPicker({
  name,
  placeholder = "Search ticker…",
  country,
}: {
  name: string;
  placeholder?: string;
  country?: "US" | "IN";
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [selected, setSelected] = useState<Result | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced search. All state updates run inside the debounce callback (never
  // synchronously in the effect body) per react-hooks/set-state-in-effect.
  useEffect(() => {
    if (selected && query === selected.ticker) return;
    const q = query.trim();
    const t = setTimeout(async () => {
      if (q.length < 1) { setResults([]); return; }
      try {
        const cc = country ? `&country=${country}` : "";
        const res = await fetch(`/api/assets/search?q=${encodeURIComponent(q)}${cc}`);
        const json = await res.json();
        setResults(json.results ?? []);
        setOpen(true);
      } catch { /* ignore */ }
    }, 180);
    return () => clearTimeout(t);
  }, [query, selected, country]);

  // Close on outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function choose(r: Result) {
    setSelected(r);
    setQuery(r.ticker);
    setOpen(false);
  }

  return (
    <div ref={boxRef} className="relative">
      <input type="hidden" name={name} value={selected?.id ?? ""} />
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
        onFocus={() => results.length && setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:border-[var(--ig-primary)]"
      />
      {open && results.length > 0 && (
        <ul className="absolute z-40 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-white/10 bg-[#0b0f18] shadow-2xl">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => choose(r)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-white/5"
              >
                <span className="min-w-0">
                  <span className="font-semibold">{r.ticker}</span>
                  <span className="ml-2 text-[10px] uppercase text-white/30">
                    {r.country === "US" ? "🇺🇸" : "🇮🇳"} {r.exchange}
                  </span>
                  <span className="block truncate text-xs text-white/40">{r.name}</span>
                </span>
                {r.price !== null && (
                  <span className="shrink-0 text-right tabular-nums">
                    <span className="text-white/80">
                      {r.currency === "INR" ? "₹" : "$"}
                      {r.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>
                    {r.changePct !== null && (
                      <span className={`block text-[10px] ${r.changePct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {r.changePct >= 0 ? "+" : ""}{r.changePct.toFixed(2)}%
                      </span>
                    )}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
