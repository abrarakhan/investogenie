"use client";

import { useMemo, useState } from "react";
import { NUMERIC_FIELDS, FIELD_BY_KEY } from "@/lib/screener/fields";
import type { Filter, Operator } from "@/lib/screener/filterEngine";
import { PRESETS, type Preset } from "@/lib/screener/presets";

const OP_LABEL: Record<Operator, string> = {
  gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=", neq: "≠", between: "between", in: "in",
};
const NUMERIC_OP_CHOICES: Operator[] = ["gt", "gte", "lt", "lte", "eq", "between"];

function filterLabel(f: Filter): string {
  const def = FIELD_BY_KEY[f.field];
  if (!def) return `${f.field} ?`;
  if (f.op === "between" && Array.isArray(f.value)) return `${def.label} ${f.value[0]}–${f.value[1]}`;
  if (f.op === "in" && Array.isArray(f.value)) return `${def.label}: ${f.value.join(", ")}`;
  return `${def.label} ${OP_LABEL[f.op]} ${f.value}`;
}

export default function FilterPanel({
  sectors, activeFilters, onAddFilter, onRemoveFilter, onClearFilters, activePreset, onApplyPreset,
}: {
  sectors: string[];
  activeFilters: Filter[];
  onAddFilter: (f: Filter) => void;
  onRemoveFilter: (index: number) => void;
  onClearFilters: () => void;
  activePreset: string | null;
  onApplyPreset: (p: Preset) => void;
}) {
  const [field, setField] = useState(NUMERIC_FIELDS[0].key);
  const [op, setOp] = useState<Operator>("gt");
  const [v1, setV1] = useState("");
  const [v2, setV2] = useState("");
  const [sectorPick, setSectorPick] = useState<string[]>([]);

  const isSector = field === "sector";
  const grouped = useMemo(() => {
    return {
      "Price action": PRESETS.filter((p) => p.group === "Price action"),
      Fundamentals: PRESETS.filter((p) => p.group === "Fundamentals"),
    };
  }, []);

  const addNumeric = () => {
    const n1 = Number(v1);
    if (!Number.isFinite(n1)) return;
    if (op === "between") {
      const n2 = Number(v2);
      if (!Number.isFinite(n2)) return;
      onAddFilter({ field, op, value: [n1, n2] });
    } else {
      onAddFilter({ field, op, value: n1 });
    }
    setV1(""); setV2("");
  };

  const addSector = () => {
    if (sectorPick.length === 0) return;
    onAddFilter({ field: "sector", op: "in", value: sectorPick });
    setSectorPick([]);
  };

  return (
    <div className="space-y-4">
      {/* Presets */}
      <div className="space-y-2">
        {(Object.entries(grouped) as [string, Preset[]][]).map(([group, presets]) => (
          <div key={group} className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] uppercase tracking-wide text-white/30">{group}</span>
            {presets.map((p) => (
              <button
                key={p.key}
                title={p.description}
                onClick={() => onApplyPreset(p)}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  activePreset === p.key
                    ? "border-[var(--ig-accent,#22d3ee)] bg-[var(--ig-accent,#22d3ee)]/15 text-white"
                    : "border-white/10 text-white/60 hover:bg-white/5 hover:text-white"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Filter builder */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-3">
        <label className="flex flex-col gap-1 text-[11px] text-white/40">
          Field
          <select
            value={field}
            onChange={(e) => { setField(e.target.value); setOp(e.target.value === "sector" ? "in" : "gt"); }}
            className="rounded-md border border-white/10 bg-[#0a0e17] px-2 py-1.5 text-sm text-white/80"
          >
            <option value="sector">Sector</option>
            {NUMERIC_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </label>

        {isSector ? (
          <>
            <label className="flex flex-col gap-1 text-[11px] text-white/40">
              Sectors (multi)
              <select
                multiple
                value={sectorPick}
                onChange={(e) => setSectorPick(Array.from(e.target.selectedOptions, (o) => o.value))}
                className="h-24 min-w-[180px] rounded-md border border-white/10 bg-[#0a0e17] px-2 py-1 text-sm text-white/80"
              >
                {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <button onClick={addSector} className="rounded-md bg-[var(--ig-accent,#22d3ee)]/20 px-3 py-1.5 text-sm text-white hover:bg-[var(--ig-accent,#22d3ee)]/30">Add</button>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-[11px] text-white/40">
              Operator
              <select value={op} onChange={(e) => setOp(e.target.value as Operator)} className="rounded-md border border-white/10 bg-[#0a0e17] px-2 py-1.5 text-sm text-white/80">
                {NUMERIC_OP_CHOICES.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-white/40">
              {op === "between" ? "Min" : "Value"}
              <input value={v1} onChange={(e) => setV1(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addNumeric()} inputMode="decimal" className="w-24 rounded-md border border-white/10 bg-[#0a0e17] px-2 py-1.5 text-sm text-white/80" />
            </label>
            {op === "between" && (
              <label className="flex flex-col gap-1 text-[11px] text-white/40">
                Max
                <input value={v2} onChange={(e) => setV2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addNumeric()} inputMode="decimal" className="w-24 rounded-md border border-white/10 bg-[#0a0e17] px-2 py-1.5 text-sm text-white/80" />
              </label>
            )}
            <button onClick={addNumeric} className="rounded-md bg-[var(--ig-accent,#22d3ee)]/20 px-3 py-1.5 text-sm text-white hover:bg-[var(--ig-accent,#22d3ee)]/30">Add filter</button>
          </>
        )}
      </div>

      {/* Active filter chips */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-white/30">Active</span>
          {activeFilters.map((f, i) => (
            <span key={i} className="flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-white/70">
              {filterLabel(f)}
              <button onClick={() => onRemoveFilter(i)} className="text-white/40 hover:text-rose-400" aria-label="Remove">×</button>
            </span>
          ))}
          <button onClick={onClearFilters} className="ml-1 text-xs text-white/40 underline hover:text-white/70">clear all</button>
        </div>
      )}
    </div>
  );
}
