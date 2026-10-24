"use client";
import { scaleLinear } from "@visx/scale";
import { useRef, useState } from "react";
import { formatMonthYear } from "@/lib/dates";

export interface MonthlyBar { month: string; spend: number; projectedExtra: number; isCurrent: boolean }
const label = (p: number) => `£${Math.round(p / 100).toLocaleString("en-GB")}`;

/** AN-07: the last six months as bars with the value above each; the current month is actual plus a hatched projected part. */
export function MonthlyBars({ bars, flagged, height = 170, ariaLabel }: { bars: MonthlyBar[]; flagged: boolean; height?: number; ariaLabel: string }) {
  const [w, setW] = useState(320);
  const ro = useRef<ResizeObserver | null>(null);
  const setRef = (el: SVGSVGElement | null) => { ro.current?.disconnect(); if (el) { ro.current = new ResizeObserver(() => setW(Math.max(220, el.clientWidth))); ro.current.observe(el); setW(Math.max(220, el.clientWidth)); } };
  const padT = 26, padB = 22;
  const ih = height - padT - padB;
  const top = Math.max(1, ...bars.map((b) => b.spend + b.projectedExtra));
  const y = scaleLinear<number>({ domain: [0, top], range: [padT + ih, padT] });
  const slot = w / bars.length, bw = Math.min(54, slot * 0.8);
  const cx = (i: number) => slot * i + slot / 2;
  return (
    <svg ref={setRef} width="100%" height={height} data-testid="monthly-bars" role="img" aria-label={ariaLabel} style={{ display: "block", overflow: "visible" }}>
      <defs><pattern id="hatch-mb" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--bg)" /><line x1="0" y1="0" x2="0" y2="6" stroke="var(--chart-ink)" strokeWidth="2.5" /></pattern></defs>
      {bars.map((b, i) => {
        const fill = b.isCurrent ? (flagged ? "var(--caution)" : "var(--chart-ink)") : "var(--chart-context)";
        const total = b.spend + b.projectedExtra;
        return (
          <g key={b.month}>
            <rect x={cx(i) - bw / 2} y={y(b.spend)} width={bw} height={Math.max(0, padT + ih - y(b.spend))} rx={4} fill={fill} />
            {b.projectedExtra > 0 && <rect x={cx(i) - bw / 2} y={y(total)} width={bw} height={Math.max(0, y(b.spend) - y(total))} rx={4} fill="url(#hatch-mb)" stroke="var(--chart-ink)" strokeWidth={1} />}
            <text x={cx(i)} y={y(total) - 7} textAnchor="middle" fontSize={12} fontWeight={b.isCurrent ? 700 : 500} fill={b.isCurrent ? "var(--ink)" : "var(--ink-2)"} className="num">{b.projectedExtra > 0 ? `≈ ${label(total)}` : label(total)}</text>
            <text x={cx(i)} y={height - 5} textAnchor="middle" fontSize={12} fill={b.isCurrent ? "var(--ink)" : "var(--ink-3)"} fontWeight={b.isCurrent ? 700 : 400}>{formatMonthYear(b.month).slice(0, 3)}</text>
          </g>
        );
      })}
    </svg>
  );
}
