"use client";
import { useState } from "react";
import { dayOfMonth, daysInMonth, formatShort, monthStart, weekdayIndex, type ISODate } from "@/lib/dates";
import { heatLevels } from "@/lib/analytics";
import { formatGBP } from "@/lib/money";
import type { DailySpend } from "@/lib/types";

const ALPHA = [0, 0.14, 0.3, 0.5, 0.74, 1];
const cell = (lvl: number) => (lvl === 0 ? "var(--surface-2)" : `color-mix(in srgb, var(--ink) ${Math.round(ALPHA[lvl]! * 100)}%, var(--surface-2))`);

/** AN-05: a calendar of daily spend for one month, on a five-step single-hue ramp. */
export function Heatmap({ month, days, today }: { month: ISODate; days: DailySpend[]; today: ISODate }) {
  const first = monthStart(month);
  const n = daysInMonth(first);
  const lead = weekdayIndex(first);
  const byDay = new Map(days.map((d) => [d.day, d.total_pence]));
  const dates = Array.from({ length: n }, (_, i) => `${first.slice(0, 8)}${String(i + 1).padStart(2, "0")}`);
  const levels = heatLevels(dates.map((d) => (d <= today ? byDay.get(d) ?? 0 : 0)));
  const [sel, setSel] = useState<ISODate | null>(null);
  return (
    <div data-testid="heatmap">
      <div className="heat" style={{ marginTop: 12 }}>
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <div key={i} className="wk" aria-hidden>{d}</div>)}
        {Array.from({ length: lead }, (_, i) => <div key={`l${i}`} />)}
        {dates.map((d, i) => {
          const future = d > today;
          const v = byDay.get(d) ?? 0;
          return (
            <button key={d} className="d" disabled={future} onClick={() => setSel(d === sel ? null : d)} aria-label={`${formatShort(d)}: ${future ? "no data yet" : formatGBP(v)}`}
              style={{ background: future ? "transparent" : cell(levels[i]!), color: levels[i]! >= 4 ? "var(--on-ink)" : future ? "var(--ink-3)" : "var(--ink-2)", boxShadow: d === today ? "inset 0 0 0 2px var(--ink)" : d === sel ? "inset 0 0 0 2px var(--ink-2)" : undefined, opacity: future ? 0.5 : 1 }}>
              {dayOfMonth(d)}
            </button>
          );
        })}
      </div>
      <div className="row-between" style={{ marginTop: 12, fontSize: 12, color: "var(--ink-2)" }}>
        <span>Less</span>
        <span style={{ display: "flex", gap: 5 }} aria-hidden>{[1, 2, 3, 4, 5].map((l) => <i key={l} style={{ width: 14, height: 14, borderRadius: 4, background: cell(l) }} />)}</span>
        <span>More</span>
      </div>
      {sel && <p className="sub" style={{ marginTop: 8 }} aria-live="polite">{formatShort(sel)}: <b className="num" style={{ color: "var(--ink)" }}>{formatGBP(byDay.get(sel) ?? 0)}</b></p>}
    </div>
  );
}
