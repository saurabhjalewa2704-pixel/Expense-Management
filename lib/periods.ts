// Analytics periods (PRD §6.7): Month · Quarter · Year · Custom, with arrows to step. Every period knows the
// period to compare it with, aligned to the same point (this October so far vs September to the same day).
import {
  addDays, addMonths, addYears, diffDays, formatDayMonth, formatMonthYear, monthEnd, monthStart, quarterEnd, quarterStart, yearEnd, yearStart,
  type ISODate,
} from "@/lib/dates";

export type PeriodKind = "month" | "quarter" | "year" | "custom";
export interface PeriodSel { kind: PeriodKind; /** any date inside the period */ anchor: ISODate; custom?: { from: ISODate; to: ISODate } }

export interface ResolvedPeriod {
  kind: PeriodKind;
  from: ISODate;
  /** The last day of the period, which may be in the future. */
  end: ISODate;
  /** The last day with data: `end` or today, whichever is earlier. */
  to: ISODate;
  prevFrom: ISODate;
  prevEnd: ISODate;
  /** The previous period up to the same point (same day of the month, same number of days in). */
  prevTo: ISODate;
  label: string;
  prevLabel: string;
  /** Days in the whole period, and days elapsed so far. */
  days: number;
  elapsed: number;
  isCurrent: boolean;
}

const quarterOf = (d: ISODate) => Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1;

function labelFor(kind: PeriodKind, from: ISODate, end: ISODate): string {
  if (kind === "month") return formatMonthYear(from);
  if (kind === "quarter") return `Q${quarterOf(from)} ${from.slice(0, 4)}`;
  if (kind === "year") return from.slice(0, 4);
  return `${formatDayMonth(from)} – ${formatDayMonth(end)}`;
}
const shortLabel = (kind: PeriodKind, from: ISODate, end: ISODate) =>
  kind === "month" ? formatMonthYear(from).split(" ")[0]! : labelFor(kind, from, end);

export function resolvePeriod(sel: PeriodSel, today: ISODate): ResolvedPeriod {
  const a = sel.anchor;
  let from: ISODate, end: ISODate, prevFrom: ISODate, prevEnd: ISODate;
  switch (sel.kind) {
    case "month": from = monthStart(a); end = monthEnd(a); prevFrom = monthStart(addMonths(from, -1)); prevEnd = monthEnd(prevFrom); break;
    case "quarter": from = quarterStart(a); end = quarterEnd(a); prevFrom = quarterStart(addMonths(from, -3)); prevEnd = quarterEnd(prevFrom); break;
    case "year": from = yearStart(a); end = yearEnd(a); prevFrom = yearStart(addYears(from, -1)); prevEnd = yearEnd(prevFrom); break;
    default: {
      from = sel.custom?.from ?? monthStart(a); end = sel.custom?.to ?? monthEnd(a);
      const len = diffDays(end, from) + 1;
      prevEnd = addDays(from, -1); prevFrom = addDays(prevEnd, -(len - 1));
    }
  }
  const to = end < today ? end : today;
  const elapsed = Math.max(0, diffDays(to, from) + 1);
  const shift = (d: ISODate) => (sel.kind === "month" ? addMonths(d, -1) : sel.kind === "quarter" ? addMonths(d, -3) : sel.kind === "year" ? addYears(d, -1) : addDays(d, -(diffDays(end, from) + 1)));
  const prevTo = to === end ? prevEnd : (shift(to) < prevEnd ? shift(to) : prevEnd);
  return {
    kind: sel.kind, from, end, to, prevFrom, prevEnd, prevTo,
    label: labelFor(sel.kind, from, end), prevLabel: shortLabel(sel.kind, prevFrom, prevEnd),
    days: diffDays(end, from) + 1, elapsed, isCurrent: end >= today && from <= today,
  };
}

/** Step by one period (the arrows). Custom ranges move by their own length. */
export function stepPeriod(sel: PeriodSel, dir: -1 | 1): PeriodSel {
  switch (sel.kind) {
    case "month": return { ...sel, anchor: addMonths(sel.anchor, dir) };
    case "quarter": return { ...sel, anchor: addMonths(sel.anchor, 3 * dir) };
    case "year": return { ...sel, anchor: addYears(sel.anchor, dir) };
    default: {
      const c = sel.custom; if (!c) return sel;
      const len = diffDays(c.to, c.from) + 1;
      return { ...sel, anchor: addDays(sel.anchor, len * dir), custom: { from: addDays(c.from, len * dir), to: addDays(c.to, len * dir) } };
    }
  }
}

/** Can the next arrow move into the future? Not past the period that contains today. */
export const canStepForward = (sel: PeriodSel, today: ISODate) => resolvePeriod(sel, today).end < today;
