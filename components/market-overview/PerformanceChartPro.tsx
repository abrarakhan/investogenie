"use client";

import { useMemo, useRef, useState } from "react";

// -----------------------------------------------------------------------------
// TradingView-style normalized performance chart. Pure SVG: crisp at any DPI,
// no WebGL, no runtime deps.
//
// Conventions borrowed from a real trading terminal:
//   * price scale on the RIGHT, with a live colour-coded tag per series
//   * full crosshair that snaps to the nearest sample, with a floating readout
//   * gradient area fill under each line, emphasised 0% baseline
//   * smooth (monotone-ish cubic) curves and an animated draw-in
// -----------------------------------------------------------------------------

export interface ChartLine {
  ticker: string;
  points: { date: string; value: number }[];
}

const W = 940;
const H = 340;
const PAD = { top: 18, right: 68, bottom: 26, left: 10 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

const fmtPct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(5);
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

/** Catmull-Rom -> cubic bezier, so the curve stays smooth without overshooting
 *  into visually false highs/lows between samples. */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length < 3) return pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const t = 0.2; // tension: low = tight to the data
    const c1x = p1.x + (p2.x - p0.x) * t;
    const c1y = p1.y + (p2.y - p0.y) * t;
    const c2x = p2.x - (p3.x - p1.x) * t;
    const c2y = p2.y - (p3.y - p1.y) * t;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
  }
  return d;
}

export default function PerformanceChartPro({
  lines,
  colors,
  focus,
  onFocus,
}: {
  lines: ChartLine[];
  colors: readonly string[];
  focus: string | null;
  onFocus: (ticker: string | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const maxLen = Math.max(1, ...lines.map((l) => l.points.length));
  const values = lines.flatMap((l) => l.points.map((p) => p.value));
  const rawLow = Math.min(-1, ...values);
  const rawHigh = Math.max(1, ...values);
  const pad = (rawHigh - rawLow) * 0.12 || 1;
  const low = rawLow - pad;
  const high = rawHigh + pad;

  const x = (i: number) => PAD.left + (i / Math.max(1, maxLen - 1)) * PLOT_W;
  const y = (v: number) => PAD.top + ((high - v) / Math.max(1e-6, high - low)) * PLOT_H;

  const ticks = useMemo(
    () => [0, 0.25, 0.5, 0.75, 1].map((r) => high - r * (high - low)),
    [low, high],
  );

  const series = useMemo(
    () =>
      lines.map((line, i) => {
        const pts = line.points.map((p, idx) => ({ x: x(idx), y: y(p.value) }));
        return {
          ticker: line.ticker,
          color: colors[i % colors.length],
          points: line.points,
          path: smoothPath(pts),
          area: `${smoothPath(pts)} L${pts[pts.length - 1]?.x ?? 0},${PAD.top + PLOT_H} L${pts[0]?.x ?? 0},${PAD.top + PLOT_H} Z`,
          last: line.points[line.points.length - 1]?.value ?? 0,
          lastPt: pts[pts.length - 1],
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, colors, low, high, maxLen],
  );

  // Date ticks: ~6 evenly spaced labels from the longest series.
  const dateTicks = useMemo(() => {
    const src = lines.reduce((a, b) => (b.points.length > a.points.length ? b : a), lines[0]);
    if (!src) return [];
    const n = src.points.length;
    const count = Math.min(6, n);
    return Array.from({ length: count }, (_, k) => {
      const idx = Math.round((k / Math.max(1, count - 1)) * (n - 1));
      return { idx, label: fmtDate(src.points[idx]?.date ?? "") };
    });
  }, [lines]);

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    const ratio = (e.clientX - box.left) / box.width;
    const px = ratio * W;
    const idx = Math.round(((px - PAD.left) / PLOT_W) * (maxLen - 1));
    setHoverIdx(Math.max(0, Math.min(maxLen - 1, idx)));
  };

  const hoverX = hoverIdx === null ? null : x(hoverIdx);
  const hoverDate = hoverIdx === null ? null : lines[0]?.points[hoverIdx]?.date ?? null;

  return (
    <div className="relative w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="h-[340px] w-full select-none"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
        role="img"
        aria-label="Normalized performance"
      >
        <defs>
          {series.map((s) => (
            <linearGradient key={`g${s.ticker}`} id={`fill-${s.ticker}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.28" />
              <stop offset="60%" stopColor={s.color} stopOpacity="0.06" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
          <filter id="lineGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Horizontal grid + right-hand price scale */}
        {ticks.map((t) => {
          const isZero = Math.abs(t) < 1e-9;
          return (
            <g key={`t${t}`}>
              <line
                x1={PAD.left}
                x2={PAD.left + PLOT_W}
                y1={y(t)}
                y2={y(t)}
                stroke={isZero ? "#5a6673" : "#232a32"}
                strokeWidth="1"
                strokeDasharray={isZero ? "none" : "3 5"}
              />
              <text
                x={W - PAD.right + 8}
                y={y(t) + 3.5}
                fill="#7d8894"
                fontSize="11"
                fontFamily="ui-monospace, SFMono-Regular, monospace"
              >
                {t.toFixed(1)}%
              </text>
            </g>
          );
        })}

        {/* Vertical grid at the date ticks */}
        {dateTicks.map((d) => (
          <line
            key={`v${d.idx}`}
            x1={x(d.idx)}
            x2={x(d.idx)}
            y1={PAD.top}
            y2={PAD.top + PLOT_H}
            stroke="#1c222a"
            strokeWidth="1"
          />
        ))}

        {/* Series: gradient area + glowing line */}
        {series.map((s) => {
          const dim = focus !== null && focus !== s.ticker;
          return (
            <g key={s.ticker} opacity={dim ? 0.18 : 1} style={{ transition: "opacity 160ms" }}>
              <path d={s.area} fill={`url(#fill-${s.ticker})`} />
              <path
                d={s.path}
                fill="none"
                stroke={s.color}
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter={dim ? undefined : "url(#lineGlow)"}
                pathLength={1}
                style={{
                  strokeDasharray: 1,
                  animation: "igDraw 900ms cubic-bezier(0.22,1,0.36,1) forwards",
                }}
              />
            </g>
          );
        })}

        {/* Crosshair */}
        {hoverX !== null && (
          <line
            x1={hoverX}
            x2={hoverX}
            y1={PAD.top}
            y2={PAD.top + PLOT_H}
            stroke="#8b97a4"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
        )}

        {/* Marker dots at the crosshair */}
        {hoverIdx !== null &&
          series.map((s) => {
            const p = s.points[hoverIdx];
            if (!p) return null;
            return (
              <circle
                key={`d${s.ticker}`}
                cx={x(hoverIdx)}
                cy={y(p.value)}
                r="4"
                fill="#0d1115"
                stroke={s.color}
                strokeWidth="2"
              />
            );
          })}

        {/* Live value tag on the price scale — the TradingView tell. */}
        {series.map((s) => {
          if (!s.lastPt) return null;
          const shown = hoverIdx !== null ? s.points[hoverIdx]?.value ?? s.last : s.last;
          const ty = hoverIdx !== null ? y(s.points[hoverIdx]?.value ?? s.last) : s.lastPt.y;
          return (
            <g key={`tag${s.ticker}`} opacity={focus !== null && focus !== s.ticker ? 0.25 : 1}>
              <rect x={W - PAD.right + 3} y={ty - 9} width={60} height={18} rx="3" fill={s.color} />
              <text
                x={W - PAD.right + 33}
                y={ty + 4}
                textAnchor="middle"
                fontSize="11"
                fontWeight="700"
                fill="#080c10"
                fontFamily="ui-monospace, SFMono-Regular, monospace"
              >
                {fmtPct(shown)}
              </text>
            </g>
          );
        })}

        {/* Date scale */}
        {dateTicks.map((d) => (
          <text
            key={`dl${d.idx}`}
            x={x(d.idx)}
            y={H - 8}
            textAnchor="middle"
            fill="#6b7683"
            fontSize="10.5"
            fontFamily="ui-monospace, SFMono-Regular, monospace"
          >
            {d.label}
          </text>
        ))}

        <style>{`@keyframes igDraw { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }`}</style>
      </svg>

      {/* Floating crosshair readout */}
      {hoverIdx !== null && (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-md border border-[#2b333d] bg-[#0d1115]/95 px-2.5 py-2 shadow-xl backdrop-blur"
          style={{
            left: `calc(${((hoverX ?? 0) / W) * 100}% + 12px)`,
            transform: (hoverX ?? 0) > W * 0.62 ? "translateX(calc(-100% - 24px))" : undefined,
          }}
        >
          {hoverDate && (
            <div className="mb-1 font-mono text-[10px] text-white/40">{fmtDate(hoverDate)}</div>
          )}
          {series.map((s) => (
            <div
              key={`r${s.ticker}`}
              className="flex items-center gap-2 whitespace-nowrap text-[11px] leading-5"
              onMouseEnter={() => onFocus(s.ticker)}
            >
              <i className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
              <span className="text-white/55">{s.ticker}</span>
              <b className="ml-auto font-mono tabular-nums text-white/90">
                {fmtPct(s.points[hoverIdx]?.value ?? 0)}
              </b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
