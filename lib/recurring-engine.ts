// REC-04, the decisions the cron makes (no database in here): which occurrences are due, and what comes after each.
import { addDays, type ISODate } from "@/lib/dates";
import { nextOccurrences, type Holidays, type RecurrenceRule } from "@/lib/recurrence";

export interface EngineItem extends RecurrenceRule { id: string; next_due_on: ISODate }
export interface Planned { scheduled_on: ISODate; due_on: ISODate; /** The following due date, or null when this is the rule's last payment. */ next: ISODate | null }

/** The London hour from which the engine acts: 06:00. Later runs catch up, so a once-a-day cron works as well as an hourly one. */
export const ACT_FROM_HOUR = 6;
export const shouldAct = (hour: number) => hour >= ACT_FROM_HOUR;

/**
 * Every occurrence of a rule that is due on or before `today` and not yet recorded (the database ignores any it already has),
 * oldest first, each with the due date that follows it. A rule with nothing left returns [] and `finished` is true.
 */
export function planDue(item: EngineItem, today: ISODate, holidays?: Holidays): { planned: Planned[]; finished: boolean } {
  const all = nextOccurrences(item, item.next_due_on, addDays(today, 800), holidays);
  const planned: Planned[] = [];
  all.forEach((o, i) => {
    if (o.due_on <= today) planned.push({ scheduled_on: o.scheduled_on, due_on: o.due_on, next: all[i + 1]?.due_on ?? null });
  });
  return { planned, finished: all.length === 0 };
}
