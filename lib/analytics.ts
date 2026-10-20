// Pure logic behind the Analytics charts: finding titles, usual-spend flags, the waterfall, projections and heat levels.
// Titles are sentences stating the finding, generated from the data (PRD §6.7).
import { addMonths, daysInMonth, dayOfMonth, diffDays, monthStart, weekdayIndex, type ISODate } from "@/lib/dates";
import { formatGBP, medianPence, pctChange, type Pence } from "@/lib/money";
import type { CashFlow, CategorySpend, DailySpend, MonthlyTotal } from "@/lib/types";

const pounds = (p: Pence) => formatGBP(Math.abs(p), { whole: true });

/** AN-01: "You're £367 under September's pace". */
export function paceFinding(spend: Pence, prevSpend: Pence, prevLabel: string, hasPrev: boolean): string {
  if (!hasPrev) return "Your spending so far";
  const diff = prevSpend - spend;
  if (Math.abs(diff) < 100) return `You're level with ${prevLabel}'s pace`;
  return `You're ${pounds(diff)} ${diff > 0 ? "under" : "over"} ${prevLabel}'s pace`;
}

/** AN-02: flag a category in the caution colour when it is more than 20% and £30 over its usual (norm). */
export function deltaFlag(total: Pence, norm: Pence | null): { pct: number } | null {
  if (norm === null || norm <= 0) return null;
  const pct = pctChange(total, norm);
  return pct !== null && pct > 20 && total - norm > 3000 ? { pct } : null;
}

export function categoryFinding(rows: readonly CategorySpend[], total: Pence): string {
  const flagged = rows.map((r) => ({ r, f: deltaFlag(r.total_pence, r.norm_pence) })).filter((x) => x.f)
    .sort((a, b) => (b.r.total_pence - (b.r.norm_pence ?? 0)) - (a.r.total_pence - (a.r.norm_pence ?? 0)))[0];
  if (flagged) return `${flagged.r.name} is up ${flagged.f!.pct}% on your usual`;
  const top = rows[0];
  return top ? `${top.name} is where most of the money went` : total === 0 ? "Nothing spent yet" : "Where it went";
}

export interface WaterfallStep { key: string; label: string; kind: "total" | "up" | "down"; value: Pence; from: Pence; to: Pence }

/** AN-03: Opening → +Income → −top four categories → −Other → (± set aside, ± adjustments) → Available. Directly the CASH-01 equation. */
export function buildWaterfall(flow: CashFlow, cats: readonly Pick<CategorySpend, "name" | "total_pence">[], top = 4): { steps: WaterfallStep[]; base: Pence } {
  const steps: WaterfallStep[] = [];
  let level = flow.opening_pence;
  steps.push({ key: "opening", label: "Opening", kind: "total", value: level, from: 0, to: level });
  const move = (key: string, label: string, delta: Pence) => {
    if (delta === 0) return;
    steps.push({ key, label, kind: delta > 0 ? "up" : "down", value: delta, from: level, to: level + delta });
    level += delta;
  };
  move("income", "Income", flow.income_pence);
  const sorted = [...cats].sort((a, b) => b.total_pence - a.total_pence);
  const shown = sorted.slice(0, top);
  for (const c of shown) move(`cat:${c.name}`, c.name, -c.total_pence);
  const shownSum = shown.reduce((s, c) => s + c.total_pence, 0);
  move("other", "Other", -(flow.spend_pence - shownSum));
  move("pot", "One-off", flow.pot_pence ?? 0);
  move("set-aside", "Set aside", flow.set_aside_pence);
  move("adjust", "Adjustments", flow.adjust_pence);
  steps.push({ key: "available", label: "Available", kind: "total", value: level, from: 0, to: level });
  const lows = steps.flatMap((s) => [s.from, s.to]).filter((v) => v > 0);
  // a broken scale: the bars start at the nearest £1,000 below the lowest level, so the small moves are visible
  // (no levels above zero, e.g. a brand-new account: the scale simply starts at zero)
  const base = lows.length ? Math.max(0, Math.floor((Math.min(...lows) * 0.93) / 100000) * 100000) : 0;
  return { steps, base };
}

export const waterfallFinding = (flow: CashFlow) =>
  `${formatGBP(flow.closing_pence)} left after ${formatGBP(flow.spend_pence)} of spending`;

/** AN-04: what this month is heading for: spend so far, plus the median of what previous months spent after this day. */
export function projectMonth(daily: readonly DailySpend[], today: ISODate, spendSoFar: Pence, monthsBack = 6): Pence {
  const dom = dayOfMonth(today);
  const afters: Pence[] = [];
  for (let k = 1; k <= monthsBack; k++) {
    const m = monthStart(addMonths(monthStart(today), -k));
    const dim = daysInMonth(m);
    const from = m.slice(0, 8) + String(Math.min(dom, dim)).padStart(2, "0");
    const end = m.slice(0, 8) + String(dim).padStart(2, "0");
    const rows = daily.filter((d) => d.day > from && d.day <= end);
    const monthRows = daily.filter((d) => d.day >= m && d.day <= end);
    if (monthRows.length === 0 || monthRows.reduce((s, d) => s + d.total_pence, 0) === 0) continue;
    afters.push(rows.reduce((s, d) => s + d.total_pence, 0));
  }
  return spendSoFar + medianPence(afters);
}

export function trendFinding(monthLabel: string, projected: Pence, average: Pence): string {
  if (average <= 0) return `${monthLabel} is heading for ${pounds(projected)}`;
  const pct = ((projected - average) * 100) / average;
  const rel = Math.abs(pct) <= 10 ? "near your average" : pct > 0 ? "above your average" : "below your average";
  return `${monthLabel} is heading for ${pounds(projected)}, ${rel}`;
}

export const average = (xs: readonly Pence[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

/** AN-05: the weekday you spend most on, from daily totals (average per occurrence, days with no spend count as zero). */
export function weekdayAverages(days: readonly Pick<DailySpend, "day" | "total_pence">[]): Pence[] {
  const sums = Array(7).fill(0) as number[], counts = Array(7).fill(0) as number[];
  for (const d of days) { const w = weekdayIndex(d.day); sums[w]! += d.total_pence; counts[w]! += 1; }
  return sums.map((s, i) => (counts[i] ? Math.round(s / counts[i]!) : 0));
}
export const WEEKDAY_NAMES = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
export function rhythmFinding(avgs: readonly Pence[]): { text: string; weekday: number } | null {
  const max = Math.max(...avgs);
  if (!(max > 0)) return null;
  const i = avgs.indexOf(max);
  return { text: `${WEEKDAY_NAMES[i]} are your biggest day`, weekday: i };
}

/** Five-step single-hue ramp. Level 0 is "no spend"; 1-5 are quintile-ish steps of the days that had spend. */
export function heatLevels(values: readonly Pence[]): (0 | 1 | 2 | 3 | 4 | 5)[] {
  const pos = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (pos.length === 0) return values.map(() => 0);
  const cut = (q: number) => pos[Math.min(pos.length - 1, Math.floor(q * pos.length))]!;
  const t = [cut(0.2), cut(0.4), cut(0.6), cut(0.8)];
  return values.map((v) => (v <= 0 ? 0 : v < t[0]! ? 1 : v < t[1]! ? 2 : v < t[2]! ? 3 : v < t[3]! ? 4 : 5) as 1 | 2 | 3 | 4 | 5);
}

export interface TrendBar { month: ISODate; spend: Pence; income: Pence; projectedExtra: Pence; isCurrent: boolean }
export function trendBars(totals: readonly MonthlyTotal[], currentMonth: ISODate, projected: Pence | null): TrendBar[] {
  return totals.map((t) => ({
    month: t.month, spend: t.spend_pence, income: t.income_pence, isCurrent: t.month === currentMonth,
    projectedExtra: t.month === currentMonth && projected !== null ? Math.max(0, projected - t.spend_pence) : 0,
  }));
}

/** Days between the first and last of a series, for tick placement. */
export const spanDays = (from: ISODate, to: ISODate) => diffDays(to, from) + 1;
