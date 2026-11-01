"use client";
// BUD-07 (mock-up 27): cumulative spend to today, the plan (bills on their due days), the forecast to month end with its likely range, and the budget line.
import { scaleLinear } from "@visx/scale";
import { useRef, useState } from "react";
import type { BudgetView } from "@/lib/budget";
import { formatGBP } from "@/lib/money";
import type { DailySpend } from "@/lib/types";

const compact = (p: number) => { const a = Math.round(p / 100); return `£${a >= 1000 ? `${Math.round(a / 100) / 10}`.replace(/\.0$/, "") + "k" : a}`; };

export function ForecastChart({ v, daily, height = 230 }: { v: BudgetView; daily: readonly DailySpend[]; height?: number }) {
  const [w, setW] = useState(320);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = (el: SVGSVGElement | null) => { ro.current?.disconnect(); if (el) { ro.current = new ResizeObserver(() => setW(Math.max(220, el.clientWidth))); ro.current.observe(el); setW(Math.max(220, el.clientWidth)); } };
  const o = v.overall, f = o.forecast;
  const padL = 4, padR = 34, padT = 26, padB = 26;
  const iw = w - padL - padR, ih = height - padT - padB;
  const dim = v.dim;
  const x = (day: number) => padL + ((day - 1) / (dim - 1)) * iw;      // day 1..dim
  const top = Math.max(o.amount, f.high ?? f.forecast, f.forecast, o.spent) * 1.05;
  const y = scaleLinear<number>({ domain: [0, top], range: [padT + ih, padT] });
  const cumByDay = new Map(daily.map((d) => [Number(d.day.slice(8)), d.cumulative_pence]));
  const todayN = v.closed ? dim : v.dom;
  const actual: [number, number][] = [[1, 0]];
  let last = 0;
  for (let d = 1; d <= todayN; d++) { last = cumByDay.get(d) ?? last; actual.push([d, last]); }
  const path = (pts: [number, number][]) => pts.map(([d, c], i) => `${i ? "L" : "M"}${x(d).toFixed(1)},${y(c).toFixed(1)}`).join(" ");
  const plan: [number, number][] = v.planByDay.map((c, i) => [i + 1, c] as [number, number]);
  const showF = f.available && !f.closed;
  const y0 = y(o.spent), xT = x(todayN), xE = x(dim);
  const ticks = y.ticks(3).filter((t) => t > 0 && t < o.amount * 0.98);
  return (
    <svg ref={ref} width="100%" height={height} className="chart" role="img" data-testid="forecast-chart" style={{ display: "block", overflow: "visible" }}
      aria-label={`Spend so far ${formatGBP(o.spent)}, forecast ${f.available ? formatGBP(f.forecast) : "not yet available"}, budget ${formatGBP(o.amount)}`}>
      {ticks.map((t) => <g key={t}><line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="var(--rule)" /><text x={padL + 2} y={y(t) - 4} fontSize={11} fill="var(--ink-3)">{compact(t)}</text></g>)}
      <line x1={padL} x2={w - padR} y1={y(o.amount)} y2={y(o.amount)} stroke="var(--ink)" strokeDasharray="4 4" strokeWidth={1.25} />
      <text x={padL} y={y(o.amount) - 6} fontSize={11} fontWeight={600} fill="var(--ink)">Budget {formatGBP(o.amount, { whole: true })}</text>
      {showF && f.low !== null && f.high !== null && <path d={`M${xT},${y0} L${xE},${y(f.high)} L${xE},${y(f.low)} Z`} fill="var(--surface-3)" opacity={0.9} data-testid="forecast-range" />}
      <path d={path(plan)} fill="none" stroke="var(--positive)" strokeWidth={1.75} strokeLinejoin="round" data-testid="plan-line" />
      {showF && <path d={`M${xT},${y0} L${xE},${y(f.forecast)}`} fill="none" stroke="var(--ink)" strokeWidth={1.75} strokeDasharray="2 4" strokeLinecap="round" data-testid="forecast-line" />}
      <path d={path(actual)} fill="none" stroke="var(--ink)" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
      {!v.closed && <circle cx={xT} cy={y0} r={4.5} fill="var(--ink)" />}
      {showF && <><circle cx={xE} cy={y(f.forecast)} r={4} fill="var(--bg)" stroke="var(--ink)" strokeWidth={2} /><text x={xE - 6} y={y(f.forecast) + (f.forecast > o.amount * 0.9 ? 18 : -8)} textAnchor="end" fontSize={11} fontWeight={600} fill="var(--ink)">Forecast {formatGBP(f.forecast, { whole: true })}</text></>}
      <text x={padL} y={height - 6} fontSize={11} fill="var(--ink-3)">1 {new Date(v.month + "T12:00:00Z").toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}</text>
      {!v.closed && <text x={xT} y={height - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink)">Today</text>}
      <text x={w - padR} y={height - 6} textAnchor="end" fontSize={11} fill="var(--ink-3)">{dim}</text>
    </svg>
  );
}
