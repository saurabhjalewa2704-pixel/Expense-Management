// Recurring payments (PRD §6.9): one pure function says which dates a rule falls on. The cron, the Bills calendar
// (future months) and the month-end projection all call it, so the three always agree.
// Dates are London calendar dates (ISO strings), so clock changes never shift a payment; "6am" is only when the cron acts.
import { addDays, addMonths, daysInMonth, dayOfMonth, monthStart, weekdayIndex, type ISODate } from "@/lib/dates";

export type RecurFreq = "weekly" | "monthly" | "quarterly" | "yearly";
export type WorkingDayRule = "on_day" | "next_working_day";

/** The part of `recurring_items` that decides dates. */
export interface RecurrenceRule {
  frequency: RecurFreq;
  /** 1–31, monthly and quarterly (and yearly together with `month_of_year`). */
  day_of_month: number | null;
  /** "Last day": the final day of the month, whatever its length. */
  last_day: boolean;
  /** ISO weekday 1 (Monday) – 7 (Sunday), weekly. */
  weekday: number | null;
  /** 1–12, yearly. */
  month_of_year: number | null;
  working_day_rule: WorkingDayRule;
  starts_on: ISODate;
  ends_on: ISODate | null;
  max_occurrences: number | null;
}

export interface Occurrence {
  /** The date the rule falls on before any working-day move: the idempotency key for the occurrence. */
  scheduled_on: ISODate;
  /** The date the payment is logged on, after the working-day rule. */
  due_on: ISODate;
  /** 1-based position in the rule's sequence ("Payment 7 of 10"). */
  n: number;
}

export type Holidays = ReadonlySet<ISODate> | readonly ISODate[];
const holidaySet = (h?: Holidays): ReadonlySet<ISODate> => (h instanceof Set ? h : new Set(h ?? []));

export const isWeekend = (d: ISODate) => weekdayIndex(d) >= 5;
export const isWorkingDay = (d: ISODate, holidays?: Holidays) => !isWeekend(d) && !holidaySet(holidays).has(d);
/** The date itself if it is a working day, otherwise the next one. */
export function nextWorkingDay(d: ISODate, holidays?: Holidays): ISODate {
  const h = holidaySet(holidays);
  let x = d;
  for (let i = 0; i < 14 && (isWeekend(x) || h.has(x)); i++) x = addDays(x, 1);
  return x;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Day `want` of the month containing `anchor`, pulled back to the month's last day when the month is shorter (31 → 30 Nov, 29 Feb → 28 Feb). */
function inMonth(anchor: ISODate, want: number, last: boolean): ISODate {
  const len = daysInMonth(anchor);
  return `${anchor.slice(0, 8)}${pad(last ? len : Math.min(want, len))}`;
}

/** Scheduled dates of the rule, in order, from `starts_on` until `limit` (inclusive). Each is a candidate; ends and caps are applied by the caller. */
function* scheduled(r: RecurrenceRule, limit: ISODate): Generator<ISODate> {
  if (r.frequency === "weekly") {
    const want = (r.weekday ?? weekdayIndex(r.starts_on) + 1) - 1;
    let d = addDays(r.starts_on, (want - weekdayIndex(r.starts_on) + 7) % 7);
    for (; d <= limit; d = addDays(d, 7)) yield d;
    return;
  }
  const day = r.day_of_month ?? dayOfMonth(r.starts_on);
  if (r.frequency === "yearly") {
    const month = r.month_of_year ?? Number(r.starts_on.slice(5, 7));
    for (let y = Number(r.starts_on.slice(0, 4)); ; y++) {
      const d = inMonth(`${y}-${pad(month)}-01`, day, r.last_day);
      if (d > limit) return;
      if (d >= r.starts_on) yield d;
    }
  }
  const step = r.frequency === "quarterly" ? 3 : 1;
  for (let m = monthStart(r.starts_on); ; m = addMonths(m, step)) {
    if (m > limit) return;
    const d = inMonth(m, day, r.last_day);
    if (d > limit) return;
    if (d >= r.starts_on) yield d;
  }
}

/**
 * Occurrences whose `due_on` falls in [from, to], in date order. Nothing is generated before `starts_on`, after `ends_on`,
 * or beyond `max_occurrences`. `holidays` (England & Wales bank holidays) only matters for "next working day".
 */
export function nextOccurrences(rule: RecurrenceRule, from: ISODate, to: ISODate, holidays?: Holidays): Occurrence[] {
  const out: Occurrence[] = [];
  const h = holidaySet(holidays);
  let n = 0;
  for (const s of scheduled(rule, to)) {
    n++;
    if (rule.max_occurrences != null && n > rule.max_occurrences) break;
    if (rule.ends_on && s > rule.ends_on) break;
    const due = rule.working_day_rule === "next_working_day" ? nextWorkingDay(s, h) : s;
    if (due > to) { if (s > to) break; else continue; }
    if (due >= from) out.push({ scheduled_on: s, due_on: due, n });
  }
  return out;
}

/** The first occurrence due on or after `from`, or null when the rule has ended. */
export function firstOccurrence(rule: RecurrenceRule, from: ISODate, holidays?: Holidays): Occurrence | null {
  return nextOccurrences(rule, from, addDays(from, 800), holidays)[0] ?? null;
}

// ── wording ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Monthly on the 5th", "Every 3 months on the last day", "Yearly on 29 February", "Weekly on Mondays". */
export function describeRule(r: Pick<RecurrenceRule, "frequency" | "day_of_month" | "last_day" | "weekday" | "month_of_year">): string {
  const day = r.last_day ? "the last day" : `the ${ordinal(r.day_of_month ?? 1)}`;
  switch (r.frequency) {
    case "weekly": return `Weekly on ${WEEKDAYS[(r.weekday ?? 1) - 1]}s`;
    case "monthly": return `Monthly on ${day}`;
    case "quarterly": return `Every 3 months on ${day}`;
    default: return `Yearly on ${r.last_day ? "the last day of" : r.day_of_month} ${MONTHS[(r.month_of_year ?? 1) - 1]}`.replace(/^Yearly on (\d+) /, "Yearly on $1 ");
  }
}

/** True when a day-of-month rule can land on a shorter month's last day (29–31), which the summary mentions. */
export const movesInShortMonths = (r: Pick<RecurrenceRule, "frequency" | "day_of_month" | "last_day">) =>
  r.frequency !== "weekly" && !r.last_day && (r.day_of_month ?? 0) >= 29;
