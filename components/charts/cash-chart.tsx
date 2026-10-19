"use client";
import { scaleLinear } from "@visx/scale";
import { useRef, useState } from "react";
import { formatShort, type ISODate } from "@/lib/dates";
import { formatGBP } from "@/lib/money";

export interface CashPoint { day: ISODate; cash_pence: number }

const compact = (p: number) => {
  const pounds = Math.round(p / 100);
  const abs = Math.abs(pounds);
  return `${pounds < 0 ? "−" : ""}£${abs >= 1000 ? `${Math.round(abs / 100) / 10}`.replace(/\.0$/, "") + "k" : abs}`;
};

/**
 * AN / S7: available cash by day. One ink line, grey context, direct labels. Press and drag (or use the arrow keys)
 * to read the cash on any day; the selection drives the figure above it (CASH-03).
 */
export function CashChart({ points, selected, onSelect, height = 190, label }: {
  points: CashPoint[]; selected: ISODate; onSelect: (d: ISODate) => void; height?: number; label: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [w, setW] = useState(320);
  const roRef = useRef<ResizeObserver | null>(null);
  const setRef = (el: SVGSVGElement | null) => {
    ref.current = el;
    roRef.current?.disconnect();
    if (el) { roRef.current = new ResizeObserver(() => setW(Math.max(200, el.clientWidth))); roRef.current.observe(el); setW(Math.max(200, el.clientWidth)); }
  };
  if (points.length < 2) return <div className="sub" style={{ height }}>Not enough days to draw yet.</div>;

  const padL = 4, padR = 40, padT = 34, padB = 26;
  const iw = w - padL - padR, ih = height - padT - padB;
  const vals = points.map((p) => p.cash_pence);
  const y = scaleLinear<number>({ domain: [Math.min(...vals), Math.max(...vals)], range: [padT + ih, padT], nice: true });
  const x = (i: number) => padL + (i / (points.length - 1)) * iw;
  const ticks = y.ticks(3);
  const selIdx = Math.max(0, points.findIndex((p) => p.day === selected));
  const sel = points[selIdx]!;
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.cash_pence).toFixed(1)}`).join(" ");

  const pick = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const i = Math.round(((clientX - r.left - padL) / iw) * (points.length - 1));
    onSelect(points[Math.min(points.length - 1, Math.max(0, i))]!.day);
  };
  const tipX = Math.min(Math.max(x(selIdx), 66), w - padR - 40);

  return (
    <svg
      ref={setRef} width="100%" height={height} role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={points.length - 1} aria-valuenow={selIdx}
      aria-valuetext={`${formatShort(sel.day)}: ${formatGBP(sel.cash_pence)}`} className="chart" data-testid="cash-chart"
      style={{ touchAction: "pan-y", cursor: "ew-resize", display: "block", overflow: "visible", outline: "none" }}
      onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); pick(e.clientX); }}
      onPointerMove={(e) => { if (e.buttons || e.pointerType === "touch") pick(e.clientX); }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") { e.preventDefault(); onSelect(points[Math.max(0, selIdx - 1)]!.day); }
        if (e.key === "ArrowRight") { e.preventDefault(); onSelect(points[Math.min(points.length - 1, selIdx + 1)]!.day); }
        if (e.key === "Home") onSelect(points[0]!.day);
        if (e.key === "End") onSelect(points[points.length - 1]!.day);
      }}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="var(--rule)" />
          <text x={w - padR + 8} y={y(t) + 4} fontSize={11} fill="var(--ink-3)">{compact(t)}</text>
        </g>
      ))}
      <path d={`${d} L${x(points.length - 1)},${padT + ih} L${x(0)},${padT + ih} Z`} fill="var(--chart-fill)" />
      <path d={d} fill="none" stroke="var(--chart-ink)" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
      <line x1={x(selIdx)} x2={x(selIdx)} y1={padT - 2} y2={padT + ih} stroke="var(--ink-3)" strokeWidth={1} />
      <circle cx={x(selIdx)} cy={y(sel.cash_pence)} r={6} fill="var(--bg)" stroke="var(--chart-ink)" strokeWidth={2.25} />
      <g transform={`translate(${tipX},0)`} aria-hidden>
        <rect x={-54} y={0} width={108} height={36} rx={10} fill="var(--ink)" />
        <text x={0} y={14} textAnchor="middle" fontSize={11} fill="var(--on-ink)" opacity={0.7}>{formatShort(sel.day)}</text>
        <text x={0} y={29} textAnchor="middle" fontSize={13} fontWeight={600} fill="var(--on-ink)">{formatGBP(sel.cash_pence)}</text>
      </g>
      <text x={padL} y={height - 6} fontSize={11} fill="var(--ink-3)">{formatShort(points[0]!.day).split(" ").slice(1).join(" ")}</text>
      <text x={padL + iw / 2} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--ink-3)">{points[Math.floor(points.length / 2)]!.day.slice(8).replace(/^0/, "")}</text>
      <text x={padL + iw} y={height - 6} textAnchor="end" fontSize={11} fill="var(--ink-3)">{points[points.length - 1]!.day.slice(8).replace(/^0/, "")}</text>
    </svg>
  );
}
