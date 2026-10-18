// Every date in Sterling is a Europe/London calendar date, carried as an ISO "YYYY-MM-DD" string.
// `occurred_on` is a London-local date (PRD §10.2), so dates never go through a Date in the
// device's own time zone. Calendar arithmetic is done in UTC on the date parts, which is
// time-zone free; only "what is the date right now?" needs Europe/London.
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

export const LONDON = "Europe/London";
export type ISODate = string; // YYYY-MM-DD

const dateParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  hourCycle: "h23", weekday: "short",
});

interface LondonParts { date: ISODate; hour: number; minute: number; weekday: number }
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The London calendar date, hour, minute and weekday (0 = Monday) of an instant. */
export function londonParts(at: Date | number = Date.now()): LondonParts {
  const m: Record<string, string> = {};
  for (const p of dateParts.formatToParts(at)) m[p.type] = p.value;
  return {
    date: `${m.year}-${m.month}-${m.day}`,
    hour: Number(m.hour), minute: Number(m.minute),
    weekday: WEEKDAYS.indexOf(m.weekday ?? "Mon"),
  };
}

export const todayLondon = (now: Date | number = Date.now()): ISODate => londonParts(now).date;
export const londonDateOf = (at: Date | string | number): ISODate => londonParts(new Date(at)).date;

const utc = (d: ISODate) => {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, day));
};
const iso = (d: Date): ISODate => d.toISOString().slice(0, 10);

export const addDays = (d: ISODate, n: number): ISODate => { const x = utc(d); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
export const diffDays = (a: ISODate, b: ISODate): number => Math.round((utc(a).getTime() - utc(b).getTime()) / 86_400_000);
export const daysInMonth = (d: ISODate): number => new Date(Date.UTC(utc(d).getUTCFullYear(), utc(d).getUTCMonth() + 1, 0)).getUTCDate();
export const dayOfMonth = (d: ISODate): number => utc(d).getUTCDate();
export const monthStart = (d: ISODate): ISODate => `${d.slice(0, 8)}01`;
export const monthEnd = (d: ISODate): ISODate => `${d.slice(0, 8)}${String(daysInMonth(d)).padStart(2, "0")}`;
/** 0 = Monday … 6 = Sunday (weeks start on Monday in the UK). */
export const weekdayIndex = (d: ISODate): number => (utc(d).getUTCDay() + 6) % 7;

/** Move by whole months, clamping the day: 31 Oct − 1 month = 30 Sep. */
export function addMonths(d: ISODate, n: number): ISODate {
  const x = utc(d);
  const day = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + n);
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, last));
  return iso(x);
}
export const addYears = (d: ISODate, n: number): ISODate => addMonths(d, n * 12);
export const yearStart = (d: ISODate): ISODate => `${d.slice(0, 4)}-01-01`;
export const yearEnd = (d: ISODate): ISODate => `${d.slice(0, 4)}-12-31`;
export function quarterStart(d: ISODate): ISODate {
  const m = Number(d.slice(5, 7));
  return `${d.slice(0, 4)}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
}
export const quarterEnd = (d: ISODate): ISODate => monthEnd(addMonths(quarterStart(d), 2));

const tzd = (d: ISODate) => {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  return new TZDate(y, m - 1, day, "UTC");
};
/** "Sunday 18 October" */
export const formatLong = (d: ISODate) => format(tzd(d), "EEEE d MMMM");
/** "Sun 18 Oct" */
export const formatShort = (d: ISODate) => format(tzd(d), "EEE d MMM");
/** "18 Oct" */
export const formatDayMonth = (d: ISODate) => format(tzd(d), "d MMM");
/** "October 2026" */
export const formatMonthYear = (d: ISODate) => format(tzd(d), "MMMM yyyy");
/** "Oct" */
export const formatMonthShort = (d: ISODate) => format(tzd(d), "MMM");
/** "October" */
export const formatMonth = (d: ISODate) => format(tzd(d), "MMMM");

/** Activity day headers (ACT-01): "Today", "Yesterday", "Fri 16 Oct". */
export function dayHeader(d: ISODate, today: ISODate = todayLondon()): string {
  if (d === today) return "Today";
  if (d === addDays(today, -1)) return "Yesterday";
  return formatShort(d);
}

/** "09:12" in London time. */
export const londonTime = (at: Date | string | number): string => {
  const p = londonParts(new Date(at));
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};

/** Quick Add's date chip: "Today", "Yesterday", or "Fri 16 Oct". */
export const dateChipLabel = (d: ISODate, today: ISODate = todayLondon()) =>
  d === today ? "Today" : d === addDays(today, -1) ? "Yesterday" : formatShort(d);

export const isISODate = (s: string): s is ISODate => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(utc(s).getTime());
