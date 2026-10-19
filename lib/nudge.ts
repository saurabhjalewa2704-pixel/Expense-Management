// NOT-01 decision logic, pure so the rules are testable without a clock, a database or a push service.
import { addDays, type ISODate } from "@/lib/dates";

export const REMINDER_COPY = "Anything to log from today?";
export const QUIET_COPY = "It's been a few days. Two minutes to catch up?";
/** Reminder times offered in Settings: 18:00 to 23:00 in 15-minute steps. */
export const REMINDER_SLOTS = Array.from({ length: 21 }, (_, i) => { const m = 18 * 60 + i * 15; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; });

const minutes = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number) as [number, number]; return h * 60 + m; };

export interface NudgeInput {
  /** London date and time now. */
  today: ISODate; hour: number; minute: number;
  reminderTime: string;                 // "21:00" or "21:00:00"
  /** The cron's period: a run counts as "in the slot" from the slot time up to this many minutes after it. */
  windowMin: number;
  lastReminderOn: ISODate | null;
  loggedToday: boolean;
  noSpendToday: boolean;
  /** Date of the newest transaction, if any. */
  lastTxnOn: ISODate | null;
}
export type NudgeDecision = { send: true; body: string } | { send: false; reason: "outside-slot" | "already-sent" | "logged-today" | "no-spend-marked" };

export function decideNudge(i: NudgeInput): NudgeDecision {
  const now = i.hour * 60 + i.minute, slot = minutes(i.reminderTime.slice(0, 5));
  if (now < slot || now >= slot + i.windowMin) return { send: false, reason: "outside-slot" };
  if (i.lastReminderOn === i.today) return { send: false, reason: "already-sent" };
  if (i.loggedToday) return { send: false, reason: "logged-today" };
  if (i.noSpendToday) return { send: false, reason: "no-spend-marked" };
  // "nothing logged for 3 days in a row": today plus the two days before it are empty (a no-spend marker counts as logged)
  const quiet = !i.lastTxnOn || i.lastTxnOn <= addDays(i.today, -3);
  return { send: true, body: quiet ? QUIET_COPY : REMINDER_COPY };
}
