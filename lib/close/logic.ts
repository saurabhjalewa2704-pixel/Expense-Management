// Month-end close: the rules that need no database, so they can be tested alone (MONTH-CLOSE-PRD §3 to §11).
import { addDays, addMonths, formatLong, formatMonth, formatShort, monthStart, weekdayIndex, type ISODate } from "@/lib/dates";
import { formatGBP } from "@/lib/money";
import { STEPS, isClosed, type BalanceItem, type CloseChecks, type CloseMonthState, type CloseState, type MissingDay, type StepKey, type StepState } from "./types";

/**
 * MC-03: 10 s an item in steps 1, 2 and 4, 15 s an account in step 3, plus 30 s for steps 5 and 6 together; to the nearest whole minute, at least 1.
 * Halves round to the even minute (as money does everywhere in the app), which makes the PRD's scenario (150 s) "About 2 min" as in the mock-ups.
 */
export function estimateMinutes(c: { missing: number; bills: number; tidy: number; accounts: number }): number {
  const min = (10 * (c.missing + c.bills + c.tidy) + 15 * c.accounts + 30) / 60;
  const floor = Math.floor(min), rest = min - floor;
  const rounded = rest > 0.5 ? floor + 1 : rest < 0.5 ? floor : floor % 2 === 0 ? floor : floor + 1;
  return Math.max(1, rounded);
}

/** What waits in each step, with the savings toggle applied to step 3. */
export interface StepCounts { total: number; open: number; answered: number }
export function stepCounts(c: CloseChecks, checkSavings: boolean): Record<StepKey, StepCounts> {
  const tally = (xs: { answer: unknown }[]): StepCounts => { const answered = xs.filter((x) => x.answer).length; return { total: xs.length, answered, open: xs.length - answered }; };
  const tidy = [...c.duplicates, ...c.large, ...c.one_offs];
  return {
    missing_days: tally(c.missing_days), bills: tally(c.bills),
    balances: tally(balancesShown(c.balances, checkSavings)), tidy_up: tally(tidy),
    review: { total: 0, open: 0, answered: 0 }, next_month: { total: 0, open: 0, answered: 0 },
  };
}
export const balancesShown = (b: BalanceItem[], checkSavings: boolean) => b.filter((x) => x.counts_as_cash || checkSavings);

/** MC-07: a step with nothing in it is ticked for the owner. Steps 5 and 6 always have something to read. */
export const stepIsEmpty = (key: StepKey, n: Record<StepKey, StepCounts>) => key !== "review" && key !== "next_month" && n[key].total === 0;

export type StepStatus = { kind: "nothing" } | { kind: "open"; open: number } | { kind: "done" } | { kind: "skipped"; open: number } | { kind: "todo" };
export function stepStatus(key: StepKey, state: Partial<Record<StepKey, StepState>> | undefined, n: Record<StepKey, StepCounts>): StepStatus {
  if (stepIsEmpty(key, n)) return { kind: "nothing" };
  const s = state?.[key];
  if (key === "review" || key === "next_month") return s === "done" ? { kind: "done" } : { kind: "todo" };
  if (n[key].open === 0) return { kind: "done" };
  if (s === "skipped") return { kind: "skipped", open: n[key].open };
  return { kind: "open", open: n[key].open };
}

/** MC-06: Resume opens the first step that is neither done nor empty. */
export function firstUnfinishedStep(state: Partial<Record<StepKey, StepState>> | undefined, n: Record<StepKey, StepCounts>, skipSkipped = false): StepKey | null {
  for (const s of STEPS) {
    const st = stepStatus(s.key, state, n);
    if (st.kind === "done" || st.kind === "nothing") continue;
    if (skipSkipped && st.kind === "skipped") continue;
    return s.key;
  }
  return null;
}
export const nextStepAfter = (key: StepKey, state: Partial<Record<StepKey, StepState>> | undefined, n: Record<StepKey, StepCounts>): StepKey | null => {
  const i = STEPS.findIndex((s) => s.key === key);
  for (const s of STEPS.slice(i + 1)) { const st = stepStatus(s.key, state, n); if (st.kind !== "nothing") return s.key; }
  return null;
};

/** MC-13: three or more consecutive unanswered missing days are one item; with more than 15 missing the whole step offers "Mark all as not tracked". */
export type DayItem = { kind: "day"; day: ISODate; answer: MissingDay["answer"] } | { kind: "run"; from: ISODate; to: ISODate; days: ISODate[] };
export function groupRuns(days: readonly MissingDay[], expanded: ReadonlySet<ISODate> = new Set()): DayItem[] {
  const out: DayItem[] = [];
  let run: MissingDay[] = [];
  const flush = () => {
    if (run.length >= 3 && !run.some((d) => expanded.has(d.day))) out.push({ kind: "run", from: run[0]!.day, to: run.at(-1)!.day, days: run.map((d) => d.day) });
    else for (const d of run) out.push({ kind: "day", day: d.day, answer: d.answer });
    run = [];
  };
  for (const d of [...days].sort((a, b) => a.day.localeCompare(b.day))) {
    if (d.answer) { flush(); out.push({ kind: "day", day: d.day, answer: d.answer }); continue; }
    if (run.length && run.at(-1)!.day !== addDays(d.day, -1)) flush();
    run.push(d);
  }
  flush();
  return out;
}
export const notLoggingForAWhile = (days: readonly MissingDay[]) => days.filter((d) => !d.answer).length > 15;

/** MC-11: the context line under a missing day. `usual` is the forecast's usual per day, `weekday` its weekday multipliers (Monday first) when that profile is on. */
export function dayContext(day: ISODate, usual: number | null, weekday: readonly number[] | null): string {
  if (usual === null || usual <= 0) return "Nothing logged";
  const name = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  const typical = Math.round(weekday ? usual * weekday[weekdayIndex(day)]! : usual);
  const biggest = weekday ? weekday[weekdayIndex(day)]! === Math.max(...weekday) && Math.max(...weekday) > 1.15 : false;
  return biggest ? `Nothing logged · ${name}s are usually your biggest day` : `Nothing logged · you usually spend about ${formatGBP(typical, { whole: true })} on a ${name}`;
}

/** MC-33: the sheet's title. diff = bank − Sterling. A card is entered as owed; a negative figure means it owes more. */
export function differenceTitle(name: string, type: BalanceItem["type"], diff: number): string {
  const amt = formatGBP(Math.abs(diff));
  if (type === "credit_card") return diff < 0 ? `${name} owes ${amt} more than expected` : `${name} owes ${amt} less than expected`;
  return diff < 0 ? `${name} is ${amt} short` : `${name} has ${amt} more than expected`;
}
/** MC-33: which options apply (EC-MC14: £1.00 or less pre-selects "Just correct the balance"). */
export function differenceOptions(diff: number): { options: ("untracked_spend" | "untracked_income" | "adjustment")[]; preselected: "untracked_spend" | "untracked_income" | "adjustment" } {
  const main = diff < 0 ? "untracked_spend" : "untracked_income";
  return { options: [main, "adjustment"], preselected: Math.abs(diff) <= 100 ? "adjustment" : main };
}
/** A card entry: what the owner types is what they owe (positive), stored negative; "−" means in credit (EC-MC13). */
export function bankFigure(type: BalanceItem["type"], typed: number, inCredit = false): number {
  if (type !== "credit_card") return typed;
  return inCredit ? Math.abs(typed) : -Math.abs(typed);
}

/** MC-61: when a limit was over in 2 of the last 3 closed months, suggest the average actual spend, rounded up to the nearest £25. */
export function suggestedLimit(actuals: readonly number[]): number {
  const avg = actuals.reduce((a, b) => a + b, 0) / Math.max(1, actuals.length);
  return Math.ceil(avg / 2500) * 2500;
}

/** §9 section 5: the forecast's error against the final figure, as "−0.9%". */
export const errorPct = (point: number, final: number): string => {
  if (final === 0) return "—";
  const v = ((point - final) / final) * 100;
  const r = Math.round(v * 10) / 10;
  return `${r < 0 ? "−" : r > 0 ? "+" : ""}${Math.abs(r).toFixed(1)}%`;
};

export const formatDuration = (s: number): string => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`);

/** "Fri 1 Jan" (no comma, whatever the locale data does). */
export const dayShortLabel = (d: ISODate): string => {
  const x = new Date(`${d}T12:00:00Z`);
  return `${x.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })} ${x.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`;
};

/** The month name for a first-of-month ("November"). */
export const monthName = (m: ISODate): string => formatMonth(m).split(" ")[0]!;
export const nextMonthOf = (m: ISODate): ISODate => addMonths(monthStart(m), 1);
export const nextCloseDate = (today: ISODate): ISODate => addMonths(monthStart(today), 1);
export const closeUrl = (m: ISODate, step?: string) => `/close/${m.slice(0, 7)}${step ? `/${step}` : ""}`;
export const monthFromParam = (p: string): ISODate | null => (/^\d{4}-(0[1-9]|1[0-2])$/.test(p) ? (`${p}-01` as ISODate) : null);

/** The months that need closing now, oldest first: prompted, ended, not closed (MC-04, §10.4). */
export function monthsToClose(state: CloseState | undefined): CloseMonthState[] {
  return (state?.months ?? []).filter((m) => m.prompted && !isClosed(m.status) && m.month < (state?.current ?? "")).sort((a, b) => a.month.localeCompare(b.month));
}

/** MC-01: the card's three faces. `later` is "hidden until 06:00 tomorrow" (MC-35); after 14 days unclosed it becomes the slim row. */
export type CardMode = "hidden" | "ready" | "in_progress" | "slim";
export function cardMode(m: CloseMonthState | undefined, today: ISODate, laterUntil: number | null, nowMs: number, ageOf: CloseMonthState | undefined = m): CardMode {
  if (!m || isClosed(m.status)) return "hidden";
  if (laterUntil !== null && nowMs < laterUntil) return "hidden";
  // how long it has been waiting is judged by the newest month that is due: with several waiting, the card stays full until even the latest is 14 days old
  const unclosedDays = Math.round((Date.parse(today) - Date.parse(addMonths((ageOf ?? m).month, 1))) / 86400000);
  if (unclosedDays >= 14) return "slim";
  return m.status === "in_progress" && m.started_at ? "in_progress" : "ready";
}
/** "Later" hides the card until 06:00 London the next day. */
export function laterUntilMs(todayISO: ISODate): number { return Date.parse(`${addDays(todayISO, 1)}T06:00:00Z`) - 0; }

export const waitingLine = (n: Record<StepKey, StepCounts>): string => {
  const parts: string[] = [];
  if (n.missing_days.open) parts.push(`${n.missing_days.open} ${n.missing_days.open === 1 ? "day" : "days"} with nothing logged`);
  if (n.bills.open) parts.push(`${n.bills.open} ${n.bills.open === 1 ? "bill" : "bills"} to confirm`);
  if (n.balances.open) parts.push(`${n.balances.open} ${n.balances.open === 1 ? "balance" : "balances"}`);
  if (n.tidy_up.open) parts.push(`${n.tidy_up.open} ${n.tidy_up.open === 1 ? "thing" : "things"} to look at`);
  return parts.length ? parts.join(", ") : "nothing to fix, just a review";
};

/** §10.3 status chips. */
export type Chip = { tone: "pos" | "cau" | "muted"; label: string };
export function statusChip(m: Pick<CloseMonthState, "status" | "changed_since_close" | "step_state">, spentChange?: number | null): Chip {
  if (isClosed(m.status) && m.changed_since_close) return { tone: "cau", label: spentChange ? `Changed since close · ${formatGBP(spentChange, { signed: true, whole: true })}` : "Changed since close" };
  if (m.status === "closed_with_skips") { const n = Object.values(m.step_state ?? {}).filter((v) => v === "skipped").length; return { tone: "muted", label: `Closed, ${n || 1} skipped` }; }
  if (isClosed(m.status)) return { tone: "pos", label: "Closed" };
  return { tone: "muted", label: "Open" };
}

/** MC-80: the two notifications and when each is due. Times are London wall-clock, so the cron needs no BST handling of its own. */
export interface NotifyInput {
  londonDate: ISODate; hour: number; minute: number; windowMin: number; notifyTime: string;      // "09:00"
  month: CloseMonthState | undefined; readySent: boolean; reminderSent: boolean; enabled: boolean;
}
export function dueCloseNotification(i: NotifyInput): "ready" | "reminder" | null {
  if (!i.enabled || !i.month || isClosed(i.month.status)) return null;
  const nowMin = i.hour * 60 + i.minute;
  const [h, mi] = i.notifyTime.split(":").map(Number) as [number, number];
  const target = h * 60 + mi;
  const within = (t: number) => nowMin >= t && nowMin < t + i.windowMin;
  const day = Number(i.londonDate.slice(8));
  if (day === 1 && !i.readySent && within(target)) return "ready";
  if (day === 4 && !i.reminderSent && within(19 * 60)) return "reminder";
  return null;
}
export function closeNotificationCopy(kind: "ready" | "reminder", month: ISODate, started: boolean, stepTitle: string | null, minutes: number): { title: string; body: string; url: string } {
  const name = monthName(month), next = monthName(nextMonthOf(month));
  if (kind === "ready") return { title: `${name} is ready to close`, body: `Six quick checks, about ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`, url: closeUrl(month) };
  if (started) return { title: `Finish closing ${name}`, body: `You stopped at ${stepTitle ?? "the review"}.`, url: closeUrl(month) + "?resume=1" };
  return { title: `${name} is still open`, body: `Two minutes now keeps ${next}'s numbers right.`, url: closeUrl(month) + "?resume=1" };
}
export { formatLong, formatShort };
