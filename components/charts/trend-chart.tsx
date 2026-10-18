"use client";
import { scaleLinear } from "@visx/scale";
import { motion } from "motion/react";
import { useRef, useState } from "react";
import { formatMonthYear } from "@/lib/dates";
import { formatGBP } from "@/lib/money";
import type { TrendBar } from "@/lib/analytics";

const compact = (p: number) => { const n = Math.round(p / 100); return n >= 1000 ? `£${Math.round(n / 100) / 10}k`.replace(".0k", "k") : `£${n}`; };

/** AN-04: monthly spend for twelve months; the current month is actual plus a hatched projected part; an average line; income optional. */
export function TrendChart({ bars, avg, showIncome, height = 190 }: { bars: TrendBar[]; avg: number; showIncome: boolean; height?: number }) {
  const [sel, setSel] = useState<number | null>(null);
  const [w, setW] = useState(320);
  const ro = useRef<ResizeObserver | null>(null);
  const setRef = (el: SVGSVGElement | null) => { ro.current?.disconnect(); if (el) { ro.current = new ResizeObserver(() => setW(Math.max(220, el.clientWidth))); ro.current.observe(el); setW(Math.max(220, el.clientWidth)); } };
  const padL = 4, padR = 4, padT = 22, padB = 22;
  const iw = w - padL - padR, ih = height - padT - padB;
  const top = Math.max(1, ...bars.map((b) => Math.max(b.spend + b.projectedExtra, showIncome ? b.income : 0)), avg);
  const y = scaleLinear<number>({ domain: [0, top], range: [padT + ih, padT], nice: true });
  const slot = iw / bars.length, bw = Math.min(22, slot * 0.64);
  const cx = (i: number) => padL + slot * i + slot / 2;
  const incomePath = bars.map((b, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)},${y(b.income).toFixed(1)}`).join(" ");
  const cur = bars.findIndex((b) => b.isCurrent);
  const hi = sel ?? (cur >= 0 ? cur : null);
  return (
    <svg ref={setRef} width="100%" height={height} className="chart" data-testid="trend-chart" role="img" aria-label="Monthly spend for the last twelve months" style={{ overflow: "visible", display: "block" }}>
      <defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--bg)" /><line x1="0" y1="0" x2="0" y2="6" stroke="var(--chart-ink)" strokeWidth="2.5" /></pattern></defs>
      {y.ticks(2).filter((t) => t > 0).map((t) => (<g key={t}><line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="var(--rule)" /><text x={padL} y={y(t) - 5} fontSize={11} fill="var(--ink-3)">{compact(t)}</text></g>))}
      {bars.map((b, i) => (
        <g key={b.month} onPointerDown={() => setSel(i)} onMouseEnter={() => setSel(i)} style={{ cursor: "pointer" }}>
          <rect x={cx(i) - slot / 2} y={padT} width={slot} height={ih} fill="transparent" />
          <motion.rect x={cx(i) - bw / 2} width={bw} rx={3} fill={b.isCurrent ? "var(--chart-ink)" : "var(--chart-context)"}
            initial={{ y: padT + ih, height: 0 }} animate={{ y: y(b.spend), height: Math.max(0, padT + ih - y(b.spend)) }} transition={{ type: "spring", duration: 0.28, bounce: 0 }} />
          {b.projectedExtra > 0 && <rect x={cx(i) - bw / 2} y={y(b.spend + b.projectedExtra)} width={bw} height={Math.max(0, y(b.spend) - y(b.spend + b.projectedExtra))} rx={3} fill="url(#hatch)" stroke="var(--chart-ink)" strokeWidth={1} />}
          <text x={cx(i)} y={height - 6} textAnchor="middle" fontSize={11} fill={b.isCurrent ? "var(--ink)" : "var(--ink-3)"} fontWeight={b.isCurrent ? 600 : 400}>{formatMonthYear(b.month).charAt(0)}</text>
        </g>
      ))}
      {avg > 0 && <><line x1={padL} x2={w - padR} y1={y(avg)} y2={y(avg)} stroke="var(--ink-3)" strokeDasharray="3 3" /><text x={w - padR} y={y(avg) - 5} textAnchor="end" fontSize={11} fill="var(--ink-2)">Average {formatGBP(avg, { whole: true })}</text></>}
      {showIncome && <path d={incomePath} fill="none" stroke="var(--positive)" strokeWidth={2} strokeLinejoin="round" />}
      {hi !== null && bars[hi] && (
        <g aria-hidden transform={`translate(${Math.min(Math.max(cx(hi), 60), w - 60)},0)`}>
          <rect x={-56} y={0} width={112} height={showIncome ? 34 : 20} rx={8} fill="var(--ink)" />
          <text x={0} y={14} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--on-ink)">{formatMonthYear(bars[hi]!.month).slice(0, 3)} {formatGBP(bars[hi]!.spend + bars[hi]!.projectedExtra, { whole: true })}{bars[hi]!.projectedExtra ? " (proj.)" : ""}</text>
          {showIncome && <text x={0} y={27} textAnchor="middle" fontSize={11} fill="var(--on-ink)" opacity={0.7}>In {formatGBP(bars[hi]!.income, { whole: true })}</text>}
        </g>
      )}
    </svg>
  );
}
