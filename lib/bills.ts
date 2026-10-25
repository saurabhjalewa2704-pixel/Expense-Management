// What the Bills screen shows for a month: the occurrences already recorded, plus the ones the rules say are still to come.
// Projected dates come from the same `nextOccurrences` the cron uses, so the calendar and the engine agree (PRD §6.9, REC-02).
import { addDays, monthEnd, monthStart, type ISODate } from "@/lib/dates";
import { nextOccurrences, type Holidays, type RecurrenceRule } from "@/lib/recurrence";
import type { OccurStatus, RecurringItem, RecurringOccurrence } from "@/lib/types";

export type BillState = "logged" | "estimate" | "pending" | "skipped" | "due";
export interface BillRow {
  key: string;
  item: RecurringItem;
  due_on: ISODate;
  scheduled_on: ISODate;
  state: BillState;
  amount_pence: number;
  occurrenceId: string | null;
  transactionId: string | null;
  /** 1-based position when the rule has a payment count ("Payment 7 of 10"). */
  n: number | null;
}

export const asRule = (i: RecurringItem): RecurrenceRule => ({
  frequency: i.frequency, day_of_month: i.day_of_month, last_day: i.last_day, weekday: i.weekday, month_of_year: i.month_of_year,
  working_day_rule: i.working_day_rule, starts_on: i.starts_on, ends_on: i.ends_on, max_occurrences: i.max_occurrences,
});

const stateOf = (s: OccurStatus): BillState => (s === "confirmed" ? "logged" : s);
export const isActive = (i: RecurringItem) => !i.ended_at && !i.paused_at;

/** Every bill in [from, to]: recorded occurrences, and projected ones for active rules from `next_due_on` onwards. Sorted by date. */
export function billsIn(items: readonly RecurringItem[], occurrences: readonly RecurringOccurrence[], from: ISODate, to: ISODate, holidays?: Holidays): BillRow[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const rows: BillRow[] = [];
  const recorded = new Set<string>();
  for (const o of occurrences) {
    recorded.add(`${o.item_id}|${o.scheduled_on}`);
    const item = byId.get(o.item_id);
    if (!item || o.due_on < from || o.due_on > to) continue;
    rows.push({ key: o.id, item, due_on: o.due_on, scheduled_on: o.scheduled_on, state: stateOf(o.status), amount_pence: o.amount_pence, occurrenceId: o.id, transactionId: o.transaction_id, n: null });
  }
  for (const item of items) {
    if (!isActive(item)) continue;
    const lo = from > item.next_due_on ? from : item.next_due_on;      // nothing is projected before the engine's next date: no backfilling
    if (lo > to) continue;
    for (const p of nextOccurrences(asRule(item), lo, to, holidays)) {
      if (recorded.has(`${item.id}|${p.scheduled_on}`)) continue;
      rows.push({ key: `${item.id}|${p.scheduled_on}`, item, due_on: p.due_on, scheduled_on: p.scheduled_on, state: "due", amount_pence: item.amount_pence, occurrenceId: null, transactionId: null, n: item.max_occurrences ? p.n : null });
    }
  }
  return rows.sort((a, b) => a.due_on.localeCompare(b.due_on) || a.key.localeCompare(b.key));
}

export interface MonthSummary {
  /** Expenses only. */
  count: number; total: number;
  loggedCount: number; logged: number;
  toComeCount: number; toCome: number;
  /** Transfers and income still to come, shown beside the expense total ("£34.97 + £500.00 transfer"). */
  transferToCome: number; incomeToCome: number;
}

export function summariseMonth(rows: readonly BillRow[]): MonthSummary {
  const s: MonthSummary = { count: 0, total: 0, loggedCount: 0, logged: 0, toComeCount: 0, toCome: 0, transferToCome: 0, incomeToCome: 0 };
  for (const r of rows) {
    if (r.state === "skipped") continue;
    const open = r.state === "due" || r.state === "pending";
    if (r.item.type === "expense") {
      s.count++; s.total += r.amount_pence;
      if (open) { s.toComeCount++; s.toCome += r.amount_pence; } else { s.loggedCount++; s.logged += r.amount_pence; }
    } else if (open) {
      if (r.item.type === "transfer") s.transferToCome += r.amount_pence; else s.incomeToCome += r.amount_pence;
    }
  }
  return s;
}

/** The three kinds of dot on a calendar day. */
export interface DayDots { logged: number; due: number; other: number }
export function dotsByDay(rows: readonly BillRow[]): Map<ISODate, DayDots> {
  const m = new Map<ISODate, DayDots>();
  for (const r of rows) {
    if (r.state === "skipped") continue;
    const d = m.get(r.due_on) ?? { logged: 0, due: 0, other: 0 };
    if (r.item.type !== "expense") d.other++;
    else if (r.state === "due" || r.state === "pending") d.due++;
    else d.logged++;
    m.set(r.due_on, d);
  }
  return m;
}

/** The soonest unrecorded occurrence of any active expense rule, for the Home card ("Next: Spotify, Thu 22 Oct"). */
export function nextUp(items: readonly RecurringItem[], today: ISODate, holidays?: Holidays): BillRow | null {
  const rows = billsIn(items, [], today, addDays(today, 400), holidays).filter((r) => r.state === "due");
  return rows[0] ?? null;
}

/** Remaining expense bills this month (today onwards), for the Home card. */
export function toComeThisMonth(items: readonly RecurringItem[], occurrences: readonly RecurringOccurrence[], today: ISODate, holidays?: Holidays) {
  const rows = billsIn(items, occurrences, monthStart(today), monthEnd(today), holidays);
  const pending = rows.filter((r) => r.item.type === "expense" && (r.state === "due" || r.state === "pending"));
  return { pence: pending.reduce((s, r) => s + r.amount_pence, 0), count: pending.length, next: rows.find((r) => r.state === "due" && r.due_on >= today) ?? null };
}
