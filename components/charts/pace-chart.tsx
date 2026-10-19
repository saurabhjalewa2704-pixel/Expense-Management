"use client";
import { scaleLinear } from "@visx/scale";
import { motion } from "motion/react";
import { useRef, useState } from "react";
import { diffDays, formatDayMonth, addDays, type ISODate } from "@/lib/dates";
import { formatGBP, type Pence } from "@/lib/money";
import type { DailySpend } from "@/lib/types";

const compact = (p: number) => { const n = Math.round(p / 100); return n === 0 ? "£0" : n >= 1000 ? `£${Math.round(n / 100) / 10}k`.replace(".0k", "k") : `£${n}`; };

/**
 * AN-01, the signature chart: cumulative spend this period (ink, solid, ending today with a dot) against the previous
 * period (grey, whole). The gap at today is annotated. Press and drag to read any day.
 */
export function PaceChart({ from, to, today, cur, prev, prevFrom, prevLabel, curLabel, height = 190 }: {
  from: ISODate; to: ISODate; today: ISODate; cur: DailySpend[]; prev: DailySpend[]; prevFrom: ISODate; prevLabel: string; curLabel: string; height?: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [w, setW] = useState(320);
  const [hover, setHover] = useState<number | null>(null);
  const ro = useRef<ResizeObserver | null>(null);
  const setRef = (el: SVGSVGElement | null) => { ref.current = el; ro.current?.disconnect(); if (el) { ro.current = new ResizeObserver(() => setW(Math.max(220, el.clientWidth))); ro.current.observe(el); setW(Math.max(220, el.clientWidth)); } };

  const n = Math.max(cur.length, prev.length, 2);
  const elapsed = cur.length;
  const padL = 4, padR = 14, padT = 18, padB = 26;
  const iw = w - padL - padR, ih = height - padT - padB;
  const max = Math.max(1, ...cur.map((d) => d.cumulative_pence), ...prev.map((d) => d.cumulative_pence));
  const y = scaleLinear<number>({ domain: [0, max], range: [padT + ih, padT], nice: true });
  const x = (i: number) => padL + (i / (n - 1)) * iw;
  const path = (rows: DailySpend[]) => rows.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.cumulative_pence).toFixed(1)}`).join(" ");
  const ticks = y.ticks(2).filter((t) => t > 0);
  const last = cur[elapsed - 1];
  const prevAt = prev[Math.min(elapsed, prev.length) - 1];
  const gap = last && prevAt ? prevAt.cumulative_pence - last.cumulative_pence : 0;
  const idx = hover ?? null;
  const pick = (clientX: number) => { const r = ref.current!.getBoundingClientRect(); setHover(Math.min(n - 1, Math.max(0, Math.round(((clientX - r.left - padL) / iw) * (n - 1))))); };
  const todayIdx = Math.max(0, diffDays(today, from));
  const tick = (i: number) => (i === 0 ? formatDayMonth(from) : String(Number(addDays(from, i).slice(8))));
  const showToday = todayIdx > 0 && todayIdx < n - 1 && today <= to;

  return (
    <div>
      <svg ref={setRef} width="100%" height={height} className="chart" data-testid="pace-chart" role="img"
        aria-label={`Cumulative spend: ${curLabel} ${last ? formatGBP(last.cumulative_pence) : "£0.00"}, ${prevLabel} at the same point ${prevAt ? formatGBP(prevAt.cumulative_pence) : "£0.00"}`}
        style={{ touchAction: "pan-y", overflow: "visible", display: "block" }}
        onPointerDown={(e) => pick(e.clientX)} onPointerMove={(e) => { if (e.buttons || e.pointerType === "touch") pick(e.clientX); }} onPointerLeave={() => setHover(null)} onPointerUp={(e) => { if (e.pointerType === "touch") setHover(null); }}>
        {ticks.map((t) => (<g key={t}><line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="var(--rule)" /><text x={padL} y={y(t) - 5} fontSize={11} fill="var(--ink-3)">{compact(t)}</text></g>))}
        {prev.length > 1 && <path d={path(prev)} fill="none" stroke="var(--ink-3)" strokeWidth={1.75} strokeLinejoin="round" />}
        {prev.length > 1 && <text x={x(prev.length - 1)} y={y(prev[prev.length - 1]!.cumulative_pence) - 8} textAnchor="end" fontSize={11} fill="var(--ink-3)">{prevLabel.slice(0, 3)} {formatGBP(prev[prev.length - 1]!.cumulative_pence, { whole: true })}</text>}
        {elapsed > 1 && <path d={`${path(cur)} L${x(elapsed - 1)},${padT + ih} L${x(0)},${padT + ih} Z`} fill="var(--chart-fill)" />}
        {elapsed > 1 && <motion.path d={path(cur)} fill="none" stroke="var(--chart-ink)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ type: "spring", duration: 0.28, bounce: 0 }} />}
        {last && elapsed >= 1 && gap !== 0 && elapsed > 1 && (
          <g aria-hidden>
            <line x1={x(elapsed - 1) + 5} x2={x(elapsed - 1) + 5} y1={y(last.cumulative_pence)} y2={y(prevAt!.cumulative_pence)} stroke={gap > 0 ? "var(--positive)" : "var(--caution)"} strokeWidth={1.5} />
            <text x={x(elapsed - 1) + 11} y={(y(last.cumulative_pence) + y(prevAt!.cumulative_pence)) / 2 + 4} fontSize={12} fontWeight={600} fill={gap > 0 ? "var(--positive)" : "var(--caution)"}>{gap > 0 ? "−" : "+"}{formatGBP(Math.abs(gap), { whole: true })}</text>
          </g>
        )}
        {showToday && <line x1={x(todayIdx)} x2={x(todayIdx)} y1={padT} y2={padT + ih} stroke="var(--rule-strong)" strokeDasharray="2 3" />}
        {last && <circle cx={x(elapsed - 1)} cy={y(last.cumulative_pence)} r={4.5} fill="var(--chart-ink)" />}
        {idx !== null && (
          <g aria-hidden>
            <line x1={x(idx)} x2={x(idx)} y1={padT} y2={padT + ih} stroke="var(--ink-3)" />
            {cur[idx] && <circle cx={x(idx)} cy={y(cur[idx]!.cumulative_pence)} r={4} fill="var(--bg)" stroke="var(--chart-ink)" strokeWidth={2} />}
            <g transform={`translate(${Math.min(Math.max(x(idx), 70), w - 70)},2)`}>
              <rect x={-64} y={0} width={128} height={cur[idx] ? 44 : 30} rx={10} fill="var(--ink)" />
              <text x={0} y={14} textAnchor="middle" fontSize={11} fill="var(--on-ink)" opacity={0.7}>Day {idx + 1}</text>
              {cur[idx] && <text x={0} y={28} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--on-ink)">{curLabel.slice(0, 3)} {formatGBP(cur[idx]!.cumulative_pence)}</text>}
              {prev[idx] && <text x={0} y={cur[idx] ? 41 : 26} textAnchor="middle" fontSize={11} fill="var(--on-ink)" opacity={0.7}>{prevLabel.slice(0, 3)} {formatGBP(prev[idx]!.cumulative_pence)}</text>}
            </g>
          </g>
        )}
        {[0, Math.round((n - 1) * 0.25), Math.round((n - 1) * 0.5), Math.round((n - 1) * 0.75), n - 1].filter((i, k, a) => a.indexOf(i) === k && !(showToday && i !== 0 && i !== n - 1 && Math.abs(i - todayIdx) < 4)).map((i) => (
          <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize={11} fill="var(--ink-3)">{tick(i)}</text>
        ))}
        {showToday && <text x={x(todayIdx)} y={height - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink)">Today</text>}
      </svg>
      <div className="legend">
        <span><i />{curLabel.slice(0, 3)} <b className="num" style={{ color: "var(--ink)" }}>{last ? formatGBP(last.cumulative_pence) : "£0.00"}</b></span>
        {prev.length > 0 && <span><i className="ctx" />{prevLabel.slice(0, 3)} by day {Math.min(elapsed, prev.length)} <span className="num">{prevAt ? formatGBP(prevAt.cumulative_pence) : "£0.00"}</span></span>}
      </div>
    </div>
  );
}
export type { Pence };
