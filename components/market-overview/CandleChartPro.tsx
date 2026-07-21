"use client";

import { useMemo, useRef, useState } from "react";
import type { OverviewCandle } from "@/lib/marketOverview";

const W = 940;
const H = 380;
const PAD = { top: 20, right: 78, bottom: 30, left: 10 };
const VOL_H = 58;
const GAP = 14;
const PRICE_H = H - PAD.top - PAD.bottom - VOL_H - GAP;
const PLOT_W = W - PAD.left - PAD.right;
const PRICE_BOTTOM = PAD.top + PRICE_H;
const VOL_TOP = PRICE_BOTTOM + GAP;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function fmtDate(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return iso.slice(5);
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${match[3]} ${month}` : iso.slice(5);
}

function fmtPrice(value: number, currency: string): string {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    maximumFractionDigits: value < 100 ? 2 : 1,
  }).format(value);
}

function fmtVolume(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "-";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

export default function CandleChartPro({
  candle,
  accent,
  currency,
}: {
  candle: OverviewCandle;
  accent: string;
  currency: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const points = candle.points;

  const scale = useMemo(() => {
    const highs = points.map((p) => p.high).filter(Number.isFinite);
    const lows = points.map((p) => p.low).filter(Number.isFinite);
    const rawHigh = Math.max(...highs, 1);
    const rawLow = Math.min(...lows, rawHigh * 0.98);
    const pad = Math.max((rawHigh - rawLow) * 0.08, rawHigh * 0.002, 1e-6);
    const high = rawHigh + pad;
    const low = rawLow - pad;
    const maxVolume = Math.max(...points.map((p) => p.volume ?? 0), 1);
    return { high, low, maxVolume };
  }, [points]);

  const n = Math.max(points.length, 1);
  const slot = PLOT_W / n;
  const bodyW = Math.max(2, Math.min(12, slot * 0.58));
  const x = (i: number) => PAD.left + slot * i + slot / 2;
  const y = (value: number) => PAD.top + ((scale.high - value) / Math.max(1e-6, scale.high - scale.low)) * PRICE_H;
  const volY = (value: number | null) => VOL_TOP + VOL_H - ((value ?? 0) / scale.maxVolume) * VOL_H;

  const priceTicks = useMemo(
    () => [0, 0.25, 0.5, 0.75, 1].map((r) => scale.high - r * (scale.high - scale.low)),
    [scale.high, scale.low],
  );

  const dateTicks = useMemo(() => {
    if (!points.length) return [];
    const count = Math.min(6, points.length);
    return Array.from({ length: count }, (_, k) => {
      const idx = Math.round((k / Math.max(1, count - 1)) * (points.length - 1));
      return { idx, label: fmtDate(points[idx]?.date ?? "") };
    });
  }, [points]);

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    const ratio = (e.clientX - box.left) / box.width;
    const px = ratio * W;
    const idx = Math.round((px - PAD.left - slot / 2) / slot);
    setHoverIdx(Math.max(0, Math.min(points.length - 1, idx)));
  };

  const latest = points[points.length - 1];
  const hovered = hoverIdx === null ? latest : points[hoverIdx];
  const priceColor = latest && latest.close >= latest.open ? "#35d399" : "#ff6b76";
  const latestY = latest ? y(latest.close) : null;
  const hoverX = hoverIdx === null ? null : x(hoverIdx);

  return (
    <div className="relative w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="h-[380px] w-full select-none"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
        role="img"
        aria-label={`${candle.ticker} candlestick chart`}
      >
        <defs>
          <linearGradient id="igCandleVolumeFade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.28" />
            <stop offset="100%" stopColor={accent} stopOpacity="0.04" />
          </linearGradient>
        </defs>

        {priceTicks.map((tick) => (
          <g key={`pt${tick}`}>
            <line x1={PAD.left} x2={PAD.left + PLOT_W} y1={y(tick)} y2={y(tick)} stroke="#232a32" strokeDasharray="3 5" />
            <text x={W - PAD.right + 8} y={y(tick) + 4} fill="#7d8894" fontSize="11" fontFamily="ui-monospace, SFMono-Regular, monospace">
              {fmtPrice(tick, currency)}
            </text>
          </g>
        ))}

        {dateTicks.map((tick) => (
          <line key={`vt${tick.idx}`} x1={x(tick.idx)} x2={x(tick.idx)} y1={PAD.top} y2={VOL_TOP + VOL_H} stroke="#1c222a" />
        ))}

        <line x1={PAD.left} x2={PAD.left + PLOT_W} y1={PRICE_BOTTOM} y2={PRICE_BOTTOM} stroke="#2b333d" />
        <line x1={PAD.left} x2={PAD.left + PLOT_W} y1={VOL_TOP} y2={VOL_TOP} stroke="#1d242c" />

        {points.map((point, i) => {
          const up = point.close >= point.open;
          const color = up ? "#35d399" : "#ff6b76";
          const bodyTop = y(Math.max(point.open, point.close));
          const bodyBottom = y(Math.min(point.open, point.close));
          const bodyH = Math.max(1.5, bodyBottom - bodyTop);
          const vx = x(i) - bodyW / 2;
          const vy = volY(point.volume);
          return (
            <g key={`${point.date}-${i}`} opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.72}>
              <rect x={vx} y={vy} width={bodyW} height={VOL_TOP + VOL_H - vy} rx="1" fill={up ? "#35d399" : "#ff6b76"} opacity="0.28" />
              <line x1={x(i)} x2={x(i)} y1={y(point.high)} y2={y(point.low)} stroke={color} strokeWidth="1.2" />
              <rect x={vx} y={bodyTop} width={bodyW} height={bodyH} rx="1.5" fill={up ? color : "#0d1115"} stroke={color} strokeWidth="1.3" />
            </g>
          );
        })}

        {latestY !== null && latest && (
          <g>
            <line x1={PAD.left} x2={PAD.left + PLOT_W} y1={latestY} y2={latestY} stroke={priceColor} strokeDasharray="4 5" opacity="0.55" />
            <rect x={W - PAD.right + 3} y={latestY - 10} width={70} height={20} rx="3" fill={priceColor} />
            <text x={W - PAD.right + 38} y={latestY + 4} textAnchor="middle" fontSize="11" fontWeight="800" fill="#080c10" fontFamily="ui-monospace, SFMono-Regular, monospace">
              {fmtPrice(latest.close, currency)}
            </text>
          </g>
        )}

        {hoverX !== null && hovered && (
          <g>
            <line x1={hoverX} x2={hoverX} y1={PAD.top} y2={VOL_TOP + VOL_H} stroke="#8b97a4" strokeDasharray="4 4" />
            <line x1={PAD.left} x2={PAD.left + PLOT_W} y1={y(hovered.close)} y2={y(hovered.close)} stroke="#8b97a4" strokeDasharray="4 4" opacity="0.5" />
          </g>
        )}

        {dateTicks.map((tick) => (
          <text key={`dl${tick.idx}`} x={x(tick.idx)} y={H - 8} textAnchor="middle" fill="#6b7683" fontSize="10.5" fontFamily="ui-monospace, SFMono-Regular, monospace">
            {tick.label}
          </text>
        ))}

        <rect x={PAD.left} y={VOL_TOP} width={PLOT_W} height={VOL_H} fill="url(#igCandleVolumeFade)" opacity="0.18" />
      </svg>

      {hovered && (
        <div className="pointer-events-none absolute left-3 top-2 z-10 rounded-md border border-[#2b333d] bg-[#0d1115]/95 px-2.5 py-2 shadow-xl backdrop-blur">
          <div className="mb-1 flex items-center gap-2 font-mono text-[10px] text-white/45">
            <span>{candle.ticker}</span>
            <span>{fmtDate(hovered.date)}</span>
          </div>
          <div className="grid grid-cols-5 gap-2 text-[10px] uppercase tracking-wider text-white/35">
            <span>O <b className="font-mono text-white/85">{fmtPrice(hovered.open, currency)}</b></span>
            <span>H <b className="font-mono text-[#35d399]">{fmtPrice(hovered.high, currency)}</b></span>
            <span>L <b className="font-mono text-[#ff6b76]">{fmtPrice(hovered.low, currency)}</b></span>
            <span>C <b className="font-mono text-white/85">{fmtPrice(hovered.close, currency)}</b></span>
            <span>V <b className="font-mono text-white/85">{fmtVolume(hovered.volume)}</b></span>
          </div>
        </div>
      )}
    </div>
  );
}
